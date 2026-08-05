import { z } from "zod";
import type { PersonaSettings, SettingSource } from "./concurrency.js";

/**
 * Wire schema of launch_agent's agent_definition parameter, the single source
 * of truth for the shape (the launch_agent zod params reuse it and the wire
 * type is inferred from it). `model` is deliberately absent and `.strict()`
 * rejects it: inline persona definitions must not pin models, so routing and
 * model-selection-mode keep sole ownership of model choice.
 */
export const wireAgentDefinitionSchema = z
  .object({
    description: z.string().min(1),
    prompt: z.string().min(1),
    tools: z.array(z.string()).optional(),
    disallowed_tools: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  })
  .strict();

export type WireAgentDefinition = z.infer<typeof wireAgentDefinitionSchema>;

/** SDK-facing agent definition (camelCase, still without model). */
export interface SdkAgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
}

export interface PersonaLaunchParams {
  provider?: string;
  agent?: string;
  agentDefinition?: WireAgentDefinition;
  systemPromptAppend?: string;
}

export function hasPersonaParams(params: PersonaLaunchParams): boolean {
  return (
    params.agent !== undefined ||
    params.agentDefinition !== undefined ||
    params.systemPromptAppend !== undefined
  );
}

/** Maps the snake_case wire definition onto the SDK's camelCase shape. */
export function mapAgentDefinition(def: WireAgentDefinition): SdkAgentDefinition {
  const mapped: SdkAgentDefinition = {
    description: def.description,
    prompt: def.prompt,
  };
  if (def.tools !== undefined) mapped.tools = def.tools;
  if (def.disallowed_tools !== undefined) mapped.disallowedTools = def.disallowed_tools;
  if (def.skills !== undefined) mapped.skills = def.skills;
  return mapped;
}

function loadsFromDisk(sources: SettingSource[]): boolean {
  return sources.includes("project") || sources.includes("user");
}

/**
 * Validates the persona-related launch_agent parameters against the user's
 * persona settings. Returns an error string to surface verbatim, or null when
 * the launch may proceed.
 */
export function validatePersonaParams(
  settings: PersonaSettings,
  params: PersonaLaunchParams
): string | null {
  if (!hasPersonaParams(params)) return null;
  if (settings.personaMode !== "enabled") {
    return (
      "persona parameters (agent, agent_definition, system_prompt_append) are disabled: " +
      "persona mode is off. Enable it explicitly with the configure tool " +
      "(set user.personaMode to \"enabled\"); this opt-in is the user prescription " +
      "required by the safety scope for persona sub-agents."
    );
  }
  if (params.provider === "codex") {
    return (
      "persona parameters are not supported with provider \"codex\": the Codex " +
      "path has no persona equivalent, and silently ignoring them would launch a " +
      "different agent than requested. Omit provider to route to Claude, or drop " +
      "the persona parameters."
    );
  }
  if (params.agentDefinition !== undefined && params.agent === undefined) {
    return (
      "agent_definition requires agent: the definition is registered under the " +
      "agent name, and the name selects it for the sub-agent's main thread."
    );
  }
  if (params.systemPromptAppend !== undefined && params.agent !== undefined) {
    return (
      "system_prompt_append cannot be combined with agent: the SDK applies the " +
      "selected agent's own system prompt to the main thread, which leaves the " +
      "preset append undefined and could silently drop it. Fold the extra text " +
      "into the agent definition's prompt instead."
    );
  }
  if (
    params.agent !== undefined &&
    params.agentDefinition === undefined &&
    !loadsFromDisk(settings.settingSources)
  ) {
    return (
      "agent without agent_definition needs an on-disk source: the named persona " +
      "must load from .claude/agents/, which requires user.settingSources (configure " +
      "tool) to include \"project\" or \"user\". Add an inline agent_definition instead " +
      "to keep filesystem isolation."
    );
  }
  return null;
}
