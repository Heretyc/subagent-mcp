// Pure helpers + frozen text for the `launch_agent` `sub-orchestrator: true`
// flag. Spec: docs/spec/swarm/_INDEX.md (sub-orchestrator contract).
//
// A sub-orchestrator is a child agent that runs as a delegate-only orchestrator
// for exactly ONE disjoint section of a larger plan. Enforcement is a pair:
// the env marker SUBAGENT_MCP_SUB_ORCHESTRATOR=1 (read by the server ctor, the
// per-turn hook, and respond_permission) plus the prompt directive inserted
// below the parent-process marker by applySubOrchestratorDirective.
//
// ANTI-INHERITANCE: the flag is depth-0 only and buildChildEnv (src/index.ts)
// strips the marker from every child env that this launch does not explicitly
// flag, so a sub-orchestrator's own workers are NORMAL sub-agents and no
// grandchild can inherit orchestration. No fs, no timers, no state here.

export const SUB_ORCHESTRATOR_ENV = "SUBAGENT_MCP_SUB_ORCHESTRATOR";

export const SUB_ORCHESTRATOR_DIRECTIVE = [
  "<sub-orchestrator directive from the parent orchestrator>",
  "You are a SUB-ORCHESTRATOR: a delegate-only orchestrator for exactly ONE disjoint section of a larger plan, operating under the same rules as a main orchestrator with orchestration mode ON. The parent-process marker above does NOT exempt you from orchestration; env SUBAGENT_MCP_SUB_ORCHESTRATOR=1 binds this session ON.",
  "- Sole instruction-intake exception: you may directly read the ONE plan file whose path this prompt names; reading it grants no task-side action authority. All other reads follow the ladder below.",
  "- Run your section by DELEGATION ONLY: every action step runs in a sub-agent launched via the subagent-mcp launch_agent tool. No inline task work; harness-native Task/Agent tools are forbidden.",
  "- Your sub-agents are NORMAL workers: NEVER set sub-orchestrator: true. Spawn depth is code-capped 2 levels below the main orchestrator, so your workers cannot spawn further.",
  "- Reads: poll_agent tail first; if insufficient, ONE summarizer sub-agent returning <=100 lines, trusted as-is. Move large data between workers via scratch files under the temp dir; assign the paths in prompts and never read those files yourself.",
  "- Serialize sub-agents that write the same files; never run concurrent writers over overlapping paths. Learn completion via the wait tool on loop; an empty or stalled tail means the agent is ALIVE.",
  "- Model selection stays smart/auto: do not pass provider/model/effort. Do NOT call swarm and do NOT write handoffs; stage reporting belongs to the main orchestrator.",
  "- Stay inside your section's boundaries. If the plan is impossible or conflicts with repo safety rules, stop and return the blocker in your summary instead of improvising outside scope.",
  "- Finish by returning JSON: {status, summary, source_locators, risks, writes_requested}.",
  "</sub-orchestrator directive>",
].join("\n");

// Literal open-tag line of the directive; derived so the idempotence probe can
// never drift from the directive text itself.
const DIRECTIVE_OPEN_LINE = SUB_ORCHESTRATOR_DIRECTIVE.slice(
  0,
  SUB_ORCHESTRATOR_DIRECTIVE.indexOf("\n")
);

function firstLineOf(text: string): string {
  const nl = text.indexOf("\n");
  const line = nl === -1 ? text : text.slice(0, nl);
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// Insert the sub-orchestrator directive directly BELOW the parent-process
// marker line, keeping the marker as the literal first line (launch_agent runs
// ensureParentMarker first, and test/launch-agent-upsert pins marker-first).
// - Directive occupies lines 2..n, followed by one blank line, then the
//   original prompt body VERBATIM (never mutated).
// - Idempotent on the literal open-tag line: re-applying returns the prompt
//   unchanged rather than stacking a second directive block.
export function applySubOrchestratorDirective(promptWithMarker: string): string {
  const nl = promptWithMarker.indexOf("\n");
  const markerLine = nl === -1 ? promptWithMarker : promptWithMarker.slice(0, nl);
  const body = nl === -1 ? "" : promptWithMarker.slice(nl + 1);
  if (firstLineOf(body) === DIRECTIVE_OPEN_LINE) return promptWithMarker;
  return markerLine + "\n" + SUB_ORCHESTRATOR_DIRECTIVE + "\n\n" + body;
}

// True only for a sub-orchestrator session: the child marker AND the
// sub-orchestrator marker. SUBAGENT_MCP_SUBAGENT=1 stays load-bearing (depth
// accounting, worktree carve-out, pretool handling); only the hook-skip
// consequence of the first-line exemption is overridden.
export function isSubOrchestratorEnv(env: NodeJS.ProcessEnv): boolean {
  return env.SUBAGENT_MCP_SUBAGENT === "1" && env[SUB_ORCHESTRATOR_ENV] === "1";
}

export const SUB_ORCH_PARAM_GLOSS =
  "Launch this child as a SUB-ORCHESTRATOR: the server injects a delegate-only orchestration directive into the prompt and sets env SUBAGENT_MCP_SUB_ORCHESTRATOR=1, forcing orchestration-mode behavior ON for that agent. The child's OWN sub-agents are NOT bound by the flag - it never inherits (the server strips the marker from grandchildren). Available to the MAIN orchestrator only (depth 0); deeper launches are rejected because a sub-orchestrator's workers cannot spawn further under the 2-level depth cap. Intended use: the swarm workflow's dispatch stage, exactly one sub-orchestrator per plan file path, each on a disjoint section. Omitting or false = normal sub-agent.";

export const SUB_ORCH_DEPTH_ERROR = (depth: number): string =>
  `Error: sub-orchestrator: true is only available to the main orchestrator (depth 0). Current SUBAGENT_MCP_DEPTH=${depth}: a sub-orchestrator launched from this depth could not delegate, because the 2-level spawn cap leaves its workers unable to run. Relaunch this agent as a normal sub-agent (omit sub-orchestrator).`;
