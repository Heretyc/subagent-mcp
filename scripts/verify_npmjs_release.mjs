#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

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
const attempts = Number(process.env.NPMJS_VERIFY_ATTEMPTS ?? 8);
const baseDelayMs = Number(process.env.NPMJS_VERIFY_DELAY_MS ?? 3000);

async function fetchMetadata() {
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

function verify(metadata) {
  const latest = metadata?.["dist-tags"]?.latest;
  const version = metadata?.versions?.[targetVersion];
  if (!version) {
    throw new Error(`${targetName}@${targetVersion} is absent from npmjs metadata`);
  }
  if (latest !== targetVersion) {
    throw new Error(
      `npmjs dist-tags.latest is ${JSON.stringify(latest)}, expected ${JSON.stringify(targetVersion)}`
    );
  }
}

let lastError;
let verified = false;
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    verify(await fetchMetadata());
    console.log(`npmjs verified: ${targetName}@${targetVersion} is latest`);
    verified = true;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < attempts) {
      const waitMs = baseDelayMs * attempt;
      console.log(
        `npmjs verify attempt ${attempt}/${attempts} failed: ${error.message}; retrying in ${waitMs}ms`
      );
      await delay(waitMs);
    }
  }
}

if (!verified) {
  console.error(
    `npmjs verify failed after ${attempts} attempts for ${targetName}@${targetVersion}: ${lastError?.message ?? "unknown error"}`
  );
  process.exitCode = 1;
}
