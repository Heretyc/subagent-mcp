import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
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
  ucSettingsDir?: string;
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

const TRANSIENT_FAILURE_RE =
  /\b(?:401|403|429)\b|\b(?:http(?:\/\d(?:\.\d)?)?|status|statuscode|status_code|code|error)\b[\s:=#-]*(?:401|403|429|5\d{2})\b|auth(?:entication|orization)?|unauthori[sz]ed|forbidden|quota|rate.?limit|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|too many requests|service unavailable|server error|overloaded/i;

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
function buildElicitationResult(
  options: JsonObject[] | undefined,
  answer: string,
  action: "answer" | "decline" = "answer"
): JsonObject {
  if (action === "decline") return { action: "decline" };
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

type StrictReadParity = "warn" | "off";
type DriverPermissionSnapshot = PermissionSnapshot & {
  strictReadParity?: StrictReadParity;
  sandboxNetwork?: boolean;
};

function denyClaudePermission(message: string): ClaudePermissionResult {
  return { behavior: "deny", message };
}

function allowClaudePermission(): ClaudePermissionResult {
  return { behavior: "allow" };
}

function permissionSnapshotForLaunch(options: DriverLaunchOptions): PermissionSnapshot {
  if (options.permissionSnapshot) return options.permissionSnapshot;
  const merged = readMergedPermissionConfig(options.cwd);
  const snapshot: DriverPermissionSnapshot = {
    ceiling: merged.permissionsCeiling,
    escalation: merged.escalation,
    rules: { allow: merged.allow, deny: merged.deny, ask: merged.ask },
    additionalDirectories: merged.additionalDirectories,
    repoConfigChangedSinceFirstSeen: merged.repoConfigChangedSinceFirstSeen,
    strictReadParity: merged.strictReadParity,
    sandboxNetwork: merged.sandboxNetwork,
  };
  return snapshot;
}

export function providerChildSpawnOptions(
  options: Pick<DriverLaunchOptions, "cwd" | "env">,
  p: NodeJS.Platform = process.platform
): SpawnOptions {
  return {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: p !== "win32",
  };
}

export function killProviderChildProcess(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal: NodeJS.Signals,
  p: NodeJS.Platform = process.platform,
  killGroup: typeof process.kill = process.kill
): boolean {
  if (p !== "win32" && typeof child.pid === "number") {
    try {
      killGroup(-child.pid, signal);
      return true;
    } catch {}
  }
  return child.kill(signal);
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

/**
 * Adapter-layer symlink parity: the shared engine denies against the RESOLVED
 * target (see PermissionOp.resolvedPaths), so every adapter must populate it.
 * Resolve each path via realpath where it exists; pass the literal through
 * otherwise. Fail-closed: a resolution error keeps the literal in the match set
 * (never drops the path), it never turns a deny into a grant.
 */
function resolveOpPaths(paths: string[], cwd: string): string[] {
  return paths.map((p) => {
    try {
      return realpathSync(resolvePath(cwd, p));
    } catch {
      return p;
    }
  });
}

function permissionOpFromClaudeRequest(
  request: JsonObject,
  cwd: string,
  additionalDirectories?: string[]
): PermissionOp {
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
    ...(paths.length > 0 ? { paths, resolvedPaths: resolveOpPaths(paths, cwd) } : {}),
    ...(url || host ? { network: [{ ...(url ? { url } : {}), ...(host ? { host } : {}) }] } : {}),
    cwd,
    ...(additionalDirectories ? { additionalDirectories } : {}),
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

type CodexApprovalPolicy = "never" | "untrusted";
type CodexThreadSandbox = "danger-full-access" | "workspace-write";
type CodexTurnSandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "workspaceWrite"; writableRoots: string[]; networkAccess?: boolean };

interface CodexLaunchValues {
  approvalPolicy: CodexApprovalPolicy;
  threadSandbox: CodexThreadSandbox;
  turnSandboxPolicy: CodexTurnSandboxPolicy;
  cliConfigArgs: string[];
}

export function resolveCodexLaunchValues(snapshot: PermissionSnapshot, logTranslation = true): CodexLaunchValues {
  if (snapshot.ceiling === "yolo") {
    return {
      approvalPolicy: "never",
      threadSandbox: "danger-full-access",
      turnSandboxPolicy: { type: "dangerFullAccess" },
      cliConfigArgs: [],
    };
  }
  return {
    approvalPolicy: "untrusted",
    threadSandbox: "workspace-write",
    turnSandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: snapshot.additionalDirectories ?? [],
      networkAccess: true,
    },
    cliConfigArgs: ["-c", "sandbox_workspace_write.network_access=true"],
  };
}

type CodexApprovalMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "execCommandApproval"
  | "applyPatchApproval"
  | "mcpServer/elicitation/request";

interface CodexApprovalRecord {
  jsonRpcId: string | number;
  method: CodexApprovalMethod;
  params: JsonObject;
}

function isCodexApprovalMethod(method: string): method is CodexApprovalMethod {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "execCommandApproval" ||
    method === "applyPatchApproval" ||
    method === "mcpServer/elicitation/request"
  );
}

function codexApprovalKey(id: string | number): string {
  return `${typeof id}:${id}`;
}

function codexParams(message: JsonObject): JsonObject {
  return message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? (message.params as JsonObject)
    : {};
}

function codexStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

function codexFileChangePaths(fileChanges: unknown): string[] {
  if (!fileChanges || typeof fileChanges !== "object" || Array.isArray(fileChanges)) return [];
  return Object.keys(fileChanges as Record<string, unknown>).filter((p) => p.length > 0);
}

// Codex apply-patch op taxonomy: add/create -> Write, modify -> Edit. Mirrors
// how the Claude adapter and golden vectors distinguish creation from mutation
// so Write(...) rules round-trip identically through both adapters. Any create
// in the batch makes it a Write; a pure-modify batch is an Edit.
function codexFileChangeTool(fileChanges: unknown): "Write" | "Edit" {
  if (!fileChanges || typeof fileChanges !== "object" || Array.isArray(fileChanges)) return "Edit";
  const creates = /^(add|create)/i;
  for (const change of Object.values(fileChanges as Record<string, unknown>)) {
    const type = change && typeof change === "object" ? (change as JsonObject).type : change;
    if (typeof type === "string" && creates.test(type)) return "Write";
  }
  return "Edit";
}

function codexCommandFromParams(params: JsonObject): { command?: string; argv?: string[] } {
  const command = params.command;
  if (typeof command === "string" && command.length > 0) return { command };
  const argv = codexStringArray(command);
  if (argv.length > 0) return { command: argv.join(" "), argv };
  return {};
}

export function codexApprovalOp(
  method: CodexApprovalMethod,
  params: JsonObject,
  cwd: string,
  additionalDirectories?: string[]
): { op: PermissionOp; confidence: boolean } {
  if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
    const command = codexCommandFromParams(params);
    const opCwd = typeof params.cwd === "string" && params.cwd.length > 0 ? params.cwd : cwd;
    return {
      op: {
        tool: "Bash",
        ...command,
        cwd: opCwd,
        ...(additionalDirectories ? { additionalDirectories } : {}),
        irreversible: Boolean(params.irreversible),
      },
      confidence: Boolean(command.command),
    };
  }

  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    const paths = [
      ...(typeof params.grantRoot === "string" && params.grantRoot.length > 0 ? [params.grantRoot] : []),
      ...codexFileChangePaths(params.fileChanges),
    ];
    return {
      op: {
        tool: codexFileChangeTool(params.fileChanges),
        ...(paths.length > 0 ? { paths, resolvedPaths: resolveOpPaths(paths, cwd) } : {}),
        cwd,
        ...(additionalDirectories ? { additionalDirectories } : {}),
        irreversible: false,
      },
      confidence: paths.length > 0 || method === "item/fileChange/requestApproval",
    };
  }

  return {
    op: {
      tool: "mcpServer/elicitation",
      cwd,
      ...(additionalDirectories ? { additionalDirectories } : {}),
      irreversible: false,
    },
    confidence: false,
  };
}

export function codexApprovalResult(method: CodexApprovalMethod, decision: PermissionVerdict): JsonObject {
  const allowed = decision === "allow";
  if (method === "mcpServer/elicitation/request") return { action: allowed ? "accept" : "decline" };
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: allowed ? "approved" : "denied" };
  }
  return { decision: allowed ? "accept" : "decline" };
}

export class MockJsonlDriver implements ProviderDriver {
  static transientPreStartHook: ((provider: Provider) => void) | null = null;
  static sessionLimitPreStartHook: ((provider: Provider) => void) | null = null;
  static postStartErrorHook: ((provider: Provider) => void) | null = null;
  static firstTurnFailureHook: ((provider: Provider) => void) | null = null;

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
    if (MockJsonlDriver.firstTurnFailureHook) {
      // Simulate a provider that starts fine but whose FIRST turn terminally
      // fails with a model/provider error and no output (e.g. codex model not
      // supported). definitelyStarted stays pending (turn never really started);
      // the process survives so only the stream failure signal drives failover.
      MockJsonlDriver.firstTurnFailureHook(this.provider);
      const line =
        this.provider === "codex"
          ? JSON.stringify({ method: "turn/completed", params: { turn: { status: "failed", items: [] } } })
          : JSON.stringify({ type: "result", is_error: true, subtype: "error_during_execution" });
      this.process.stdout.write(line + "\n");
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
  private readonly pendingApprovals = new Map<string, CodexApprovalRecord>();
  private readonly queuedTurns: string[] = [];
  private readonly pendingDenyReasons: string[] = [];
  private nextId = 1;
  private stdoutBuf = "";
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private drainActive = false;
  private initialized = false;
  private turnInFlight = false;
  private readonly maxQueueDepth = 32;
  private readonly maxPendingApprovals = 16;
  private readonly permissionSnapshot: PermissionSnapshot;
  private readonly codexLaunchValues: CodexLaunchValues;
  private readonly wireModel: string;
  constructor(private readonly child: ChildProcess, private readonly options: DriverLaunchOptions) {
    this.permissionSnapshot = permissionSnapshotForLaunch(options);
    this.codexLaunchValues = resolveCodexLaunchValues(this.permissionSnapshot);
    this.wireModel = mapModel(options.provider, options.model);
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
      model: this.wireModel,
      cwd: this.options.cwd,
      approvalPolicy: this.codexLaunchValues.approvalPolicy,
      sandbox: this.codexLaunchValues.threadSandbox,
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
    killProviderChildProcess(this.child, "SIGKILL");
    (this.process as LogicalProcess).kill("SIGKILL");
    this.rejectPending(new Error("codex app-server driver was killed"));
    this.queuedTurns.length = 0;
    this.pendingApprovals.clear();
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
    const inputText = this.consumeDenyNotice(message);
    try {
      const response = await this.request("turn/start", {
        threadId: this.threadId,
        input: [textInput(inputText)],
        cwd: this.options.cwd,
        model: this.wireModel,
        effort: this.options.effort,
        approvalPolicy: this.codexLaunchValues.approvalPolicy,
        sandboxPolicy: this.codexLaunchValues.turnSandboxPolicy,
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

  private consumeDenyNotice(message: string): string {
    if (this.pendingDenyReasons.length === 0) return message;
    const reasons = this.pendingDenyReasons.splice(0);
    const shown = [...new Set(reasons)].slice(0, 8).join("; ");
    return `Permission DENIED for ${reasons.length} action(s) since your last message: ${shown}. Do not retry; adjust approach.\n\n${message}`;
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
      isCodexApprovalMethod(message.method)
    ) {
      void this.handleCodexApproval(message.id, message.method, codexParams(message));
    } else if (
      isJsonRpcId(message.id) &&
      typeof message.method === "string" &&
      isElicitationMethod(message.method)
    ) {
      console.error(`[codex app-server driver] declining unhandled elicitation method: ${message.method}`);
      void this.replyJsonRpc(message.id, buildElicitationResult(undefined, "", "decline"));
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

  private async handleCodexApproval(
    jsonRpcId: string | number,
    method: CodexApprovalMethod,
    params: JsonObject
  ): Promise<void> {
    const key = codexApprovalKey(jsonRpcId);
    const record: CodexApprovalRecord = { jsonRpcId, method, params };
    if (this.pendingApprovals.size >= this.maxPendingApprovals) {
      await this.replyCodexApproval(record, "deny", "pending approval cap reached; auto-denied fail-closed");
      return;
    }
    this.pendingApprovals.set(key, record);
    const { op, confidence } = codexApprovalOp(
      method,
      params,
      this.options.cwd,
      this.permissionSnapshot.additionalDirectories
    );
    const strictReadParity = (this.permissionSnapshot as DriverPermissionSnapshot).strictReadParity ?? "warn";
    if (!confidence && this.permissionSnapshot.ceiling !== "yolo" && strictReadParity === "warn") {
      console.error(
        `[permissions] strictReadParity warn: Codex approval payload for ${method} could not be matched with full confidence; routing to ask`
      );
    }
    const engineResult = confidence
      ? verdict(op, this.permissionSnapshot.rules)
      : {
          verdict: "ask" as const,
          classification: "neutral" as const,
          irreversible: Boolean(op.irreversible),
          reason: "Codex approval payload could not be matched with full confidence",
        };
    const decision = applyPermissionCeiling(engineResult.verdict, this.permissionSnapshot.ceiling);
    if (decision !== "ask") {
      await this.replyCodexApproval(record, decision, engineResult.reason);
      return;
    }
    const pendingDecision = await requestPendingPermission({
      agentId: this.options.agentId,
      harnessChannel: "codex-app-server",
      toolNameOrMethod: method,
      action: params,
      permissionCeiling: this.permissionSnapshot.ceiling,
      escalation: this.permissionSnapshot.escalation,
      irreversible: engineResult.irreversible,
      reason: engineResult.reason,
      suggestions: [],
      correlationId: jsonRpcId,
    });
    await this.replyCodexApproval(record, pendingDecision.verdict, pendingDecision.reason);
  }

  private async replyCodexApproval(
    record: CodexApprovalRecord,
    decision: PermissionVerdict,
    reason: string
  ): Promise<void> {
    const key = codexApprovalKey(record.jsonRpcId);
    if (!this.pendingApprovals.has(key)) return;
    this.pendingApprovals.delete(key);
    if (decision !== "allow") this.pendingDenyReasons.push(`${record.method}: ${reason}`);
    await this.replyJsonRpc(record.jsonRpcId, codexApprovalResult(record.method, decision));
  }

  private replyJsonRpc(id: string | number, result: JsonObject): Promise<void> {
    return writeLine(this.child.stdin, { jsonrpc: "2.0", id, result });
  }

  private fail(error: Error): void {
    const msg = error.message;
    const transient = TRANSIENT_FAILURE_RE.test(msg);
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
      // Shared gate: the SINGLE source of truth for every permission decision.
      // `harnessChannel` names the SDK surface that invoked it so parked prompts
      // are attributable. canUseTool and the PreToolUse hook both route here.
      canUseTool: async (request: JsonObject): Promise<ClaudePermissionResult> => {
        return this.gateRequest(request, options, permissionSnapshot, isYolo, "claude-canUseTool");
      },
      maxTurns: 50,
      includePartialMessages: true,
    };
    // PreToolUse hook: with permissionMode:"default" + settingSources:[] the SDK
    // auto-approves Bash (and any tool it treats as pre-approved) WITHOUT calling
    // canUseTool, so those calls would bypass the engine gate entirely. Register a
    // PreToolUse hook (no matcher => every tool) that routes EVERY tool call
    // through the same gate: allow -> continue, deny -> block with reason, ask ->
    // park via requestPendingPermission and resolve on respond/timeout. The hook
    // returns a concrete allow/deny, so canUseTool never double-fires for a tool
    // the hook already decided (it remains as fallback for anything the hook does
    // not cover). The yolo path stays hook-free — no gating there by design.
    if (!isYolo) {
      sdkOptions.hooks = {
        PreToolUse: [
          {
            hooks: [
              async (input: JsonObject): Promise<JsonObject> => {
                const request: JsonObject = {
                  tool_name: input.tool_name,
                  tool_input: input.tool_input,
                  tool_use_id: input.tool_use_id,
                };
                const result = await this.gateRequest(
                  request,
                  options,
                  permissionSnapshot,
                  isYolo,
                  "claude-pretooluse-hook"
                );
                const allow = result.behavior === "allow";
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: allow ? "allow" : "deny",
                    permissionDecisionReason: allow
                      ? ""
                      : (result as { message: string }).message,
                  },
                };
              },
            ],
          },
        ],
      };
    }
    if (options.effort !== "none" && options.effort !== "ultracode") {
      sdkOptions.effort = options.effort;
    }
    if (options.ucSettingsPath) sdkOptions.settings = options.ucSettingsPath;

    const query = this.queryFn({ prompt: this.input, options: sdkOptions });
    this.queryHandle = query as { close?: () => void };
    void this.pump(query);
  }

  // Single permission gate shared by canUseTool and the PreToolUse hook. Returns
  // allow/deny; parks (early-returns to the parent, resolves on respond/timeout)
  // when the engine verdict is "ask".
  private async gateRequest(
    request: JsonObject,
    options: DriverLaunchOptions,
    permissionSnapshot: PermissionSnapshot,
    isYolo: boolean,
    harnessChannel: string
  ): Promise<ClaudePermissionResult> {
    const op = permissionOpFromClaudeRequest(request, options.cwd, permissionSnapshot.additionalDirectories);
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
      harnessChannel,
      toolNameOrMethod: op.tool,
      action: claudeToolInput(request),
      permissionCeiling: permissionSnapshot.ceiling,
      escalation: permissionSnapshot.escalation,
      irreversible: engineResult.irreversible,
      reason: engineResult.reason,
      suggestions: [],
      correlationId: claudeCorrelationId(request),
    });
    return permissionDecisionToClaude(pendingDecision.verdict, pendingDecision.reason);
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
        const transient = TRANSIENT_FAILURE_RE.test(msg);
        this._definitelyStartedReject(transient ? new ProviderTransientError(msg) : new Error(msg));
        this.closedFlag = true;
        this.process.stderr.write(msg);
        this.process.close(1);
      }
    }
  }
}

export async function createProviderDriver(options: DriverLaunchOptions): Promise<ProviderDriver> {
  if (options.provider === "api") {
    throw new Error("api provider dispatch not implemented");
  }

  const testSeamsEnabled =
    process.env.NODE_ENV === "test" || process.env.SUBAGENT_MCP_ENABLE_TEST_SEAMS === "1";
  if (
    testSeamsEnabled &&
    ((options.provider === "claude" && process.env.SUBAGENT_MOCK_CLAUDE_DRIVER === "jsonl") ||
      (options.provider === "codex" && process.env.SUBAGENT_MOCK_CODEX_DRIVER === "jsonl"))
  ) {
    // Test seam: never honor mock-driver script env vars in production by default.
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

  const permissionSnapshot = permissionSnapshotForLaunch(options);
  const launchValues = resolveCodexLaunchValues(permissionSnapshot, false);
  const driverOptions = options.permissionSnapshot ? options : { ...options, permissionSnapshot };
  const child = spawn(options.command, [...launchValues.cliConfigArgs, ...options.args], providerChildSpawnOptions(options));
  return new CodexAppServerDriver(child, driverOptions);
}
