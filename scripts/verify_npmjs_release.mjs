#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_ATTEMPTS = 15;
export const DEFAULT_BASE_DELAY_MS = 3000;

export async function fetchMetadata(registryUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(registryUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function verify(metadata, targetName, targetVersion) {
  const distTags = metadata?.["dist-tags"] ?? {};
  const targetTag = targetVersion.includes("-") ? "beta" : "latest";
  const taggedVersion = distTags[targetTag];
  const latest = distTags.latest;
  const version = metadata?.versions?.[targetVersion];
  if (!version) {
    throw new Error(`${targetName}@${targetVersion} is absent from npmjs metadata`);
  }
  if (taggedVersion !== targetVersion) {
    throw new Error(
      `npmjs dist-tags.${targetTag} is ${JSON.stringify(taggedVersion)}, expected ${JSON.stringify(targetVersion)}`
    );
  }
  if (targetTag !== "latest" && latest === targetVersion) {
    throw new Error(`npmjs dist-tags.latest moved to prerelease ${JSON.stringify(targetVersion)}`);
  }
  return targetTag;
}

export async function runVerifier({
  targetName,
  targetVersion,
  loadMetadata,
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  sleep = delay,
  log = console.log,
  errorLog = console.error,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const targetTag = verify(await loadMetadata(), targetName, targetVersion);
      log(`npmjs verified: ${targetName}@${targetVersion} is dist-tags.${targetTag}`);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const waitMs = baseDelayMs * attempt;
        log(
          `npmjs verify attempt ${attempt}/${attempts} failed: ${error.message}; retrying in ${waitMs}ms`
        );
        await sleep(waitMs);
      }
    }
  }
  errorLog(
    `npmjs verify failed after ${attempts} attempts for ${targetName}@${targetVersion}: ${lastError?.message ?? "unknown error"}`
  );
  return false;
}

async function main() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const [packageNameArg, packageVersionArg, extraArg] = process.argv.slice(2);
  if (extraArg !== undefined || (packageNameArg === undefined) !== (packageVersionArg === undefined)) {
    console.error(
      "Usage: node scripts/verify_npmjs_release.mjs [package-name package-version]"
    );
    process.exit(2);
  }

  const targetName = packageNameArg ?? pkg.name;
  const targetVersion = packageVersionArg ?? pkg.version;
  const registryName = targetName.replace("/", "%2F");
  const registryUrl = `https://registry.npmjs.org/${registryName}`;
  const attempts = Number(process.env.NPMJS_VERIFY_ATTEMPTS ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = Number(process.env.NPMJS_VERIFY_DELAY_MS ?? DEFAULT_BASE_DELAY_MS);
  const ok = await runVerifier({
    targetName,
    targetVersion,
    attempts,
    baseDelayMs,
    loadMetadata: () => fetchMetadata(registryUrl),
  });
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
