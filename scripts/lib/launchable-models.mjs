// launchable-models.mjs — shared exclusion helper for routing-table validators.
//
// SSOT: this list MUST mirror the FULL table-id keys of FULL_TO_SHORT in
// src/routing.ts (the only models the launcher can actually spawn). ISS-057
// removed every non-launchable model id from the shipped src/routing-table.json
// so that every ranked candidate is launchable. The benchmark/audit source data
// (src/routing-table-audit.json) still carries the FULL universe (it is
// benchmark-derived truth and must stay intact), so the validators use this
// helper to project the audit/full universe down to the shipped, launchable
// subset before comparing against src/routing-table.json.
//
// Only CANONICAL model ids belong here: the real GA model ids the profiler
// benchmarks and the launcher actually spawns. Two kinds of FULL_TO_SHORT keys
// are NOT canonical table ids and are deliberately excluded:
//   1. bare short-id passthrough aliases (opus, sonnet, haiku, fable, ...), and
//   2. generic COMPATIBILITY aliases such as `gpt-5.6`, which carries no
//      benchmark rows of its own — mapModel pins it to the canonical
//      `gpt-5.6-sol` at launch, so the alias inherits that target's tier.
// Neither ever appears as a shipped routing-table row, so neither is listed
// (the test asserts `gpt-5.6` in particular stays out). This set does NOT
// encode any ranking — it is a pure membership allowlist. If FULL_TO_SHORT
// gains or loses a CANONICAL launchable model, update this set in lockstep.
export const LAUNCHABLE_TABLE_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-4-8",
  // ISS-325: account-verified pinned GA canonical ids (verified explicit CLI
  // aliases + successful account launches). Previously omitted, so their
  // benchmark rows were silently dropped at build_routing_table's lean
  // isLaunchableModel projection. claude-sonnet-5 stays OUT (unreachable).
  "claude-opus-5",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5-20251101",
  "claude-sonnet-5-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5",
  "claude-fable-5-1",
  "claude-fable-5",
  "gpt-5.5",
  // Account-verified gpt-5.6 trio: each is a pinned exact FULL_TO_SHORT table id
  // (maps to itself, carries a `max` tier via CODEX_MAX_MODELS) and appears in the
  // audit model_effort_universe, so all three must survive the lean projection.
  // terra/luna were previously omitted, silently dropping their eligible rows at
  // build_routing_table's isLaunchableModel filter (ISS-325).
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
]);

// Known benchmarked-but-non-launchable ids intentionally absent from the shipped
// table (documented here for readers; the positive LAUNCHABLE set above is the
// authority used by the filters): gpt-5.5-pro, gpt-5.4-mini, and any "unknown"
// placeholder id. NOTE (ISS-325): claude-opus-4-7 is NO LONGER treated as
// non-launchable — it is now an account-verified canonical launchable TABLE id
// (present in both FULL_TO_SHORT and LAUNCHABLE_TABLE_MODELS above). The lone
// explicit-override-only Claude selector is claude-sonnet-5, which is
// unsupported/unreachable for account launches: it is absent from FULL_TO_SHORT
// (never auto-routed) and is NOT a benchmarked-but-non-launchable id, so it
// belongs in neither table set.
export const NON_LAUNCHABLE_TABLE_MODELS = new Set([
  "gpt-5.5-pro",
  "gpt-5.4-mini",
]);

// True when a FULL model id is launchable (shipped in src/routing-table.json).
export function isLaunchableModel(model) {
  return LAUNCHABLE_TABLE_MODELS.has(model);
}

// True when a "model@effort" universe key belongs to a launchable model.
export function isLaunchablePairingKey(key) {
  const at = key.lastIndexOf("@");
  const model = at > 0 ? key.slice(0, at) : key;
  return LAUNCHABLE_TABLE_MODELS.has(model);
}
