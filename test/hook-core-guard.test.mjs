import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import {
  readDirective,
  resolveDirectivesDir,
} from "../dist/orchestration/hook-core.js";

function withTempRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "hook-core-root-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  // ISS-080: an invalid/untrusted plugin root must never be honored, but it
  // must also never throw — resolution fails safe by falling back to the
  // compiled root's bundled directives dir.
  const compiledFallback = resolveDirectivesDir({});
  assert.equal(isAbsolute(compiledFallback), true);

  // A relative CLAUDE_PLUGIN_ROOT is untrusted: it is NOT honored and does not
  // throw; resolution falls back to the bundled directives dir.
  assert.doesNotThrow(
    () => resolveDirectivesDir({ CLAUDE_PLUGIN_ROOT: "relative/bad/path" }),
    "relative CLAUDE_PLUGIN_ROOT must fail safe, not throw"
  );
  assert.equal(
    resolveDirectivesDir({ CLAUDE_PLUGIN_ROOT: "relative/bad/path" }),
    compiledFallback,
    "relative CLAUDE_PLUGIN_ROOT falls back to the bundled directives dir"
  );
  assert.equal(
    readDirective({ CLAUDE_PLUGIN_ROOT: "relative/bad/path" }, "short-on.md"),
    readFileSync(join(compiledFallback, "short-on.md"), "utf8"),
    "relative CLAUDE_PLUGIN_ROOT still yields the bundled directive"
  );

  withTempRoot((rootWithoutDirectives) => {
    // An absolute root lacking a directives dir is likewise not honored and
    // must fall back to the bundled directives dir without throwing.
    assert.doesNotThrow(
      () => resolveDirectivesDir({ PLUGIN_ROOT: rootWithoutDirectives }),
      "PLUGIN_ROOT without directives must fail safe, not throw"
    );
    assert.equal(
      resolveDirectivesDir({ PLUGIN_ROOT: rootWithoutDirectives }),
      compiledFallback,
      "PLUGIN_ROOT without directives falls back to the bundled directives dir"
    );
  });

  withTempRoot((validRoot) => {
    const directivesDir = join(validRoot, "directives");
    mkdirSync(directivesDir);
    writeFileSync(join(directivesDir, "sample.md"), "directive body", "utf8");
    // A root is honored only when it is trusted: mark it under the install
    // allowlist by pointing npm_config_prefix at it, matching how the resolver
    // gates env-supplied roots.
    const trusted = { PLUGIN_ROOT: validRoot, npm_config_prefix: validRoot };
    assert.equal(resolveDirectivesDir(trusted), directivesDir);
    assert.equal(readDirective(trusted, "sample.md"), "directive body");
    assert.equal(readDirective(trusted, "missing.md"), "");
  });

  const fallback = resolveDirectivesDir({});
  assert.equal(isAbsolute(fallback), true);
  assert.equal(existsSync(fallback), true);
  assert.doesNotThrow(() => readFileSync(join(fallback, "short-on.md"), "utf8"));

  console.log("PASS hook-core guard");
} catch (error) {
  console.error(error);
  process.exit(1);
}
