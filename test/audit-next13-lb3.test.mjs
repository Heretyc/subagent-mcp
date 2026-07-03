import assert from "node:assert/strict";
import {
  isClaudeBackgroundWakeLine,
  maybeResumeAfterBackgroundTask,
} from "../dist/index.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function makeAgent({ closed = false, provider = "claude", delayMs = 0 } = {}) {
  const sends = [];
  const driver = {
    closed,
    async send(message) {
      sends.push({ method: "send", message });
    },
    async notifyTaskComplete(message) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      sends.push({ method: "notifyTaskComplete", message });
    },
  };
  return {
    agent: {
      provider,
      status: "finished",
      driver,
      lastActivity: 1000,
      lastExitCode: null,
      lastExitedAt: null,
      exitCode: null,
      exitedAt: 1200,
      waitReported: true,
      turnCompleted: true,
      bgTaskResumeObservedAt: 2000,
      bgTaskResumeSentAt: undefined,
      bgTaskResumeInFlight: false,
    },
    sends,
  };
}

await test("Claude bg-task completion after turn finish resumes exactly once", async () => {
  const line = JSON.stringify({ type: "task_notification", status: "completed" });
  assert.equal(isClaudeBackgroundWakeLine(line), true);

  const { agent, sends } = makeAgent();
  assert.equal(await maybeResumeAfterBackgroundTask(agent, 2100), true);
  assert.equal(await maybeResumeAfterBackgroundTask(agent, 2200), false);

  assert.equal(sends.length, 1);
  assert.equal(sends[0].method, "notifyTaskComplete");
  assert.match(sends[0].message, /background task has completed/i);
  assert.equal(agent.status, "processing");
  assert.equal(agent.turnCompleted, false);
  assert.equal(agent.waitReported, false);
  assert.equal(agent.exitedAt, null);
});

await test("Claude bg-task completion does not resume exited agents", async () => {
  const { agent, sends } = makeAgent({ closed: true });
  assert.equal(await maybeResumeAfterBackgroundTask(agent, 2100), false);
  assert.equal(sends.length, 0);
  assert.equal(agent.status, "finished");
  assert.equal(agent.turnCompleted, true);
});

await test("Claude bg-task completion concurrent watchdog/event paths do not double-resume", async () => {
  const { agent, sends } = makeAgent({ delayMs: 25 });
  const results = await Promise.all([
    maybeResumeAfterBackgroundTask(agent, 2100),
    maybeResumeAfterBackgroundTask(agent, 2100),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(sends.length, 1);
});

await test("non-Claude agents are ignored", async () => {
  const { agent, sends } = makeAgent({ provider: "codex" });
  assert.equal(await maybeResumeAfterBackgroundTask(agent, 2100), false);
  assert.equal(sends.length, 0);
});

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
