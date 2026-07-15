import { join } from "node:path";

import { getConfigHome } from "./config-home.js";
import { parseJsoncFile } from "./jsonc.js";

export interface RoutingDecision {
  category: string;
  provider: string;
  timestamp: string;
  elapsed_ms: number;
}

export interface SessionStatus {
  providers_loaded: string[];
  agent_count: number;
  session_start_time: string | null;
  last_routing_decisions: RoutingDecision[];
}

let providersLoaded = loadProvidersFromConfigHome(getConfigHome());
let agentCount = 0;
let sessionStartTime: string | null = new Date().toISOString();
let lastRoutingDecisions: RoutingDecision[] = [];

export function loadProvidersFromConfigHome(configHome: string): string[] {
  const parsed = parseJsoncFile(join(configHome, "providers.jsonc"));
  if (!parsed.ok) return [];
  const providers = parsed.json.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return [];
  return Object.keys(providers);
}

export function incrementAgentCount(): void {
  agentCount += 1;
}

export function recordRoutingDecision(decision: Omit<RoutingDecision, "timestamp">): void {
  lastRoutingDecisions = [
    ...lastRoutingDecisions,
    { ...decision, timestamp: new Date().toISOString() },
  ].slice(-10);
}

export function getStatus(): SessionStatus {
  return {
    providers_loaded: [...providersLoaded],
    agent_count: agentCount,
    session_start_time: sessionStartTime,
    last_routing_decisions: lastRoutingDecisions.map((d) => ({ ...d })),
  };
}

export function resetStatusForTests(status?: Partial<SessionStatus>): void {
  providersLoaded = status?.providers_loaded ?? [];
  agentCount = status?.agent_count ?? 0;
  sessionStartTime = status?.session_start_time ?? null;
  lastRoutingDecisions = status?.last_routing_decisions ?? [];
}
