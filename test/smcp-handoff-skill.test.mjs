import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import "./smcp-config-skill.test.mjs";
import "./configure.test.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(repoRoot, "skills", "smcp-handoff", "SKILL.md");

test("smcp-handoff skill exists and declares resume triggers", () => {
  assert.ok(existsSync(skillPath), "skills/smcp-handoff/SKILL.md exists");

  const body = readFileSync(skillPath, "utf8");
  for (const phrase of ["handoff-resume", "resume handoff", "resume work"]) {
    assert.match(body, new RegExp(`"${phrase}"`), `declares trigger phrase: ${phrase}`);
  }
});

test("smcp-handoff skill documents handoff tool usage", () => {
  const body = readFileSync(skillPath, "utf8");

  for (const tool of ["handoff-write", "handoff-read", "handoff-clear"]) {
    assert.match(body, new RegExp(`\\b${tool}\\b[^.]+\\.`), `documents ${tool} usage`);
  }
});

test("package includes smcp-handoff skill directory", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("skills/smcp-handoff"), "package.json files ships skills/smcp-handoff");
});
