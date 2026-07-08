import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = mkdtempSync(join(process.cwd(), ".tmp-subagent-config-bom-"));
const cwd = join(root, "repo");
const home = join(root, "home");
const globalPath = join(root, "global-subagent-mcp-config.jsonc");

try {
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  mkdirSync(join(home, ".subagent-mcp"), { recursive: true });

  writeFileSync(globalPath, '\uFEFF{"permissionsCeiling":"yolo"}', "utf8");
  writeFileSync(
    join(home, ".subagent-mcp", "settings.json"),
    '\uFEFF{"permissions":{"allow":["Read(home-bom.txt)"]}}',
    "utf8"
  );
  writeFileSync(
    join(cwd, ".claude", "settings.json"),
    '\uFEFF{"permissions":{"allow":["Bash(node bom.js)"]}}',
    "utf8"
  );

  const code = `
    import { readMergedPermissionConfig, legacyConfigPath } from "./dist/concurrency.js";
    import { rmSync, writeFileSync } from "node:fs";
    const cwd = ${JSON.stringify(cwd)};
    const globalPath = ${JSON.stringify(globalPath)};
    const valid = readMergedPermissionConfig(cwd, globalPath);
    rmSync(globalPath);
    writeFileSync(legacyConfigPath(globalPath), '\\uFEFF{"permissionsCeiling":"manual"}', "utf8");
    const legacy = readMergedPermissionConfig(cwd, globalPath);
    writeFileSync(globalPath, "{not-json", "utf8");
    const malformed = readMergedPermissionConfig(cwd, globalPath);
    console.log(JSON.stringify({ valid, legacy, malformed }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  const { valid, legacy, malformed } = JSON.parse(out);

  assert.equal(valid.permissionsCeiling, "yolo", "BOM-prefixed global config must honor yolo ceiling");
  assert.ok(valid.allow.includes("Read(home-bom.txt)"), "BOM-prefixed user settings must parse");
  assert.ok(valid.allow.includes("Bash(node bom.js)"), "BOM-prefixed repo settings must parse");
  assert.deepEqual(valid.configParseFailure, []);
  assert.equal(legacy.permissionsCeiling, "manual", "BOM-prefixed legacy global config must parse");
  assert.equal(malformed.permissionsCeiling, "manual");
  assert.ok(malformed.ask.includes("Bash") && malformed.ask.includes("Edit"));
  assert.ok(malformed.configParseFailure.some((f) => f.source === "builtin"));
} finally {
  rmSync(root, { recursive: true, force: true });
}
