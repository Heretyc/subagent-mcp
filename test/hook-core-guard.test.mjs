import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");
const sourcePath = join(repo, "src", "orchestration", "hook-core.ts");

async function importSource() {
  try {
    return await import(pathToFileURL(sourcePath).href);
  } catch {
    return undefined;
  }
}

function assertSourceGuard() {
  const source = readFileSync(sourcePath, "utf8");
  const resolverMatch = source.match(
    /export function resolveDirectivesDir[\s\S]*?\n}\n\n\/\*\* Read a directive asset/
  );

  assert.ok(resolverMatch, "expected resolveDirectivesDir source to be present");
  const resolver = resolverMatch[0];

  assert.match(resolver, /\bisAbsolute\b/);
  assert.match(resolver, /\bexistsSync\b/);
  assert.match(resolver, /\bthrow new Error\b/);
  assert.match(resolver, /CLAUDE_PLUGIN_ROOT/);
  assert.match(resolver, /PLUGIN_ROOT/);
  assert.match(resolver, /directives/);

  const readDirectiveMatch = source.match(
    /export function readDirective[\s\S]*?\n}\n\n\/\*\*/
  );
  assert.ok(readDirectiveMatch, "expected readDirective source to be present");
  assert.match(
    readDirectiveMatch[0],
    /const directivesDir = resolveDirectivesDir\(env\);[\s\S]*try \{/
  );
}

try {
  const module = await importSource();
  if (module?.resolveDirectivesDir) {
    assert.throws(
      () => module.resolveDirectivesDir({ CLAUDE_PLUGIN_ROOT: "relative/bad/path" }),
      /CLAUDE_PLUGIN_ROOT.*relative\/bad\/path/
    );
    const rootWithoutDirectives = mkdtempSync(join(tmpdir(), "hook-core-root-"));
    try {
      assert.throws(
        () => module.resolveDirectivesDir({ PLUGIN_ROOT: rootWithoutDirectives }),
        new RegExp(`PLUGIN_ROOT.*${rootWithoutDirectives.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
      );
    } finally {
      rmSync(rootWithoutDirectives, { recursive: true, force: true });
    }

    const validRoot = mkdtempSync(join(tmpdir(), "hook-core-root-"));
    try {
      const directivesDir = join(validRoot, "directives");
      mkdirSync(directivesDir);
      assert.equal(module.resolveDirectivesDir({ PLUGIN_ROOT: validRoot }), directivesDir);
    } finally {
      rmSync(validRoot, { recursive: true, force: true });
    }

    const fallback = module.resolveDirectivesDir({});
    assert.equal(isAbsolute(fallback), true);
    assert.equal(existsSync(fallback), true);
    assert.doesNotThrow(() => module.resolveDirectivesDir({}));
  } else {
    assertSourceGuard();
  }
  console.log("PASS hook-core guard");
} catch (error) {
  console.error(error);
  process.exit(1);
}
