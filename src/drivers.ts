import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Provider } from "./effort.js";

type JsonObject = Record<string, unknown>;

export interface DriverProcess extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  pid?: number;
  killed: boolean;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | string): boolean;
}

export interface DriverLaunchOptions {
  provider: Provider;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  model: string;
  effort: string;
  ucSettingsPath?: string;
}

export interface ProviderDriver {
  process: DriverProcess;
  readonly closed: boolean;
  start(message: string): Promise<void>;
  send(message: string): Promise<void>;
  kill(): void;
}

class LogicalProcess extends EventEmitter implements DriverProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  private closed = false;
  private spawned = false;

  constructor(readonly pid?: number, autoSpawn = false) {
    super();
    this.on("error", () => {});
    if (autoSpawn) setImmediate(() => this.emit("spawn"));
  }

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === "spawn") this.spawned = true;
    return super.emit(eventName, ...args);
  }

  override once(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    if (eventName === "spawn" && this.spawned) {
      queueMicrotask(() => listener.call(this));
      return this;
    }
    return super.once(eventName, listener);
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = code;
    this.emit("exit", code, signal);
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.emit("error", error);
    this.close(-1);
  }

  kill(signal: NodeJS.Signals | string = "SIGKILL"): boolean {
    if (this.closed) return false;
    this.killed = true;
    this.close(null, signal as NodeJS.Signals);
    return true;
  }
}

class AsyncInputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private takers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(private readonly maxDepth = 32) {}

  push(item: T): Promise<void> {
    if (this.closed) return Promise.reject(new Error("provider input stream is closed"));
    if (this.items.length >= this.maxDepth) {
      return Promise.reject(new Error(`provider input queue is full (${this.maxDepth})`));
    }
    const taker = this.takers.shift();
    if (taker) taker({ value: item, done: false });
    else this.items.push(item);
    return Promise.resolve();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const taker of this.takers.splice(0)) taker({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.takers.push(resolve));
      },
    };
  }
}

function writeLine(stdin: NodeJS.WritableStream | null | undefined, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!stdin || (stdin as { destroyed?: boolean }).destroyed) {
      reject(new Error("provider input stream is closed"));
      return;
    }
    const text = `${JSON.stringify(payload)}\n`;
    const writable = stdin as NodeJS.WritableStream & {
      write(chunk: string, cb: (err?: Error | null) => void): boolean;
    };
    writable.write(text, (err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function userMessage(text: string): JsonObject {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

function textInput(text: string): JsonObject {
  return { type: "text", text, text_elements: [] };
}

class MockJsonlDriver implements ProviderDriver {
  readonly process: DriverProcess;
  private queue: Promise<void> = Promise.resolve();
  private turn = 0;

  constructor(private readonly child: ChildProcess, private readonly provider: Provider) {
    this.process = new LogicalProcess(child.pid);
    child.once("spawn", () => this.process.emit("spawn"));
    child.once("error", (err) => (this.process as LogicalProcess).fail(err));
    child.once("close", (code, signal) => {
      if (!this.process.killed) (this.process as LogicalProcess).close(code, signal);
    });
    child.stdout?.on("data", (chunk) => this.process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => this.process.stderr.write(chunk));
  }

  get closed(): boolean {
    return this.process.killed || this.child.killed || this.child.exitCode !== null;
  }

  start(message: string): Promise<void> {
    return this.send(message);
  }

  send(message: string): Promise<void> {
    const next = this.queue.then(async () => {
      if (this.closed) throw new Error("provider driver is closed");
      this.turn += 1;
      await writeLine(this.child.stdin, {
        type: "turn.start",
        provider: this.provider,
        turn: this.turn,
        message,
      });
    });
    this.queue = next.catch(() => {});
    return next;
  }

  kill(): void {
    this.process.killed = true;
    this.child.stdin?.destroy();
    this.child.kill("SIGKILL");
    (this.process as LogicalProcess).kill("SIGKILL");
  }
}

export class CodexAppServerDriver implements ProviderDriver {
  readonly process: DriverProcess;
  private readonly pending = new Map<
    number,
    { resolve: (value: JsonObject) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly queuedTurns: string[] = [];
  private nextId = 1;
  private stdoutBuf = "";
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private drainActive = false;
  private initialized = false;
  private turnInFlight = false;
  private readonly maxQueueDepth = 32;

  constructor(private readonly child: ChildProcess, private readonly options: DriverLaunchOptions) {
    this.process = new LogicalProcess(child.pid);
    child.once("spawn", () => this.process.emit("spawn"));
    child.once("error", (err) => this.fail(err));
    child.once("close", (code, signal) => {
      if (!this.process.killed) (this.process as LogicalProcess).close(code, signal);
      this.rejectPending(new Error(`codex app-server exited before responding (code=${code ?? signal})`));
    });
    child.stdout?.on("data", (chunk) => this.onStdout(chunk.toString()));
    child.stderr?.on("data", (chunk) => this.process.stderr.write(chunk));
  }

  get closed(): boolean {
    return this.process.killed || this.child.killed || this.child.exitCode !== null;
  }

  async start(message: string): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "subagent-mcp", title: "subagent-mcp", version: "0.0.0" },
      capabilities: null,
    });
    await this.notify("initialized");
    const thread = await this.request("thread/start", {
      model: this.options.model,
      cwd: this.options.cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: true,
      threadSource: "subagent",
    });
    this.threadId = String(
      ((thread.result as JsonObject | undefined)?.thread as JsonObject | undefined)?.id ?? ""
    );
    if (!this.threadId) throw new Error("codex app-server thread/start returned no thread id");
    this.initialized = true;
    await this.startTurn(message);
  }

  send(message: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("provider driver is closed"));
    if (!this.initialized || !this.threadId) {
      return Promise.reject(new Error("codex app-server thread is not initialized"));
    }
    if (this.queuedTurns.length >= this.maxQueueDepth) {
      return Promise.reject(new Error(`provider input queue is full (${this.maxQueueDepth})`));
    }
    this.queuedTurns.push(message);
    void this.drainQueuedTurns();
    return Promise.resolve();
  }

  kill(): void {
    this.process.killed = true;
    this.child.stdin?.destroy();
    this.child.kill("SIGKILL");
    (this.process as LogicalProcess).kill("SIGKILL");
    this.rejectPending(new Error("codex app-server driver was killed"));
    this.queuedTurns.length = 0;
  }

  private async drainQueuedTurns(): Promise<void> {
    if (this.drainActive) return;
    this.drainActive = true;
    try {
      while (!this.closed && !this.turnInFlight && this.queuedTurns.length > 0) {
        const next = this.queuedTurns.shift();
        if (next !== undefined) await this.startTurn(next);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.process.stderr.write(`[codex app-server driver] ${msg}\n`);
      (this.process as LogicalProcess).close(1);
    } finally {
      this.drainActive = false;
    }
  }

  private async startTurn(message: string): Promise<void> {
    if (this.closed) throw new Error("provider driver is closed");
    if (!this.threadId) throw new Error("codex app-server thread is not initialized");
    this.turnInFlight = true;
    try {
      const response = await this.request("turn/start", {
        threadId: this.threadId,
        input: [textInput(message)],
        cwd: this.options.cwd,
        model: this.options.model,
        effort: this.options.effort,
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      });
      const turn = (response.result as JsonObject | undefined)?.turn as JsonObject | undefined;
      this.activeTurnId = typeof turn?.id === "string" ? turn.id : this.activeTurnId;
    } catch (error) {
      this.turnInFlight = false;
      throw error;
    }
  }

  private async request(method: string, params: unknown): Promise<JsonObject> {
    const id = this.nextId++;
    const promise = new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server request timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
    });
    await writeLine(this.child.stdin, { id, method, params });
    return promise;
  }

  private notify(method: string, params?: unknown): Promise<void> {
    return writeLine(this.child.stdin, params === undefined ? { method } : { method, params });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    const lines = this.stdoutBuf.split("\n");
    this.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      this.process.stdout.write(line.replace(/\r$/, "") + "\n");
      this.handleProtocolLine(line);
    }
  }

  private handleProtocolLine(line: string): void {
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }

    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error && typeof message.error === "object") {
        const err = message.error as JsonObject;
        pending.reject(new Error(String(err.message ?? "codex app-server error")));
      } else {
        pending.resolve(message);
      }
    }

    if (message.method === "turn/started" && message.params && typeof message.params === "object") {
      const turn = ((message.params as JsonObject).turn ?? {}) as JsonObject;
      if (typeof turn.id === "string") this.activeTurnId = turn.id;
    }
    if (message.method === "turn/completed") {
      this.activeTurnId = null;
      this.turnInFlight = false;
      void this.drainQueuedTurns();
    }
  }

  private fail(error: Error): void {
    (this.process as LogicalProcess).fail(error);
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.turnInFlight = false;
  }
}

export class ClaudeSdkDriver implements ProviderDriver {
  readonly process = new LogicalProcess(undefined, true);
  private readonly input = new AsyncInputQueue<JsonObject>();
  private readonly abortController = new AbortController();
  private queue: Promise<void> = Promise.resolve();
  private queryHandle: { close?: () => void } | null = null;
  private closedFlag = false;

  constructor(private readonly queryFn: (params: JsonObject) => AsyncGenerator<unknown, void>) {}

  get closed(): boolean {
    return this.closedFlag || this.process.killed;
  }

  open(options: DriverLaunchOptions): void {
    const sdkOptions: JsonObject = {
      abortController: this.abortController,
      cwd: options.cwd,
      env: options.env,
      model: options.model,
      pathToClaudeCodeExecutable: options.command,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: { type: "preset", preset: "claude_code" },
      maxTurns: 50,
      includePartialMessages: true,
    };
    if (options.effort !== "none" && options.effort !== "ultracode") {
      sdkOptions.effort = options.effort;
    }
    if (options.ucSettingsPath) sdkOptions.settings = options.ucSettingsPath;

    const query = this.queryFn({ prompt: this.input, options: sdkOptions });
    this.queryHandle = query as { close?: () => void };
    void this.pump(query);
  }

  start(message: string): Promise<void> {
    return this.send(message);
  }

  send(message: string): Promise<void> {
    const next = this.queue.then(() => {
      if (this.closed) throw new Error("provider driver is closed");
      return this.input.push(userMessage(message));
    });
    this.queue = next.catch(() => {});
    return next;
  }

  kill(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.input.close();
    this.abortController.abort();
    this.queryHandle?.close?.();
    this.process.kill("SIGKILL");
  }

  private async pump(query: AsyncGenerator<unknown, void>): Promise<void> {
    try {
      for await (const message of query) {
        this.process.stdout.write(`${JSON.stringify(message)}\n`);
      }
      this.closedFlag = true;
      this.process.close(0);
    } catch (error) {
      if (!this.process.killed) {
        this.closedFlag = true;
        this.process.stderr.write(error instanceof Error ? error.message : String(error));
        this.process.close(1);
      }
    }
  }
}

export async function createProviderDriver(options: DriverLaunchOptions): Promise<ProviderDriver> {
  if (
    (options.provider === "claude" && process.env.SUBAGENT_MOCK_CLAUDE_DRIVER === "jsonl") ||
    (options.provider === "codex" && process.env.SUBAGENT_MOCK_CODEX_DRIVER === "jsonl")
  ) {
    const mockScript = process.env.SUBAGENT_MOCK_DRIVER_SCRIPT;
    const child = mockScript
      ? spawn(process.execPath, [mockScript, options.provider], {
          cwd: options.cwd,
          env: options.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        })
      : spawn(options.command, [], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
        });
    return new MockJsonlDriver(child, options.provider);
  }

  if (options.provider === "claude") {
    let sdk: { query?: (params: JsonObject) => AsyncGenerator<unknown, void> };
    try {
      sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
        query?: (params: JsonObject) => AsyncGenerator<unknown, void>;
      };
    } catch {
      throw new Error(
        "Claude interactive driver requires @anthropic-ai/claude-agent-sdk; no one-shot CLI fallback is available"
      );
    }
    if (typeof sdk.query !== "function") {
      throw new Error("Claude Agent SDK does not expose the query() streaming API");
    }
    const driver = new ClaudeSdkDriver(sdk.query);
    driver.open(options);
    return driver;
  }

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return new CodexAppServerDriver(child, options);
}
