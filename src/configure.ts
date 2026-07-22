/**
 * configure - one MCP tool over one literal key table.
 *
 * Deliberately flat: a `CONFIG_KEYS` literal for static keys, a small dynamic-key
 * parser for `providers.*` / `env.*`, and ONE dispatch function. No registry
 * class, no schema DSL, no new config service. Every helper it needs already
 * exists (concurrency, jsonc, config-validate, atomic-write, init-registry).
 *
 * ponytail: the ceiling here is "one file, one table, one dispatch". If the key
 * space grows past ~40 static keys or a second tool needs the same table, split
 * the table into its own module and keep this dispatch. Not before.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_CAP,
  DEFAULT_CHECK_FOR_UPDATES,
  DEFAULT_CONTEXT_COACHING,
  DEFAULT_ESCALATION,
  DEFAULT_HANDOFF_WARN_THRESHOLD,
  DEFAULT_PERMISSIONS_CEILING,
  DEFAULT_SANDBOX_NETWORK,
  DEFAULT_STRICT_READ_PARITY,
  MAX_HANDOFF_WARN_THRESHOLD,
  MIN_HANDOFF_WARN_THRESHOLD,
  USER_SETTINGS_FILENAME,
  USER_SETTINGS_LOCAL_FILENAME,
  applyContextCoachingSettings,
  defaultConfigPath,
  parseCheckForUpdatesConfig,
  parseConcurrencyConfig,
  parseEscalationConfig,
  parsePermissionsCeilingConfig,
  parseSandboxNetworkConfig,
  parseStrictReadParityConfig,
  readContextCoachingSettings,
  resolveGlobalConfigPath,
  stripJsoncComments,
} from "./concurrency.js";
import { getConfigHome } from "./config-home.js";
import { ROUTING_CATEGORIES, validateConfigFile } from "./config-validate.js";
import { readInitRegistry, registryPath } from "./init-registry.js";
import { parseJsoncFile, type JsonObj } from "./jsonc.js";
import { atomicWriteFile } from "./orchestration/atomic-write.js";
import { computeEffectiveActive } from "./orchestration/hook-core.js";
import * as orchestrationMarker from "./orchestration/marker.js";
import * as metering from "./orchestration/metering.js";
import * as modelMode from "./orchestration/model-mode.js";
import { updateCheckEnvDisabled } from "./orchestration/update-check.js";
import { apiProviderEntries } from "./providers/schema.js";

export const CONFIGURE_TOOL_DESCRIPTION =
  "List, read, or update subagent-mcp configuration by canonical key. `action=list` enumerates settings; `action=get` requires `key`; `action=set` requires `key` and, for settable keys, string `value`. Secrets are always redacted. Machine-global and mode-owned settings are read-only here: edit the reported global file as a human or use `orchestration-mode`/`model-selection-mode`. Provider and .env writes are validated, backed up, and atomic; responses report `restart_required`.";

// ---------------------------------------------------------------------------
// Redaction (hard requirement: no raw secret in ANY returned string)
// ---------------------------------------------------------------------------

const SECRET_RE = /token|key|password|secret/i;

/** first-4 + ellipsis + last-2; anything shorter than 6 chars is fully masked. */
export function maskSecret(value: unknown): string {
  const s = String(value ?? "");
  return s.length < 6 ? "******" : `${s.slice(0, 4)}…${s.slice(-2)}`;
}

function isSecretCanonicalKey(key: string): boolean {
  // Every env value is masked, even when its NAME lacks a secret-ish word.
  return key.startsWith("env.") || SECRET_RE.test(key);
}

// Envelope fields that carry canonical key NAMES / patterns, never secret values.
const NAME_FIELDS = new Set(["key", "keys", "patterns"]);

function sanitizeNode(node: unknown, secret: boolean): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((v) => sanitizeNode(v, secret));
  if (typeof node === "object") {
    const src = node as Record<string, unknown>;
    const canonical = typeof src.key === "string" ? src.key : null;
    const valueIsSecret = secret || (canonical !== null && isSecretCanonicalKey(canonical));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (!secret && NAME_FIELDS.has(k)) {
        out[k] = sanitizeNode(v, false);
        continue;
      }
      out[k] = sanitizeNode(v, secret || SECRET_RE.test(k) || (k === "value" && valueIsSecret));
    }
    return out;
  }
  return secret ? maskSecret(node) : node;
}

/** THE single sanitizer. Every response goes through it before JSON.stringify. */
export function redactPayload(payload: unknown): unknown {
  return sanitizeNode(payload, false);
}

function ok(payload: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(redactPayload(payload), null, 2) }] };
}

function fail(action: string, key: string | undefined, error: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          redactPayload({ ok: false, action, ...(key ? { key } : {}), restart_required: false, error }),
          null,
          2
        ),
      },
    ],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// Resolved paths (always absolute, never `~`)
// ---------------------------------------------------------------------------

const globalConfigFile = () => resolve(resolveGlobalConfigPath(defaultConfigPath()).path);
const providersFile = () => resolve(join(getConfigHome(), "providers.jsonc"));
const envFile = () => resolve(join(getConfigHome(), ".env"));
const settingsFile = () => resolve(join(getConfigHome(), USER_SETTINGS_FILENAME));
const settingsLocalFile = () => resolve(join(getConfigHome(), USER_SETTINGS_LOCAL_FILENAME));
const updateRegistryFile = () => resolve(registryPath(homedir()));

// ---------------------------------------------------------------------------
// The one literal key table
// ---------------------------------------------------------------------------

type Scope = "global" | "user" | "update" | "mode" | "provider" | "env";
interface KeyMeta {
  scope: Scope;
  type: string;
  settable: boolean;
  restart: boolean | "if key_env changes";
  def: unknown;
  valid: string;
}

const CONFIG_KEYS: Record<string, KeyMeta> = {
  "global.globalConcurrentSubagents": { scope: "global", type: "integer", settable: false, restart: false, def: DEFAULT_CAP, valid: "integer >=10 as-is; 1..9 clamps to 10; non-integer or <=0 falls back to 20" },
  "global.checkForUpdates": { scope: "global", type: "boolean", settable: false, restart: true, def: DEFAULT_CHECK_FOR_UPDATES, valid: "true or false; forced false by NO_UPDATE_NOTIFIER, CI, NODE_ENV=test, SUBAGENT_UPDATE_CHECK=0|false" },
  "global.permissionsCeiling": { scope: "global", type: "enum", settable: false, restart: false, def: DEFAULT_PERMISSIONS_CEILING, valid: "auto, manual, yolo (malformed file fails closed to manual)" },
  "global.escalation": { scope: "global", type: "enum", settable: false, restart: false, def: DEFAULT_ESCALATION, valid: "irreversible-only, off" },
  "global.strictReadParity": { scope: "global", type: "enum", settable: false, restart: false, def: DEFAULT_STRICT_READ_PARITY, valid: "warn, off" },
  "global.sandboxNetwork": { scope: "global", type: "boolean", settable: false, restart: false, def: DEFAULT_SANDBOX_NETWORK, valid: "true, false (parser fallback is true when missing/invalid; the shipped scaffold writes false)" },
  "user.contextCoaching": { scope: "user", type: "boolean", settable: true, restart: false, def: DEFAULT_CONTEXT_COACHING, valid: "true, false" },
  "user.handoffWarnThreshold": { scope: "user", type: "integer", settable: true, restart: false, def: DEFAULT_HANDOFF_WARN_THRESHOLD, valid: `whole integer ${MIN_HANDOFF_WARN_THRESHOLD}..${MAX_HANDOFF_WARN_THRESHOLD}` },
  "update.autoUpdate": { scope: "update", type: "boolean", settable: false, restart: true, def: false, valid: "true, false" },
  "mode.orchestration": { scope: "mode", type: "state", settable: false, restart: false, def: null, valid: "ON, disabled-this-session (plus session_scope); set via the orchestration-mode tool" },
  "mode.modelSelection": { scope: "mode", type: "state", settable: false, restart: false, def: "smart", valid: "smart, user-approved-overrides (plus window metadata); set via the model-selection-mode tool" },
};

const PROVIDER_FIELDS = ["api_style", "base_url", "model", "key_env"] as const;
type ProviderField = (typeof PROVIDER_FIELDS)[number];

const PATTERNS = [
  "providers.<provider>",
  "providers.<provider>.{api_style|base_url|model|key_env}",
  "providers.<provider>.routing.<category>",
  "env.<ENV_NAME>",
];

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BOM_RE = new RegExp("^\\uFEFF");

const encodeSegment = (s: string) => encodeURIComponent(s).replace(/\./g, "%2E");
const decodeSegment = (s: string) => decodeURIComponent(s);

// ---------------------------------------------------------------------------
// Reads (never scaffold; readGlobalConfig() would write a missing global file)
// ---------------------------------------------------------------------------

function globalText(): string | null {
  const file = globalConfigFile();
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

function updateDisableSource(env: NodeJS.ProcessEnv = process.env): string | null {
  // ponytail: mirrors updateCheckEnvDisabled's predicate purely to LABEL which
  // variable won. The boolean itself still comes from that exported helper.
  if (env.NO_UPDATE_NOTIFIER !== undefined) return "env:NO_UPDATE_NOTIFIER";
  if (env.CI !== undefined) return "env:CI";
  if (env.NODE_ENV === "test") return "env:NODE_ENV=test";
  if (typeof env.SUBAGENT_UPDATE_CHECK === "string" && /^(?:0|false)$/i.test(env.SUBAGENT_UPDATE_CHECK.trim())) {
    return "env:SUBAGENT_UPDATE_CHECK";
  }
  return null;
}

function settingsLocalHas(prop: string): boolean {
  const file = settingsLocalFile();
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(stripJsoncComments(readFileSync(file, "utf8")));
    return !!parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, prop);
  } catch {
    return false;
  }
}

/** `KEY=value` grammar shared with config-validate's .env reader; last wins. */
function readEnvEntries(): Map<string, string> {
  const out = new Map<string, string>();
  const file = envFile();
  if (!existsSync(file)) return out;
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out.set(m[1], m[2].replace(/^["']|["']$/g, ""));
    }
  } catch {
    // Unreadable .env behaves as absent; never surface file contents.
  }
  return out;
}

function readProvidersDoc(): JsonObj | null {
  const parsed = parseJsoncFile(providersFile());
  return parsed.ok ? parsed.json : null;
}

interface Resolved {
  value: unknown;
  path: string | null;
  source?: string;
}

function readStatic(key: string): Resolved {
  const text = globalText();
  const gPath = globalConfigFile();
  const gSource = text === null ? "fallback (global file absent)" : undefined;
  switch (key) {
    case "global.globalConcurrentSubagents":
      return { value: text === null ? DEFAULT_CAP : parseConcurrencyConfig(text), path: gPath, source: gSource };
    case "global.checkForUpdates": {
      const configured = text === null ? DEFAULT_CHECK_FOR_UPDATES : parseCheckForUpdatesConfig(text);
      const disabled = updateCheckEnvDisabled();
      return {
        value: disabled ? false : configured,
        path: gPath,
        source: disabled ? (updateDisableSource() ?? "env") : gSource,
      };
    }
    case "global.permissionsCeiling":
      return { value: text === null ? DEFAULT_PERMISSIONS_CEILING : parsePermissionsCeilingConfig(text), path: gPath, source: gSource };
    case "global.escalation":
      return { value: text === null ? DEFAULT_ESCALATION : parseEscalationConfig(text), path: gPath, source: gSource };
    case "global.strictReadParity":
      return { value: text === null ? DEFAULT_STRICT_READ_PARITY : parseStrictReadParityConfig(text), path: gPath, source: gSource };
    case "global.sandboxNetwork":
      return { value: text === null ? DEFAULT_SANDBOX_NETWORK : parseSandboxNetworkConfig(text), path: gPath, source: gSource };
    case "user.contextCoaching":
    case "user.handoffWarnThreshold": {
      const prop = key === "user.contextCoaching" ? "contextCoaching" : "handoffWarnThreshold";
      const merged = readContextCoachingSettings();
      return {
        value: merged[prop as "contextCoaching" | "handoffWarnThreshold"],
        path: settingsFile(),
        source: settingsLocalHas(prop) ? settingsLocalFile() : undefined,
      };
    }
    case "update.autoUpdate":
      return {
        value: readInitRegistry(homedir()).autoUpdate,
        path: updateRegistryFile(),
        source: existsSync(updateRegistryFile()) ? undefined : "fallback (registry absent)",
      };
    case "mode.orchestration": {
      const cwd = process.cwd();
      const marker = orchestrationMarker.readCurrentSession(cwd);
      // ponytail: 3-line copy of index.ts's computeEffectiveOrchestrationActive so
      // this module never imports the server entry point (which opens stdio).
      const record = marker !== undefined ? metering.readMetering(marker) : null;
      const active = computeEffectiveActive(cwd, marker, Date.now(), record !== null && record.used_percentage === null);
      return {
        value: {
          orchestration_mode: active ? "ON" : "disabled-this-session",
          session_scope: marker ? (orchestrationMarker.isSessionScopedKey(marker) ? "session" : "anonymous") : "none",
        },
        path: null,
      };
    }
    case "mode.modelSelection": {
      const cwd = process.cwd();
      // ponytail: resolveMode may lazily persist a smart revert on an EXPIRED
      // window. That is the mode tool's own contract, not a configure write.
      const r = modelMode.resolveMode(cwd);
      return {
        value: { model_selection_mode: r.mode, enabled_at: r.enabled_at, window_remaining_ms: r.window_remaining_ms },
        path: resolve(modelMode.modelModePath(cwd)),
      };
    }
    default:
      return { value: null, path: null };
  }
}

// ---------------------------------------------------------------------------
// Dynamic key parsing
// ---------------------------------------------------------------------------

type Dynamic =
  | { kind: "env"; name: string }
  | { kind: "provider"; name: string; field: ProviderField | null; category: string | null }
  | { kind: "error"; error: string };

function parseDynamicKey(key: string): Dynamic | null {
  if (key.startsWith("env.")) {
    const name = key.slice(4);
    if (!ENV_NAME_RE.test(name)) return { kind: "error", error: `invalid environment variable name in key "${key}"; expected env.<NAME> matching [A-Za-z_][A-Za-z0-9_]*` };
    return { kind: "env", name };
  }
  if (!key.startsWith("providers.")) return null;
  const parts = key.slice("providers.".length).split(".");
  if (parts.length === 0 || parts[0] === "") return { kind: "error", error: `missing provider segment in key "${key}"` };
  let name: string;
  try {
    name = decodeSegment(parts[0]);
  } catch {
    return { kind: "error", error: `malformed percent-escape in provider segment of key "${key}"` };
  }
  if (name === "") return { kind: "error", error: `empty provider name in key "${key}"` };
  if (parts.length === 1) return { kind: "provider", name, field: null, category: null };
  if (parts.length === 2) {
    const field = parts[1] as ProviderField;
    if (!PROVIDER_FIELDS.includes(field)) return { kind: "error", error: `unknown provider field "${parts[1]}" in key "${key}"; expected one of ${PROVIDER_FIELDS.join(", ")} or routing.<category>` };
    return { kind: "provider", name, field, category: null };
  }
  if (parts.length === 3 && parts[1] === "routing") {
    if (!(ROUTING_CATEGORIES as readonly string[]).includes(parts[2])) {
      return { kind: "error", error: `unknown routing category "${parts[2]}" in key "${key}"; expected one of ${ROUTING_CATEGORIES.join(", ")}` };
    }
    return { kind: "provider", name, field: null, category: parts[2] };
  }
  return { kind: "error", error: `unrecognized provider key "${key}"; expected ${PATTERNS.slice(0, 3).join(", ")}` };
}

function unknownKeyError(key: string): string {
  return `unknown configuration key "${key}". Supported static keys: ${Object.keys(CONFIG_KEYS).join(", ")}. Supported patterns: ${PATTERNS.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Atomic backup + write (doctor's .bak-<epoch-ms> naming, atomic mechanics)
// ---------------------------------------------------------------------------

function backupAndWrite(file: string, next: string): string | null {
  const backup = existsSync(file) ? `${file}.bak-${Date.now()}` : null;
  if (backup) atomicWriteFile(backup, readFileSync(file, "utf8"), { encoding: "utf8", mode: 0o600 });
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteFile(file, next, { encoding: "utf8", mode: 0o600 });
  return backup;
}

function currentText(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function sanitizeMessage(e: unknown): string {
  // Never echo a submitted value; error text carries only the failure reason.
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Row construction
// ---------------------------------------------------------------------------

interface Row {
  key: string;
  value: unknown;
  scope: Scope;
  type: string;
  default: unknown;
  valid_values: string;
  settable: boolean;
  restart_required_on_set: boolean | "if key_env changes";
  redacted: boolean;
  path: string | null;
  source?: string;
}

function staticRow(key: string): Row {
  const meta = CONFIG_KEYS[key];
  const r = readStatic(key);
  return {
    key,
    value: r.value,
    scope: meta.scope,
    type: meta.type,
    default: meta.def,
    valid_values: meta.valid,
    settable: meta.settable,
    restart_required_on_set: meta.restart,
    redacted: isSecretCanonicalKey(key),
    path: r.path,
    ...(r.source ? { source: r.source } : {}),
  };
}

function providerRows(): Row[] {
  const doc = readProvidersDoc();
  if (!doc) return [];
  const file = providersFile();
  const rows: Row[] = [];
  for (const [name, entry] of apiProviderEntries(doc)) {
    const provider = entry as JsonObj;
    const base = `providers.${encodeSegment(name)}`;
    const mk = (key: string, value: unknown, type: string, valid: string, restart: Row["restart_required_on_set"]): Row => ({
      key, value, scope: "provider", type, default: null, valid_values: valid, settable: true,
      restart_required_on_set: restart, redacted: isSecretCanonicalKey(key), path: file,
    });
    rows.push(mk(base, provider, "object", "complete API-provider object: api_style, base_url, model, key_env and all 14 routing categories", "if key_env changes"));
    rows.push(mk(`${base}.api_style`, provider.api_style ?? null, "enum", "claude, openai", false));
    rows.push(mk(`${base}.base_url`, provider.base_url ?? null, "string", "non-empty string", false));
    rows.push(mk(`${base}.model`, provider.model ?? null, "string", "non-empty string", false));
    rows.push(mk(`${base}.key_env`, provider.key_env ?? null, "string", "non-empty environment variable name; a non-placeholder .env entry must exist", true));
    const routing = (provider.routing && typeof provider.routing === "object" && !Array.isArray(provider.routing) ? provider.routing : {}) as JsonObj;
    for (const category of ROUTING_CATEGORIES) {
      rows.push(mk(`${base}.routing.${category}`, routing[category] ?? null, "integer slot", "safe integer; <1 disables, >=1 is the one-based slot", false));
    }
  }
  return rows;
}

function envRows(): Row[] {
  const file = envFile();
  return [...readEnvEntries()].map(([name, value]) => ({
    key: `env.${name}`,
    value,
    scope: "env" as Scope,
    type: "secret",
    default: null,
    valid_values: "non-empty single-line string",
    settable: true,
    restart_required_on_set: true as const,
    redacted: true,
    path: file,
  }));
}

// ---------------------------------------------------------------------------
// Coaching messages (exact texts)
// ---------------------------------------------------------------------------

const globalCoaching = (key: string) =>
  `configure cannot set "${key}". This machine-global setting affects all users on this machine. A human must edit "${globalConfigFile()}" directly.`;

const autoUpdateCoaching = () =>
  `configure cannot set "update.autoUpdate". A human must edit "${updateRegistryFile()}" directly; this per-user update policy is intentionally read-only through MCP.`;

const MODE_COACHING: Record<string, string> = {
  "mode.orchestration":
    'configure cannot set "mode.orchestration". Use the orchestration-mode tool with enabled=true or enabled=false instead; omit enabled there to query.',
  "mode.modelSelection":
    'configure cannot set "mode.modelSelection". Use the model-selection-mode tool with mode="smart" or mode="user-approved-overrides" instead; omit mode there to query.',
};

function coached(key: string, message: string, path: string | null) {
  return ok({ ok: true, action: "set", key, status: "coached", path, backup: null, restart_required: false, message });
}

// ---------------------------------------------------------------------------
// set: user settings
// ---------------------------------------------------------------------------

function setUserSetting(key: string, raw: string) {
  const prop = key === "user.contextCoaching" ? "contextCoaching" : "handoffWarnThreshold";
  const merged = readContextCoachingSettings();
  const next = { ...merged };
  if (prop === "contextCoaching") {
    if (raw !== "true" && raw !== "false") return fail("set", key, `invalid value for ${key}; expected exactly "true" or "false"`);
    next.contextCoaching = raw === "true";
  } else {
    if (!/^-?\d+$/.test(raw)) return fail("set", key, `invalid value for ${key}; expected a whole integer ${MIN_HANDOFF_WARN_THRESHOLD}..${MAX_HANDOFF_WARN_THRESHOLD}`);
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < MIN_HANDOFF_WARN_THRESHOLD || n > MAX_HANDOFF_WARN_THRESHOLD) {
      return fail("set", key, `invalid value for ${key}; expected a whole integer ${MIN_HANDOFF_WARN_THRESHOLD}..${MAX_HANDOFF_WARN_THRESHOLD}`);
    }
    next.handoffWarnThreshold = n;
  }

  const target = settingsFile();
  const existing = currentText(target);
  const blank = existing === null || existing.replace(BOM_RE, "").trim() === "";
  const base = blank ? "{}\n" : (existing as string);
  let text: string;
  try {
    text = applyContextCoachingSettings(base, next);
  } catch (e) {
    return fail("set", key, `could not update ${target}: ${sanitizeMessage(e)}`);
  }
  if (existing !== null && text === existing) {
    return ok({ ok: true, action: "set", key, value: next[prop], status: "unchanged", path: target, backup: null, restart_required: false });
  }
  let backup: string | null;
  try {
    backup = backupAndWrite(target, text);
  } catch (e) {
    return fail("set", key, `could not write ${target}: ${sanitizeMessage(e)}`);
  }
  const effective = readContextCoachingSettings()[prop];
  const overridden = settingsLocalHas(prop) && effective !== next[prop];
  return ok({
    ok: true, action: "set", key, value: effective, status: "updated", path: target, backup, restart_required: false,
    ...(overridden ? { message: `written to ${target}, but ${settingsLocalFile()} overrides this key; the effective value is unchanged.`, source: settingsLocalFile() } : {}),
  });
}

// ---------------------------------------------------------------------------
// set: .env
// ---------------------------------------------------------------------------

function setEnv(key: string, name: string, raw: string) {
  if (raw === "" || /[\r\n\0]/.test(raw)) {
    return fail("set", key, `invalid value for ${key}; expected a non-empty single-line string without CR, LF, or NUL`);
  }
  const target = envFile();
  const existing = currentText(target);
  const assign = new RegExp(`^\\s*${name}\\s*=`);
  const lines = existing === null ? [] : existing.split(/\r?\n/);
  const out: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (assign.test(line)) {
      if (replaced) continue; // collapse later duplicates for the same name
      out.push(`${name}=${raw}`);
      replaced = true;
      continue;
    }
    out.push(line);
  }
  if (!replaced) {
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    out.push(`${name}=${raw}`);
    out.push("");
  }
  const text = out.join("\n");
  if (existing !== null && text === existing) {
    return ok({ ok: true, action: "set", key, value: raw, status: "unchanged", path: target, backup: null, restart_required: false });
  }
  let backup: string | null;
  try {
    backup = backupAndWrite(target, text);
  } catch (e) {
    return fail("set", key, `could not write ${target}: ${sanitizeMessage(e)}`);
  }
  // Deliberately no process.env mutation: env changes require a restart.
  return ok({ ok: true, action: "set", key, value: raw, status: "updated", path: target, backup, restart_required: true });
}

// ---------------------------------------------------------------------------
// set: providers.jsonc (validate a scratch candidate BEFORE touching the real file)
// ---------------------------------------------------------------------------

function setProvider(key: string, name: string, field: ProviderField | null, category: string | null, raw: string) {
  const target = providersFile();
  const whole = field === null && category === null;
  const parsed = parseJsoncFile(target);
  let doc: JsonObj;
  if (parsed.ok) {
    doc = JSON.parse(JSON.stringify(parsed.json)) as JsonObj;
  } else if (!existsSync(target) && whole) {
    doc = { providers: {} };
  } else if (!existsSync(target)) {
    return fail("set", key, `providers file ${target} does not exist; only a whole-provider set (providers.<provider>) can create it`);
  } else {
    return fail("set", key, `could not parse ${target}: ${parsed.error}`);
  }
  if (!doc.providers || typeof doc.providers !== "object" || Array.isArray(doc.providers)) {
    if (!whole) return fail("set", key, `${target} has no providers object; create the provider first with a whole-provider set`);
    doc.providers = {};
  }
  const providers = doc.providers as JsonObj;
  const before = providers[name];
  const isObj = !!before && typeof before === "object" && !Array.isArray(before);
  if (!whole && !isObj) {
    return fail("set", key, `unknown provider "${name}" in ${target}; create it first with a whole-provider set (providers.<provider>)`);
  }
  const oldKeyEnv = isObj ? (before as JsonObj).key_env : undefined;

  if (whole) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch (e) {
      return fail("set", key, `value for ${key} must be a JSON object: ${sanitizeMessage(e)}`);
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return fail("set", key, `value for ${key} must be a non-array JSON object`);
    }
    providers[name] = candidate;
  } else if (field) {
    if (raw === "") return fail("set", key, `invalid value for ${key}; expected a non-empty string`);
    (providers[name] as JsonObj)[field] = raw;
  } else if (category) {
    if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return fail("set", key, `invalid value for ${key}; expected a safe integer slot (<1 disables, >=1 is the one-based slot)`);
    }
    const entry = providers[name] as JsonObj;
    if (!entry.routing || typeof entry.routing !== "object" || Array.isArray(entry.routing)) entry.routing = {};
    (entry.routing as JsonObj)[category] = Number(raw);
  }

  const newKeyEnv = (providers[name] as JsonObj)?.key_env;
  // ponytail: JSON.stringify drops JSONC comments on a successful provider edit;
  // add a JSONC edit library only if preserving comments becomes a demonstrated need.
  const text = `${JSON.stringify(doc, null, 2)}\n`;

  mkdirSync(dirname(target), { recursive: true });
  const scratch = join(dirname(target), `.configure-candidate.${process.pid}.${Date.now()}.jsonc`);
  try {
    atomicWriteFile(scratch, text, { encoding: "utf8", mode: 0o600 });
    const result = validateConfigFile(scratch);
    if (!result.ok) {
      return fail("set", key, `provider validation failed; ${target} was not modified: ${result.lines.join(" | ")}`);
    }
  } catch (e) {
    return fail("set", key, `provider validation could not run; ${target} was not modified: ${sanitizeMessage(e)}`);
  } finally {
    try {
      unlinkSync(scratch);
    } catch {
      // Best-effort scratch cleanup; never mask the real outcome.
    }
  }

  const restart = String(oldKeyEnv ?? "") !== String(newKeyEnv ?? "");
  const entry = providers[name] as JsonObj;
  const reported = whole ? entry : category ? (entry.routing as JsonObj)[category] : entry[field as ProviderField];
  const existing = currentText(target);
  if (existing !== null && text === existing) {
    return ok({ ok: true, action: "set", key, value: reported, status: "unchanged", path: target, backup: null, restart_required: false });
  }
  let backup: string | null;
  try {
    backup = backupAndWrite(target, text);
  } catch (e) {
    return fail("set", key, `could not write ${target}: ${sanitizeMessage(e)}`);
  }
  return ok({ ok: true, action: "set", key, value: reported, status: "updated", path: target, backup, restart_required: restart });
}

// ---------------------------------------------------------------------------
// The one dispatch function
// ---------------------------------------------------------------------------

export interface ConfigureParams {
  action: "list" | "get" | "set";
  key?: string;
  value?: string;
}

export function configure(params: ConfigureParams) {
  const action = params?.action;
  const key = params?.key;
  const value = params?.value;

  if (action === "list") {
    if (key !== undefined || value !== undefined) return fail("list", undefined, "action=list accepts no key and no value");
    const rows = [...Object.keys(CONFIG_KEYS).map(staticRow), ...providerRows(), ...envRows()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return ok({ ok: true, action: "list", restart_required: false, keys: rows, patterns: PATTERNS });
  }

  if (action === "get") {
    if (!key) return fail("get", undefined, "action=get requires key");
    if (value !== undefined) return fail("get", key, "action=get accepts no value");
    const meta = CONFIG_KEYS[key];
    if (meta) {
      const r = readStatic(key);
      return ok({
        ok: true, action: "get", key, value: r.value, scope: meta.scope, path: r.path, settable: meta.settable,
        restart_required: false, restart_required_on_set: meta.restart, ...(r.source ? { source: r.source } : {}),
      });
    }
    const dyn = parseDynamicKey(key);
    if (!dyn) return fail("get", key, unknownKeyError(key));
    if (dyn.kind === "error") return fail("get", key, dyn.error);
    if (dyn.kind === "env") {
      const entries = readEnvEntries();
      if (!entries.has(dyn.name)) return fail("get", key, `no entry for ${key} in ${envFile()}`);
      return ok({ ok: true, action: "get", key, value: entries.get(dyn.name), scope: "env", path: envFile(), settable: true, restart_required: false, restart_required_on_set: true });
    }
    const row = providerRows().find((r) => r.key === key);
    if (!row) return fail("get", key, `no value for ${key} in ${providersFile()}`);
    return ok({
      ok: true, action: "get", key, value: row.value, scope: row.scope, path: row.path, settable: row.settable,
      restart_required: false, restart_required_on_set: row.restart_required_on_set,
    });
  }

  if (action === "set") {
    if (!key) return fail("set", undefined, "action=set requires key");
    const meta = CONFIG_KEYS[key];
    if (meta && !meta.settable) {
      if (meta.scope === "global") return coached(key, globalCoaching(key), globalConfigFile());
      if (key === "update.autoUpdate") return coached(key, autoUpdateCoaching(), updateRegistryFile());
      return coached(key, MODE_COACHING[key], readStatic(key).path);
    }
    if (value === undefined) return fail("set", key, `action=set requires value for ${key}`);
    if (meta) return setUserSetting(key, value);
    const dyn = parseDynamicKey(key);
    if (!dyn) return fail("set", key, unknownKeyError(key));
    if (dyn.kind === "error") return fail("set", key, dyn.error);
    if (dyn.kind === "env") return setEnv(key, dyn.name, value);
    return setProvider(key, dyn.name, dyn.field, dyn.category, value);
  }

  return fail(String(action ?? "unknown"), key, 'action must be one of "list", "get", "set"');
}
