// Defensive extraction of a sub-agent's final assistant turn text from its
// captured stdout. NEVER throws; on any parse failure, unknown shape, or empty
// result it falls back to the raw stdout (trimmed). Empty stdout -> "".

function rawFallback(stdout: string): string {
  return (stdout || "").trim();
}

// Pull a final assistant-message string out of one parsed codex `--json` event.
// Codex emits newline-delimited JSON; the final assistant message has appeared
// under a few shapes across CLI versions, so match tolerantly.
function codexEventText(evt: unknown): string | null {
  if (!evt || typeof evt !== "object") return null;
  const e = evt as Record<string, unknown>;

  // Shape A: { type: "agent_message", message: "..." }
  if (e.type === "agent_message" && typeof e.message === "string") {
    return e.message;
  }

  // Shape B: { type: "item.completed", item: { item_type: "agent_message", text: "..." } }
  if (e.type === "item.completed" && e.item && typeof e.item === "object") {
    const item = e.item as Record<string, unknown>;
    if (item.item_type === "agent_message" && typeof item.text === "string") {
      return item.text;
    }
  }

  // Shape C: { msg: { type: "agent_message", message: "..." } }
  if (e.msg && typeof e.msg === "object") {
    const msg = e.msg as Record<string, unknown>;
    if (msg.type === "agent_message" && typeof msg.message === "string") {
      return msg.message;
    }
  }

  return null;
}

export function extractFinalTurn(provider: string, stdout: string): string {
  if (!stdout) return "";

  if (provider === "claude") {
    try {
      const parsed = JSON.parse(stdout);
      // Object with a string `result` field is claude's final assistant message.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const r = (parsed as Record<string, unknown>).result;
        if (typeof r === "string") return r;
      }
      // Array form: last element of type "result" or carrying a string result.
      if (Array.isArray(parsed)) {
        for (let i = parsed.length - 1; i >= 0; i--) {
          const el = parsed[i];
          if (el && typeof el === "object") {
            const obj = el as Record<string, unknown>;
            if (obj.type === "result" && typeof obj.result === "string") {
              return obj.result;
            }
            if (typeof obj.result === "string") {
              return obj.result;
            }
          }
        }
      }
    } catch {
      // fall through to raw fallback
    }
    return rawFallback(stdout);
  }

  if (provider === "codex") {
    let last: string | null = null;
    const lines = stdout.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        const text = codexEventText(evt);
        if (text !== null) last = text;
      } catch {
        // skip non-JSON lines
      }
    }
    if (last !== null) return last;
    return rawFallback(stdout);
  }

  // Unknown provider: raw fallback.
  return rawFallback(stdout);
}
