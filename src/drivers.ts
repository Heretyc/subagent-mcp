import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readMergedPermissionConfig } from "./concurrency.js";
import { mapModel, type Provider } from "./effort.js";
import {
  applyPermissionCeiling,
  verdict,
  type PermissionOp,
  type PermissionSnapshot,
  type PermissionVerdict,
} from "./permission-engine.js";
import { requestPendingPermission } from "./pending-permissions.js";

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
  agentId?: string;
  permissionSnapshot?: PermissionSnapshot;
}

export interface ProviderDriver {
  process: DriverProcess;
  readonly closed: boolean;
  readonly definitelyStarted: Promise<void>;
  start(message: string): Promise<void>;
  send(message: string): Promise<void>;
  notifyTaskComplete?(text?: string): Promise<void>;
  kill(): void;
}

export class ProviderTransientError extends Error {
  readonly isTransient = true as const;

  constructor(message: string) {
    super(message);
    this.name = "ProviderTransientError";
  }
}

export const CLAUDE_SESSION_LIMIT = /^\s*you['’]ve hit your session limit\s*·\s*resets\b/i;

export function isClaudeSessionLimit(text: string): boolean {
  return CLAUDE_SESSION_LIMIT.test(text);
}

export function claudeMessageText(message: any): string | null {
  if (message?.type === "assistant") {
    const content = message.message?.content;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("");
    return text || null;
  }
  if (message?.type === "result" && typeof message.result === "string") {
    return message.result;
  }
  return null;
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

  // True when the consumer (SDK query loop) is blocked awaiting input and nothing
  // is buffered — i.e. the model turn ended and it is idle. A watchdog uses this
  // to decide whether a resume turn is warranted.
  get isAwaitingInput(): boolean {
    return !this.closed && this.items.length === 0 && this.takers.length > 0;
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

// Server->client RPC methods that block on a client answer (elicitation /
// approval). Matched case-insensitively so provider-namespaced variants
// (e.g. "codex/requestUserInput", "session/requestApproval") are covered.
function isElicitationMethod(method: string): boolean {
  return /requestuserinput|elicit|approv/i.test(method);
}

// Shape the `result` payload for an elicitation reply. When the RPC offered a
// discrete option set, select only an exact case-insensitive label match and
// echo its identifier; otherwise pass the answer through as text.
function buildElicitationResult(options: JsonObject[] | undefined, answer: string): JsonObject {
  if (options && options.length > 0) {
    const norm = answer.trim().toLowerCase();
    const chosen = options.find((opt) => {
      const label = optionLabel(opt);
      return label !== null && norm === label.trim().toLowerCase();
    });
    if (chosen) {
      const id = optionId(chosen);
      return id !== null ? { optionId: id } : { option: chosen };
    }
  }
  return { text: answer };
}

function optionLabel(opt: JsonObject): string | null {
  for (const key of ["label", "name", "title", "text", "value", "id"]) {
    const v = opt[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function optionId(opt: JsonObject): string | number | null {
  for (const key of ["id", "value", "optionId", "label", "name"]) {
    const v = opt[key];
    if (typeof v === "string" || typeof v === "number") return v;
  }
  return null;
}

function isJsonRpcId(id: unknown): id is string | number {
  return typeof id === "string" || typeof id === "number";
}

type ClaudePermissionResult =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string; interrupt?: boolean };

function denyClaudePermission(message: string): ClaudePermissionResult {
  return { behavior: "deny", message };
}

function allowClaudePermission(): ClaudePermissionResult {
  return { behavior: "allow" };
}

function permissionSnapshotForLaunch(options: DriverLaunchOptions): PermissionSnapshot {
  if (options.permissionSnapshot) return options.permissionSnapshot;
  const merged = readMergedPermissionConfig(options.cwd);
  return {
    ceiling: merged.permissionsCeiling,
    escalation: merged.escalation,
    rules: { allow: merged.allow, deny: merged.deny, ask: merged.ask },
    additionalDirectories: merged.additionalDirectories,
    repoConfigChangedSinceFirstSeen: merged.repoConfigChangedSinceFirstSeen,
  };
}

function claudeToolName(request: JsonObject): string {
  for (const key of ["toolName", "tool_name", "name"]) {
    const value = request[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "unknown";
}

function claudeToolInput(request: JsonObject): JsonObject {
  for (const key of ["input", "toolInput", "tool_input"]) {
    const value = request[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  }
  return {};
}

function stringField(input: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function stringArrayField(input: JsonObject, keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) out.push(value);
    else if (Array.isArray(value)) {
      out.push(...value.filter((v): v is string => typeof v === "string" && v.length > 0));
    }
  }
  return out;
}

function permissionOpFromClaudeRequest(request: JsonObject, cwd: string): PermissionOp {
  const input = claudeToolInput(request);
  const command = stringField(input, ["command", "cmd"]);
  const url = stringField(input, ["url"]);
  const host = stringField(input, ["host", "domain"]);
  const paths = stringArrayField(input, [
    "path",
    "file_path",
    "filePath",
    "notebook_path",
    "notebookPath",
    "paths",
  ]);
  return {
    tool: claudeToolName(request),
    ...(command ? { command } : {}),
    ...(paths.length > 0 ? { paths } : {}),
    ...(url || host ? { network: [{ ...(url ? { url } : {}), ...(host ? { host } : {}) }] } : {}),
    cwd,
    irreversible: Boolean(input.irreversible),
  };
}

function claudeCorrelationId(request: JsonObject): string | number | null {
  for (const key of ["tool_use_id", "toolUseId", "id"]) {
    const value = request[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function isBypassImmuneClaudeAsk(request: JsonObject, op: PermissionOp): boolean {
  const input = claudeToolInput(request);
  if (input.requiresUserInteraction === true || input.requires_user_interaction === true) return true;
  const command = op.command?.toLowerCase() ?? "";
  if (/\b(shell|bash|zsh|fish|powershell|profile|rc)\b/.test(command) && /\b(edit|write|append|set)\b/.test(command)) {
    return true;
  }
  return (op.paths ?? []).some((path) => /(^|[\\/])\.(git|claude|vscode)([\\/]|$)/i.test(path));
}

function permissionDecisionToClaude(decision: PermissionVerdict, reason: string): ClaudePermissionResult {
  return decision === "allow" ? allowClaudePermission() : denyClaudePermission(reason);
}

export class MockJsonlDriver implements ProviderDriver {
  static transientPreStartHook: ((provider: Provider) => void) | null = null;
  static sessionLimitPreStartHook: ((provider: Provider) => void) | null = null;
  static postStartErrorHook: ((provider: Provider) => void) | null = null;

  readonly process: DriverProcess;
  private _definitelyStartedResolve!: () => void;
  private _definitelyStartedReject!: (e: Error) => void;
  readonly definitelyStarted: Promise<void> = new Promise((res, rej) => {
    this._definitelyStartedResolve = res;
    this._definitelyStartedReject = rej;
  });
  private queue: Promise<void> = Promise.resolve();
  private turn = 0;

  constructor(private readonly child: ChildProcess, private readonly provider: Provider) {
    this.process = new LogicalProcess(child.pid);
    child.once("spawn", () => this.process.emit("spawn"));
    child.once("error", (err) => (this.process as LogicalProcess).fail(err));
    child.once("close", (code, signal) => {
      if (!this.process.killed) (this.process as LogicalProcess).close(code, signal);
    });
    child.stdout?.on("data", (chunk) => {
      this._definitelyStartedResolve();
      this.process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => this.process.stderr.write(chunk));
    // Swallow stdin pipe errors (e.g. EPIPE writing to an exited child): the
    // writeLine() callback already surfaces the failure; without this listener
    // Node throws the socket's unhandled 'error' event and crashes the process.
    child.stdin?.on("error", () => {});
  }

  get closed(): boolean {
    return this.process.killed || this.child.killed || this.child.exitCode !== null;
  }

  start(message: string): Promise<void> {
    if (MockJsonlDriver.transientPreStartHook) {
      MockJsonlDriver.transientPreStartHook(this.provider);
      const err = new ProviderTransientError(`mock transient pre-start failure (${this.provider})`);
      this._definitelyStartedReject(err);
      return Promise.reject(err);
    }
    if (MockJsonlDriver.sessionLimitPreStartHook) {
      MockJsonlDriver.sessionLimitPreStartHook(this.provider);
      const err = new ProviderTransientError("You've hit your session limit · resets 7:10pm (America/Los_Angeles)");
      setTimeout(() => {
        this._definitelyStartedReject(err);
        this.process.stderr.write(err.message);
        (this.process as LogicalProcess).close(1);
      }, 0);
      return Promise.resolve();
    }
    if (MockJsonlDriver.postStartErrorHook) {
      this._definitelyStartedResolve();
      MockJsonlDriver.postStartErrorHook(this.provider);
      setTimeout(() => {
        this.process.stderr.write(`mock post-start error (${this.provider})\n`);
        (this.process as LogicalProcess).close(1);
      }, 0);
    }
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
  private _definitelyStartedResolve!: () => void;
  private _definitelyStartedReject!: (e: Error) => void;
  readonly definitelyStarted: Promise<void> = new Promise((res, rej) => {
    this._definitelyStartedResolve = res;
    this._definitelyStartedReject = rej;
  });
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
  // An inbound server->client RPC (elicitation, e.g. requestUserInput / approval)
  // awaiting a reply. While set, the next send() answers this request instead of
  // enqueuing a new turn — otherwise the in-flight question turn wedges the queue.
  private pendingServerRequest: { id: string | number; method: string; options?: JsonObject[] } | null = null;

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
    // Swallow stdin pipe errors (e.g. EPIPE writing to an exited child): the
    // writeLine() callback already surfaces the failure; without this listener
    // Node throws the socket's unhandled 'error' event and crashes the process.
    child.stdin?.on("error", () => {});
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
    if (this.pendingServerRequest) {
      // The message is the user's answer to a parked server-side elicitation.
      // Reply on the same JSON-RPC id (mirroring the { id, result } envelope our
      // own request() responses arrive in) instead of enqueuing a fresh turn.
      const req = this.pendingServerRequest;
      this.pendingServerRequest = null;
      return writeLine(this.child.stdin, {
        jsonrpc: "2.0",
        id: req.id,
        result: buildElicitationResult(req.options, message),
      });
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
    this.pendingServerRequest = null;
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
    } else if (
      isJsonRpcId(message.id) &&
      typeof message.method === "string" &&
      isElicitationMethod(message.method)
    ) {
      // Inbound server->client RPC (elicitation) that is NOT a reply to one of
      // our requests. Park it so the next send() answers it instead of queuing a
      // new turn; leaving it unanswered wedges the in-flight question turn.
      const params = (message.params ?? {}) as JsonObject;
      const options = Array.isArray(params.options) ? (params.options as JsonObject[]) : undefined;
      this.pendingServerRequest = { id: message.id, method: message.method, options };
    }

    if (message.method === "turn/started" && message.params && typeof message.params === "object") {
      const turn = ((message.params as JsonObject).turn ?? {}) as JsonObject;
      if (typeof turn.id === "string") this.activeTurnId = turn.id;
      this._definitelyStartedResolve();
    }
    if (message.method === "turn/completed") {
      this.activeTurnId = null;
      this.turnInFlight = false;
      void this.drainQueuedTurns();
    }
  }

  private fail(error: Error): void {
    const msg = error.message;
    const transient = /\b429\b|\b5\d{2}\b|quota|rate.?limit|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|too many requests|service unavailable|server error|overloaded/i.test(msg);
    this._definitelyStartedReject(transient ? new ProviderTransientError(msg) : error);
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
  private _definitelyStartedResolve!: () => void;
  private _definitelyStartedReject!: (e: Error) => void;
  readonly definitelyStarted: Promise<void> = new Promise((res, rej) => {
    this._definitelyStartedResolve = res;
    this._definitelyStartedReject = rej;
  });
  private readonly input = new AsyncInputQueue<JsonObject>();
  private readonly abortController = new AbortController();
  private queue: Promise<void> = Promise.resolve();
  private queryHandle: { close?: () => void } | null = null;
  private closedFlag = false;
  // Debounce for notifyTaskComplete(): set when a resume turn is pushed, cleared
  // as soon as the model streams any message (see pump). Prevents a stalled agent
  // from being resumed more than once per idle cycle.
  private resumePending = false;

  constructor(private readonly queryFn: (params: JsonObject) => AsyncGenerator<unknown, void>) {}

  get closed(): boolean {
    return this.closedFlag || this.process.killed;
  }

  open(options: DriverLaunchOptions): void {
    const permissionSnapshot = permissionSnapshotForLaunch(options);
    const isYolo = permissionSnapshot.ceiling === "yolo";
    const sdkOptions: JsonObject = {
      abortController: this.abortController,
      cwd: options.cwd,
      env: options.env,
      // The Claude Agent SDK rejects the short launch id "opus-4-8" with
      // model_not_found (404); normalize to the full id the SDK accepts.
      model: mapModel(options.provider, options.model),
      pathToClaudeCodeExecutable: options.command,
      permissionMode: isYolo ? "bypassPermissions" : "default",
      allowDangerouslySkipPermissions: isYolo,
      settingSources: [],
      tools: { type: "preset", preset: "claude_code" },
      canUseTool: async (request: JsonObject): Promise<ClaudePermissionResult> => {
        const op = permissionOpFromClaudeRequest(request, options.cwd);
        const engineResult = verdict(op, permissionSnapshot.rules);
        if (isYolo && isBypassImmuneClaudeAsk(request, op)) {
          return denyClaudePermission("bypass-immune Claude safety prompt auto-denied under yolo");
        }
        const decision = applyPermissionCeiling(engineResult.verdict, permissionSnapshot.ceiling);
        if (decision !== "ask") {
          return permissionDecisionToClaude(decision, engineResult.reason);
        }
        const pendingDecision = await requestPendingPermission({
          agentId: options.agentId,
          harnessChannel: "claude-canUseTool",
          toolNameOrMethod: op.tool,
          action: claudeToolInput(request),
          reason: engineResult.reason,
          suggestions: [],
          correlationId: claudeCorrelationId(request),
        });
        return permissionDecisionToClaude(pendingDecision.verdict, pendingDecision.reason);
      },
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

  // Wake the SDK query loop after the agent's own background task finishes. The
  // loop parks on `await next input` once the model turn ends; nothing else
  // pushes a resume, so a sub-agent that spawned a bg task would stall forever.
  // Pushes a synthetic user turn through the SAME input queue send() uses.
  //
  // WIRING: the notification source (task_notification for THIS agent's bg task)
  // is not visible inside drivers.ts. The owning server/monitor must call
  // driver.notifyTaskComplete() when it observes this agent's background
  // task_notification while the agent is `stalled` with an empty input queue
  // (see AsyncInputQueue.isAwaitingInput). Guarded so repeat calls are no-ops
  // until the model next produces output.
  notifyTaskComplete(text?: string): Promise<void> {
    if (this.closed || this.resumePending) return Promise.resolve();
    this.resumePending = true;
    const resumeText =
      text ?? "Your background task has completed. Resume and continue where you left off.";
    const next = this.queue.then(() => {
      if (this.closed) return;
      return this.input.push(userMessage(resumeText));
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
    let started = false;
    try {
      for await (const message of query) {
        // The model is producing output again: clear the resume debounce so a
        // future bg-task completion can wake it once more.
        this.resumePending = false;
        const text = claudeMessageText(message);
        if (!started && text && isClaudeSessionLimit(text)) {
          // Launch-time failover only applies before startup resolves/spawn grace ends;
          // post-registration session-limit rerouting is intentionally out of scope.
          this._definitelyStartedReject(new ProviderTransientError(text));
          this.closedFlag = true;
          this.process.stderr.write(text);
          this.process.close(1);
          return;
        }
        this.process.stdout.write(`${JSON.stringify(message)}\n`);
        if (!started && (message as { type?: unknown })?.type !== "system") {
          started = true;
          this._definitelyStartedResolve();
        }
      }
      this.closedFlag = true;
      this.process.close(0);
    } catch (error) {
      if (!this.process.killed) {
        const msg = error instanceof Error ? error.message : String(error);
        const transient = /\b429\b|\b5\d{2}\b|quota|rate.?limit|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|too many requests|service unavailable|server error|overloaded/i.test(msg);
        this._definitelyStartedReject(transient ? new ProviderTransientError(msg) : new Error(msg));
        this.closedFlag = true;
        this.process.stderr.write(msg);
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
