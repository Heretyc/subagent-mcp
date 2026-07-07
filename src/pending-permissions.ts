import { randomUUID } from "node:crypto";

export type PermissionDecision = "allow" | "deny";
export type PendingPermissionState = "pending" | "answered" | "auto_answered" | "errored";

export interface PendingPermissionReply {
  request_id: string;
  agent_id: string;
  decision: PermissionDecision;
  reason?: string;
}

export type PendingPermissionResolver = (reply: PendingPermissionReply) => Promise<void> | void;

export interface PendingPermissionRequestInput {
  agent_id: string;
  harness_channel: string;
  tool_name_or_method: string;
  action: unknown;
  permission_ceiling?: "yolo" | "auto" | "manual";
  escalation?: "irreversible-only" | "off";
  irreversible?: boolean;
  reason?: string;
  suggestions?: unknown;
  correlation_id: string | number;
  resolve: PendingPermissionResolver;
}

export interface RequestPendingPermissionInput {
  agentId?: string;
  harnessChannel: string;
  toolNameOrMethod: string;
  action: unknown;
  permissionCeiling?: "yolo" | "auto" | "manual";
  escalation?: "irreversible-only" | "off";
  irreversible?: boolean;
  reason?: string;
  suggestions?: unknown;
  correlationId: string | number | null;
}

export interface RequestPendingPermissionResult {
  verdict: PermissionDecision;
  reason: string;
}

export interface PendingPermissionRecord {
  request_id: string;
  agent_id: string;
  harness_channel: string;
  tool_name_or_method: string;
  action: unknown;
  permission_ceiling?: "yolo" | "auto" | "manual";
  escalation?: "irreversible-only" | "off";
  irreversible?: boolean;
  escalate_to_human?: boolean;
  reason?: string;
  suggestions?: unknown;
  requested_at: number;
  correlation_id: string | number;
  state: PendingPermissionState;
  auto_answer_rule?: string;
  asked_count_for_this_agent: number;
  answered_at?: number;
  answer?: PermissionDecision;
  answer_reason?: string;
}

interface StoredPendingPermission extends PendingPermissionRecord {
  resolve: PendingPermissionResolver;
  timer: NodeJS.Timeout;
}

const PARK_TIMEOUT_MS = 5 * 60 * 1000;
const PER_AGENT_FIFO_CAP = 16;

function publicRecord(record: PendingPermissionRecord): PendingPermissionRecord {
  return { ...record };
}

function shouldEscalateToHuman(input: {
  permission_ceiling?: "yolo" | "auto" | "manual";
  escalation?: "irreversible-only" | "off";
  irreversible?: boolean;
}): boolean {
  return (
    input.permission_ceiling === "auto" &&
    input.escalation !== "off" &&
    input.irreversible === true
  );
}

export class PendingPermissionManager {
  private readonly pendingById = new Map<string, StoredPendingPermission>();
  private readonly pendingByAgent = new Map<string, string[]>();
  private readonly askedCountByAgent = new Map<string, number>();
  private readonly history: PendingPermissionRecord[] = [];
  private readonly queueListeners = new Set<(agentId: string, pendingCount: number) => void>();
  telemetry = {
    cap_overflow_auto_denies: 0,
    park_timeout_auto_denies: 0,
  };

  onAgentQueueChange(listener: (agentId: string, pendingCount: number) => void): () => void {
    this.queueListeners.add(listener);
    return () => this.queueListeners.delete(listener);
  }

  create(input: PendingPermissionRequestInput): PendingPermissionRecord {
    const queue = this.pendingByAgent.get(input.agent_id) ?? [];
    const asked = (this.askedCountByAgent.get(input.agent_id) ?? 0) + 1;
    this.askedCountByAgent.set(input.agent_id, asked);

    if (queue.length >= PER_AGENT_FIFO_CAP) {
      const record: PendingPermissionRecord = {
        request_id: randomUUID(),
        agent_id: input.agent_id,
        harness_channel: input.harness_channel,
        tool_name_or_method: input.tool_name_or_method,
        action: input.action,
        permission_ceiling: input.permission_ceiling,
        escalation: input.escalation,
        irreversible: input.irreversible,
        escalate_to_human: shouldEscalateToHuman(input),
        reason: input.reason,
        suggestions: input.suggestions,
        requested_at: Date.now(),
        correlation_id: input.correlation_id,
        state: "auto_answered",
        auto_answer_rule: "pending-queue cap reached",
        asked_count_for_this_agent: asked,
        answered_at: Date.now(),
        answer: "deny",
        answer_reason: "pending-queue cap reached",
      };
      this.telemetry.cap_overflow_auto_denies += 1;
      this.history.push(publicRecord(record));
      console.error(
        `[permissions] auto-deny ${record.request_id} for agent ${record.agent_id}: pending-queue cap reached`
      );
      void Promise.resolve(input.resolve({
        request_id: record.request_id,
        agent_id: record.agent_id,
        decision: "deny",
        reason: record.answer_reason,
      })).catch(() => {});
      return publicRecord(record);
    }

    const request_id = randomUUID();
    const record: StoredPendingPermission = {
      request_id,
      agent_id: input.agent_id,
      harness_channel: input.harness_channel,
      tool_name_or_method: input.tool_name_or_method,
      action: input.action,
      permission_ceiling: input.permission_ceiling,
      escalation: input.escalation,
      irreversible: input.irreversible,
      escalate_to_human: shouldEscalateToHuman(input),
      reason: input.reason,
      suggestions: input.suggestions,
      requested_at: Date.now(),
      correlation_id: input.correlation_id,
      state: "pending",
      asked_count_for_this_agent: asked,
      resolve: input.resolve,
      timer: setTimeout(() => {
        void this.autoDeny(request_id, "park-timeout: no decision within 5 minutes; auto-denied fail-closed");
      }, PARK_TIMEOUT_MS),
    };
    record.timer.unref();
    this.pendingById.set(request_id, record);
    this.pendingByAgent.set(input.agent_id, [...queue, request_id]);
    this.emitQueue(input.agent_id);
    return publicRecord(record);
  }

  pendingForAgent(agentId: string): PendingPermissionRecord[] {
    return (this.pendingByAgent.get(agentId) ?? [])
      .map((id) => this.pendingById.get(id))
      .filter((r): r is StoredPendingPermission => Boolean(r))
      .map(publicRecord);
  }

  pendingCount(agentId: string): number {
    return this.pendingByAgent.get(agentId)?.length ?? 0;
  }

  oldestPending(agentId: string): PendingPermissionRecord | null {
    const id = this.pendingByAgent.get(agentId)?.[0];
    const record = id ? this.pendingById.get(id) : null;
    return record ? publicRecord(record) : null;
  }

  async respond(
    agentId: string,
    requestId: string | undefined,
    decision: PermissionDecision,
    reason?: string
  ): Promise<PendingPermissionRecord> {
    const targetId = requestId ?? this.pendingByAgent.get(agentId)?.[0];
    if (!targetId) throw new Error(`agent ${agentId} has no pending permission requests`);
    const record = this.pendingById.get(targetId);
    if (!record || record.agent_id !== agentId) {
      throw new Error(`pending permission ${targetId} not found for agent ${agentId}`);
    }
    if (record.escalate_to_human === true && decision === "allow" && (!reason || reason.trim() === "")) {
      throw new Error("allowing an escalated human permission request requires a non-empty reason");
    }
    return this.finish(record, decision, reason);
  }

  async closeAgent(agentId: string, reason: string): Promise<PendingPermissionRecord[]> {
    const ids = [...(this.pendingByAgent.get(agentId) ?? [])];
    const closed: PendingPermissionRecord[] = [];
    for (const id of ids) {
      const record = this.pendingById.get(id);
      if (record) closed.push(await this.finish(record, "deny", reason));
    }
    return closed;
  }

  private async autoDeny(requestId: string, reason: string): Promise<void> {
    const record = this.pendingById.get(requestId);
    if (!record) return;
    this.telemetry.park_timeout_auto_denies += 1;
    console.error(`[permissions] auto-deny ${requestId} for agent ${record.agent_id}: ${reason}`);
    await this.finish(record, "deny", reason, "park-timeout");
  }

  private async finish(
    record: StoredPendingPermission,
    decision: PermissionDecision,
    reason?: string,
    autoRule?: string
  ): Promise<PendingPermissionRecord> {
    clearTimeout(record.timer);
    this.pendingById.delete(record.request_id);
    const queue = (this.pendingByAgent.get(record.agent_id) ?? []).filter((id) => id !== record.request_id);
    if (queue.length > 0) this.pendingByAgent.set(record.agent_id, queue);
    else this.pendingByAgent.delete(record.agent_id);

    record.state = autoRule ? "auto_answered" : "answered";
    record.auto_answer_rule = autoRule;
    record.answered_at = Date.now();
    record.answer = decision;
    record.answer_reason = reason;
    try {
      await record.resolve({
        request_id: record.request_id,
        agent_id: record.agent_id,
        decision,
        reason,
      });
    } catch (e) {
      record.state = "errored";
      record.answer_reason = e instanceof Error ? e.message : String(e);
    }
    this.history.push(publicRecord(record));
    this.emitQueue(record.agent_id);
    return publicRecord(record);
  }

  private emitQueue(agentId: string): void {
    const count = this.pendingCount(agentId);
    for (const listener of this.queueListeners) listener(agentId, count);
  }
}

export const pendingPermissionManager = new PendingPermissionManager();

export function requestPendingPermission(
  input: RequestPendingPermissionInput
): Promise<RequestPendingPermissionResult> {
  if (!input.agentId) {
    return Promise.resolve({
      verdict: "deny",
      reason: "permission request missing agent id; auto-denied fail-closed",
    });
  }
  const agentId = input.agentId;
  return new Promise((resolve) => {
    pendingPermissionManager.create({
      agent_id: agentId,
      harness_channel: input.harnessChannel,
      tool_name_or_method: input.toolNameOrMethod,
      action: input.action,
      permission_ceiling: input.permissionCeiling,
      escalation: input.escalation,
      irreversible: input.irreversible,
      reason: input.reason,
      suggestions: input.suggestions,
      correlation_id: input.correlationId ?? "unknown",
      resolve: (reply) =>
        resolve({
          verdict: reply.decision,
          reason: reply.reason ?? `permission ${reply.decision}`,
        }),
    });
  });
}
