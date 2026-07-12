export const TAG_TEMPLATE =
  '<subagent-mcp state="{{state}}" kind="{{kind}}" phase="{{phase}}" utilization="{{utilization}}">';

export const FOOTER_TEMPLATE = "Remaining Context={{remaining}}%";

export type TemplateVars = Record<string, string>;

export interface TagTemplateVars extends TemplateVars {
  state: string;
  kind: string;
  phase: string;
  utilization: string;
}

const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;
const UNRESOLVED_PLACEHOLDER = /\{\{[a-zA-Z0-9_]+\}\}/;

export function renderTemplate(template: string, vars: TemplateVars): string {
  const rendered = template.replace(PLACEHOLDER, (token, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(`Missing template variable: ${name}`);
    }
    return vars[name] ?? "";
  });

  if (UNRESOLVED_PLACEHOLDER.test(rendered)) {
    throw new Error("Rendered template contains unresolved placeholder");
  }

  return rendered;
}

export function composeTag(vars: TagTemplateVars): string {
  // Test-only seam: SUBAGENT_MCP_TEST_TAG_TEMPLATE overrides the tag template so a malformed value forces a throw (mission item 5 fail-safe: any template error => inject nothing). Unset in production.
  const template = process.env.SUBAGENT_MCP_TEST_TAG_TEMPLATE ?? TAG_TEMPLATE;
  return renderTemplate(template, vars);
}

export function composeFooter(remainingPct: number | null): string {
  if (remainingPct === null) return "";
  if (!Number.isFinite(remainingPct)) {
    throw new Error("Invalid remaining context percentage");
  }
  return renderTemplate(FOOTER_TEMPLATE, {
    remaining: String(Math.round(remainingPct)),
  });
}
