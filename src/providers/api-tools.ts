export type JsonObject = Record<string, unknown>;

export interface ClaudeTool extends JsonObject {
  name: string;
  description?: string;
  input_schema?: JsonObject;
}

export interface OpenAiFunctionTool extends JsonObject {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: JsonObject;
  };
}

const EMPTY_PARAMETERS: JsonObject = { type: "object", properties: {} };
const CLAUDE_TOOL_TYPE = Symbol("claude_tool_type");

export function claudeToolToOpenAi(tool: ClaudeTool): OpenAiFunctionTool {
  const { input_schema, name, description, type: claudeType, ...rest } = tool;
  const converted: OpenAiFunctionTool = {
    ...rest,
    type: "function",
    function: {
      name,
      ...(description === undefined ? {} : { description }),
      parameters: input_schema ?? EMPTY_PARAMETERS,
    },
  };
  if (claudeType !== undefined) Object.defineProperty(converted, CLAUDE_TOOL_TYPE, { value: claudeType });
  return converted;
}

export function openAiToolToClaude(tool: OpenAiFunctionTool): ClaudeTool {
  const { function: fn, type: _type, ...rest } = tool;
  const claudeType = (tool as OpenAiFunctionTool & { [CLAUDE_TOOL_TYPE]?: unknown })[CLAUDE_TOOL_TYPE];
  return {
    ...rest,
    ...(claudeType === undefined ? {} : { type: claudeType }),
    name: fn.name,
    ...(fn.description === undefined ? {} : { description: fn.description }),
    input_schema: fn.parameters,
  };
}
