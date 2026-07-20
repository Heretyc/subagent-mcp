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
// Launchable FULL model ids = the claude-*/gpt-* keys of FULL_TO_SHORT (the
// bare short-id aliases in that map are not table ids). If FULL_TO_SHORT gains
// or loses a launchable model, update this set in lockstep.
export const LAUNCHABLE_TABLE_MODELS = new Set([
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-fable-5",
  "gpt-5.5",
  "gpt-5.6-sol",
]);

// Known benchmarked-but-non-launchable ids intentionally absent from the shipped
// table (documented here for readers; the positive LAUNCHABLE set above is the
// authority used by the filters): claude-opus-4-7, gpt-5.5-pro, gpt-5.4-mini,
// and any "unknown" placeholder id.
export const NON_LAUNCHABLE_TABLE_MODELS = new Set([
  "claude-opus-4-7",
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
