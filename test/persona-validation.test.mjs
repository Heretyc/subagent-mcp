/**
 * Persona parameter validation tests for launch_agent.
 *
 * Drives the gating matrix from docs/spec/persona-mode/_INDEX.md against the
 * REAL exported validatePersonaParams() and mapAgentDefinition() in
 * src/persona.ts (compiled to dist/persona.js) - not a re-implementation.
 *
 * Imports from dist/persona.js ONLY - the pure, side-effect-free validation
 * layer. It NEVER imports dist/index.js: that entry module opens the stdio
 * transport and registers timers that would keep this process alive.
 */

import assert from "node:assert/strict";

import {
  hasPersonaParams,
  mapAgentDefinition,
  validatePersonaParams,
} from "../dist/persona.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

const off = { personaMode: "off", settingSources: [] };
const enabled = { personaMode: "enabled", settingSources: [] };
const enabledProject = { personaMode: "enabled", settingSources: ["project"] };
const enabledUser = { personaMode: "enabled", settingSources: ["user"] };
const enabledLocal = { personaMode: "enabled", settingSources: ["local"] };

const definition = {
  description: "probe",
  prompt: "You are PROBE-7.",
  tools: ["Read", "Grep"],
  disallowed_tools: ["Write"],
  skills: ["smcp-help"],
};

test("no persona params -> null regardless of mode", () => {
  assert.equal(validatePersonaParams(off, {}), null);
  assert.equal(validatePersonaParams(enabled, {}), null);
  assert.equal(validatePersonaParams(off, { provider: "codex" }), null);
  assert.equal(hasPersonaParams({}), false);
});

test("each persona param rejected while personaMode is off, naming user.personaMode", () => {
  for (const params of [
    { agent: "probe" },
    { agent: "probe", agentDefinition: definition },
    { systemPromptAppend: "extra" },
  ]) {
    const error = validatePersonaParams(off, params);
    assert.equal(typeof error, "string");
    assert.match(error, /persona mode is off/);
    assert.match(error, /user\.personaMode/);
  }
});

test("codex provider with any persona param rejected even when enabled", () => {
  for (const params of [
    { provider: "codex", agent: "probe", agentDefinition: definition },
    { provider: "codex", systemPromptAppend: "extra" },
  ]) {
    const error = validatePersonaParams(enabledProject, params);
    assert.equal(typeof error, "string");
    assert.match(error, /codex/);
  }
});

test("agent_definition without agent rejected", () => {
  const error = validatePersonaParams(enabled, { agentDefinition: definition });
  assert.equal(typeof error, "string");
  assert.match(error, /agent_definition requires agent/);
});

test("agent alone requires project or user in settingSources", () => {
  const error = validatePersonaParams(enabled, { agent: "implementer" });
  assert.equal(typeof error, "string");
  assert.match(error, /user\.settingSources/);
  const localOnly = validatePersonaParams(enabledLocal, { agent: "implementer" });
  assert.equal(typeof localOnly, "string");
  assert.equal(validatePersonaParams(enabledProject, { agent: "implementer" }), null);
  assert.equal(validatePersonaParams(enabledUser, { agent: "implementer" }), null);
});

test("system_prompt_append cannot be combined with agent", () => {
  for (const params of [
    { agent: "probe", agentDefinition: definition, systemPromptAppend: "extra" },
    { agent: "implementer", systemPromptAppend: "extra" },
  ]) {
    const error = validatePersonaParams(enabledProject, params);
    assert.equal(typeof error, "string");
    assert.match(error, /system_prompt_append cannot be combined with agent/);
  }
});

test("all-clear combinations return null", () => {
  assert.equal(
    validatePersonaParams(enabled, { agent: "probe", agentDefinition: definition }),
    null
  );
  assert.equal(validatePersonaParams(enabled, { systemPromptAppend: "extra" }), null);
  assert.equal(
    validatePersonaParams(enabled, {
      provider: "claude",
      agent: "probe",
      agentDefinition: definition,
    }),
    null
  );
});

test("mapAgentDefinition maps snake_case and never emits model", () => {
  const mapped = mapAgentDefinition(definition);
  assert.deepEqual(mapped, {
    description: "probe",
    prompt: "You are PROBE-7.",
    tools: ["Read", "Grep"],
    disallowedTools: ["Write"],
    skills: ["smcp-help"],
  });
  assert.equal("model" in mapped, false);
  assert.equal("disallowed_tools" in mapped, false);
});

test("mapAgentDefinition omits absent optional fields", () => {
  const mapped = mapAgentDefinition({ description: "d", prompt: "p" });
  assert.deepEqual(mapped, { description: "d", prompt: "p" });
});

console.log(`# Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
