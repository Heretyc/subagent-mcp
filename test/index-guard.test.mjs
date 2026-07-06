import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");
const source = readFileSync(join(repo, "src", "index.ts"), "utf8");

try {
  assert.doesNotMatch(
    source,
    /JSON\.stringify\(\s*payload\s*,\s*null\s*,\s*2\s*\)/,
    "wait handler should compact JSON.stringify(payload)"
  );

  assert.doesNotMatch(
    source,
    /\brouting_tier\s*:/,
    "tool response payloads must not emit internal routing_tier"
  );

  assert.match(
    source,
    /const\s+STDOUT_RING_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024\s*;/,
    "STDOUT_RING_BYTES const should exist"
  );
  assert.match(
    source,
    /agentState\.stdout\s*=\s*agentState\.stdout\.slice\(-STDOUT_RING_BYTES\)/,
    "stdout append path should trim to the ring limit"
  );

  const verboseObject = /\.\.\.\(params\.verbose\s*\?\s*\{[\s\S]*?stdout_tail\s*:\s*stdoutTail[\s\S]*?stderr_tail\s*:\s*stderrTail[\s\S]*?\}\s*:\s*\{\}\s*\)/;
  assert.match(
    source,
    verboseObject,
    "stdout_tail and stderr_tail should be emitted only inside params.verbose"
  );

  assert.match(
    source,
    /const\s+stdoutTail\s*=\s*envelopeUntrustedOutput\([\s\S]*?escapedStdout\.slice\(-2000\)[\s\S]*?:\s*escapedStdout\s*\);/,
    "stdoutTail should be enveloped at assignment after escaping and slicing"
  );
  assert.match(
    source,
    /const\s+stderrTail\s*=\s*envelopeUntrustedOutput\([\s\S]*?escapedStderr\.slice\(-1000\)[\s\S]*?:\s*escapedStderr\s*\);/,
    "stderrTail should be enveloped at assignment after escaping and slicing"
  );

  const stdoutEscapeAt = source.indexOf("const escapedStdout = escapeUntrustedTags(agent.stdout);");
  const stdoutSliceAt = source.indexOf("escapedStdout.slice(-2000)");
  assert.ok(stdoutEscapeAt >= 0, "poll_agent should escape stdout before slicing");
  assert.ok(stdoutSliceAt > stdoutEscapeAt, "stdout escaping must textually precede tail slicing");

  const stderrEscapeAt = source.indexOf("const escapedStderr = escapeUntrustedTags(agent.stderr);");
  const stderrSliceAt = source.indexOf("escapedStderr.slice(-1000)");
  assert.ok(stderrEscapeAt >= 0, "poll_agent should escape stderr before slicing");
  assert.ok(stderrSliceAt > stderrEscapeAt, "stderr escaping must textually precede tail slicing");

  console.log("PASS index guard checks");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
