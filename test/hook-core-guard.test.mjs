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
  assert.throws(
    () => resolveDirectivesDir({ CLAUDE_PLUGIN_ROOT: "relative/bad/path" }),
    /CLAUDE_PLUGIN_ROOT.*relative\/bad\/path/,
    "relative CLAUDE_PLUGIN_ROOT should fail closed"
  );

  withTempRoot((rootWithoutDirectives) => {
    assert.throws(
      () => resolveDirectivesDir({ PLUGIN_ROOT: rootWithoutDirectives }),
      new RegExp(`PLUGIN_ROOT.*${rootWithoutDirectives.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "PLUGIN_ROOT without directives should fail closed"
    );
  });

  withTempRoot((validRoot) => {
    const directivesDir = join(validRoot, "directives");
    mkdirSync(directivesDir);
    writeFileSync(join(directivesDir, "sample.md"), "directive body", "utf8");
    assert.equal(resolveDirectivesDir({ PLUGIN_ROOT: validRoot }), directivesDir);
    assert.equal(readDirective({ PLUGIN_ROOT: validRoot }, "sample.md"), "directive body");
    assert.equal(readDirective({ PLUGIN_ROOT: validRoot }, "missing.md"), "");
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
