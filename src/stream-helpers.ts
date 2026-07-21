// Defensive parsing of a sub-agent's VISIBLE provider stream.
//
// "Visible" = provider stream events, summaries, and assistant messages a human
// would see in the CLI. Provider-internal reasoning blocks (Claude `thinking` /
// `redacted_thinking` content blocks, Codex `reasoning` items/events) are not
// parsed into visible items. Supports Codex app-server JSON-RPC notifications,
// older Codex JSONL, and Claude SDK/stream-json events where feasible. NEVER
// throws; unparseable lines are skipped.

export interface VisibleStreamItem {
  type: string;
  text: string;
  // Capture timestamp (epoch ms). Stamped by the caller, not the parser, so the
  // parser stays pure and deterministically testable.
  at?: number;
}

function pushText(out: VisibleStreamItem[], type: string, text: unknown): void {
  if (typeof text === "string" && text.trim().length > 0) {
    out.push({ type, text: text.trim() });
  }
}

// Codex app-server uses newline-delimited JSON-RPC. Visible: assistant deltas,
// agent messages, and completed items that carry text. Chain-of-thought
// (anything whose type or item_type is `reasoning`) is dropped.
function collectCodex(e: Record<string, unknown>, out: VisibleStreamItem[]): void {
  if (typeof e.method === "string") {
    const params = e.params && typeof e.params === "object" ? e.params as Record<string, unknown> : {};
    if (e.method === "item/agentMessage/delta") {
      pushText(out, "agent_message", params.delta);
      return;
    }
    if (e.method === "item/started" || e.method === "item/completed") {
      const item = params.item && typeof params.item === "object" ? params.item as Record<string, unknown> : {};
      const itemType = typeof item.type === "string" ? item.type : "item";
      if (itemType.includes("reasoning")) return;
      pushText(out, itemType, item.text ?? item.command ?? item.summary);
      return;
    }
    if (e.method === "turn/completed") {
      const turn = params.turn && typeof params.turn === "object" ? params.turn as Record<string, unknown> : {};
      const items = Array.isArray(turn.items) ? turn.items : [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        if (obj.type === "agentMessage") pushText(out, "agent_message", obj.text);
      }
      return;
    }
  }

  const type = typeof e.type === "string" ? e.type : "";
  if (type.includes("reasoning")) return;

  // Shape A: { type: "agent_message", message: "..." }
  if (type === "agent_message") {
    pushText(out, "agent_message", e.message);
    return;
  }

  // Shape B: { type: "item.completed", item: { item_type, text } }
  if (type === "item.completed" && e.item && typeof e.item === "object") {
    const item = e.item as Record<string, unknown>;
    const itemType = typeof item.item_type === "string" ? item.item_type : "item";
    if (itemType.includes("reasoning")) return;
    pushText(out, itemType, item.text);
    return;
  }

  // Shape C: { msg: { type: "agent_message", message: "..." } }
  if (e.msg && typeof e.msg === "object") {
    const msg = e.msg as Record<string, unknown>;
    const msgType = typeof msg.type === "string" ? msg.type : "";
    if (msgType.includes("reasoning")) return;
    if (msgType === "agent_message") pushText(out, "agent_message", msg.message);
  }
}

// Claude stream-json emits one JSON event per line. Visible: assistant `text`
// and `tool_use` blocks plus the final `result`. `thinking` /
// `redacted_thinking` blocks are dropped. Tolerates the buffered-json single
// `result` object too.
function collectClaude(e: Record<string, unknown>, out: VisibleStreamItem[]): void {
  if (e.type === "result") {
    pushText(out, "result", e.result);
    return;
  }

  if (e.type === "assistant" && e.message && typeof e.message === "object") {
    const message = e.message as Record<string, unknown>;
    const content = message.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text") pushText(out, "text", b.text);
      else if (b.type === "tool_use") pushText(out, "tool_use", b.name);
      // thinking / redacted_thinking: provider-internal reasoning, not parsed as visible.
    }
  }
}

// Returns true if a complete JSONL line contains only provider-internal reasoning
// (Claude `thinking`/`redacted_thinking` blocks, Codex `reasoning` items) —
// records that produce no visible stream items. Never throws.
export function isNonVisibleStreamLine(provider: string, line: string): boolean {
  if (provider === "api") return false;

  const trimmed = line.trim();
  if (!trimmed) return false;
  let evt: unknown;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!evt || typeof evt !== "object") return false;
  const e = evt as Record<string, unknown>;
  if (provider === "codex") {
    const type = typeof e.type === "string" ? e.type : "";
    if (type.includes("reasoning")) return true;
    if (type === "item.completed" && e.item && typeof e.item === "object") {
      const item = e.item as Record<string, unknown>;
      if (typeof item.item_type === "string" && item.item_type.includes("reasoning")) return true;
    }
    if (e.msg && typeof e.msg === "object") {
      const msg = e.msg as Record<string, unknown>;
      if (typeof msg.type === "string" && msg.type.includes("reasoning")) return true;
    }
    return false;
  }
  if (provider === "claude") {
    if (e.type !== "assistant") return false;
    if (!e.message || typeof e.message !== "object") return false;
    const content = (e.message as Record<string, unknown>).content;
    if (!Array.isArray(content) || content.length === 0) return false;
    // Only pure hidden if every block is thinking/redacted_thinking.
    return content.every((block) => {
      if (!block || typeof block !== "object") return false;
      const b = block as Record<string, unknown>;
      return b.type === "thinking" || b.type === "redacted_thinking";
    });
  }
  return false;
}

// Parse a SINGLE complete JSONL line into visible items (appended to `out`).
// Blank/unparseable lines are skipped. Never throws.
function collectLine(provider: string, line: string, out: VisibleStreamItem[]): void {
  if (provider === "api") return;

  const trimmed = line.trim();
  if (!trimmed) return;
  let evt: unknown;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!evt || typeof evt !== "object") return;
  if (provider === "codex") collectCodex(evt as Record<string, unknown>, out);
  else if (provider === "claude") collectClaude(evt as Record<string, unknown>, out);
}

export function parseVisibleStream(
  provider: string,
  chunk: string
): VisibleStreamItem[] {
  const out: VisibleStreamItem[] = [];
  if (!chunk) return out;
  for (const line of chunk.split("\n")) collectLine(provider, line, out);
  return out;
}

// Per-agent line buffering across stdout chunks. Provider JSONL events can be
// split across stdout `data` chunks (a single JSON object arriving in two
// reads). Splitting each raw chunk on "\n" in isolation would drop the halves.
// `consumeStreamChunk` concatenates the carried-over `pending` partial line with
// the new chunk, parses only the COMPLETE lines (everything before the final
// newline), and returns the still-incomplete trailing fragment as the next
// `pending`. `lines` are the complete raw line strings parsed this call, so the
// caller can scan them for completion markers (e.g. Codex `turn.completed`)
// without re-implementing the split.
export interface ConsumeResult {
  items: VisibleStreamItem[];
  pending: string;
  lines: string[];
}

export function consumeStreamChunk(
  provider: string,
  pending: string,
  chunk: string
): ConsumeResult {
  const data = (pending || "") + (chunk || "");
  const parts = data.split("\n");
  // The last element is the trailing fragment: incomplete unless the chunk ended
  // with a newline (in which case it is "").
  const remainder = parts.pop() ?? "";
  const items: VisibleStreamItem[] = [];
  const lines: string[] = [];
  for (const line of parts) {
    if (!line.trim()) continue;
    lines.push(line);
    collectLine(provider, line, items);
  }
  return { items, pending: remainder, lines };
}

// Flush any buffered trailing fragment (call once on stream close, where the
// final line may have arrived without a terminating newline).
export function flushStream(provider: string, pending: string): ConsumeResult {
  const trimmed = (pending || "").trim();
  if (!trimmed) return { items: [], pending: "", lines: [] };
  const items: VisibleStreamItem[] = [];
  collectLine(provider, trimmed, items);
  return { items, pending: "", lines: [trimmed] };
}

export function isTurnCompletedLine(provider: string, line: string): boolean {
  if (provider === "api") return false;

  const trimmed = line.trim();
  if (!trimmed) return false;
  try {
    const evt = JSON.parse(trimmed) as Record<string, unknown>;
    if (provider === "codex") {
      return evt.method === "turn/completed" || evt.type === "turn.completed";
    }
    if (provider === "claude") {
      return evt.type === "result";
    }
  } catch {
    return false;
  }
  return false;
}

// Detect a TERMINAL provider/model error on a turn (systemError / invalid_request
// / model-not-supported class): the provider reports the turn failed rather than
// completing it. Returns a short reason string on a match, else null. Callers pair
// this with a "no visible output yet" guard so only a FIRST-turn terminal failure
// (a launch-equivalent condition) triggers silent failover to the next candidate.
export function terminalTurnFailure(provider: string, line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pick = (...cands: unknown[]): string => {
    for (const c of cands) {
      if (typeof c === "string" && c.trim()) return c.trim();
      if (c && typeof c === "object") {
        const m = (c as Record<string, unknown>).message;
        if (typeof m === "string" && m.trim()) return m.trim();
      }
    }
    return "";
  };
  if (provider === "codex") {
    const method = typeof evt.method === "string" ? evt.method : "";
    const params = (evt.params && typeof evt.params === "object" ? evt.params : {}) as Record<string, unknown>;
    // An error notification the provider will not itself retry.
    if (method === "error" && params.willRetry !== true && evt.willRetry !== true) {
      return pick(params.message, params.error, evt.error) || "codex reported a terminal error";
    }
    // The thread transitioned into a system/error state.
    if (method === "thread/status/changed") {
      const thread = (params.thread && typeof params.thread === "object" ? params.thread : {}) as Record<string, unknown>;
      const status = typeof params.status === "string" ? params.status : typeof thread.status === "string" ? thread.status : "";
      if (/error/i.test(status)) return `codex thread status ${status}`;
    }
    if (method === "thread/systemError" || method === "thread/error") {
      return pick(params.message, params.error, evt.error) || "codex thread systemError";
    }
    if (method === "turn/failed" || method === "turn/error") {
      return pick(params.message, params.error, evt.error) || "codex turn failed";
    }
    // The turn ended in a failed (not completed) status.
    if (method === "turn/completed" || evt.type === "turn.completed") {
      const turn = (params.turn && typeof params.turn === "object" ? params.turn : {}) as Record<string, unknown>;
      const status = typeof turn.status === "string" ? turn.status.toLowerCase() : "";
      if (status === "failed" || status === "error") {
        return pick(turn.error, turn.message) || "codex turn failed";
      }
    }
    return null;
  }
  if (provider === "claude") {
    // A Claude result event flagged as an error (no assistant output produced).
    if (evt.type === "result" && evt.is_error === true) {
      return pick(evt.error, evt.result, evt.subtype) || "claude turn failed";
    }
  }
  return null;
}

// Append new items to a rolling buffer, retaining only the last `n`.
export function retainLastN<T>(buffer: T[], items: T[], n: number): T[] {
  if (items.length === 0) return buffer;
  const merged = buffer.concat(items);
  return merged.length > n ? merged.slice(-n) : merged;
}
