// Pure sub-agent first-line marker upsert (S8 / D20). Spec: Appendix A7 of
// docs/spec/dev-loop/orchestration-directive-architecture.md.
//
// `launch_agent` routes every sub-agent prompt through ensureParentMarker before
// spawn so the canonical child-session identifier is ALWAYS the literal first
// line — this is what makes the §6 first-line exemption fire and prevents the §5
// fail-safe-ON default from recursively orchestrating child sessions (fork-bomb
// prevention). Idempotent, silent, never mutates the prompt body.

export const MARKER = "<this is a request from a parent process>";

// Return `prompt` with MARKER guaranteed as its literal first line.
// - First line = position 0 up to the first "\n"; a trailing "\r" (CRLF) is
//   stripped before comparison only.
// - For the startsWith(MARKER) check ONLY, a leading BOM (U+FEFF) on the first
//   line is ignored. The prompt body is NEVER mutated.
// - Leading whitespace is NOT stripped: the spec is "literal first line begins
//   with MARKER" (D19), so a space-prefixed or line-2 marker counts as ABSENT.
// - Present (after BOM-strip) -> returned unchanged (no duplicate).
// - Absent -> MARKER + "\n" + prompt.
export function ensureParentMarker(prompt: string): string {
  const nl = prompt.indexOf("\n");
  let firstLine = nl === -1 ? prompt : prompt.slice(0, nl);
  if (firstLine.endsWith("\r")) firstLine = firstLine.slice(0, -1);
  if (firstLine.charCodeAt(0) === 0xfeff) firstLine = firstLine.slice(1);
  if (firstLine.startsWith(MARKER)) return prompt;
  return MARKER + "\n" + prompt;
}
