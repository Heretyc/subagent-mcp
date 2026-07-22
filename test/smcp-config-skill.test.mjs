import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(repoRoot, "skills", "smcp-config", "SKILL.md");

test("smcp-config skill exists with valid frontmatter and budget", () => {
  assert.ok(existsSync(skillPath), "skills/smcp-config/SKILL.md exists");
  const body = readFileSync(skillPath, "utf8");
  const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, "frontmatter exists");
  assert.match(frontmatter[1], /^name:\s*smcp-config$/m);
  assert.ok(Math.ceil(body.length / 4) <= 300, "SKILL.md stays under 300 tokens");
});

test("smcp-config ships settings reference and command", () => {
  assert.ok(existsSync(join(repoRoot, "skills", "smcp-config", "references", "settings.md")));
  assert.ok(existsSync(join(repoRoot, "commands", "smcp-config.toml")));
});
