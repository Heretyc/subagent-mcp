import type { ApiProvider } from "./types.js";

type JsonObj = Record<string, unknown>;

export interface HeadProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ApiProviderRequest {
  messages: unknown[];
  tools?: unknown[];
  temperature?: number;
  max_tokens?: number;
}

export interface ApiProviderResponse {
  provider: string;
  model: string;
  text: string;
  raw: unknown;
}

interface ProviderClientDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const API_PROVIDER_TIMEOUT_MS = 120_000;

function endpoint(baseUrl: string, path: string): string {
  // The client appends the versioned path (/v1/...) itself, so tolerate a
  // base_url that already carries a trailing /v1 (the OpenAI-SDK convention
  // and the natural shape of most providers' documented endpoints) instead
  // of double-appending it into /v1/v1/... -> 404.
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${root}${path}`;
}

function missingKey(provider: ApiProvider): Error {
  return new Error(`SUBAGENT_MCP_ERROR: provider ${provider.name} key_env ${provider.key_env} not set in ~/.subagent-mcp/.env`);
}

function badUrl(provider: ApiProvider, detail: string): Error {
  return new Error(
    `SUBAGENT_MCP_ERROR: provider ${provider.name} base_url ${provider.base_url} unreachable — edit ~/.subagent-mcp/providers.jsonc or check network (${detail})`
  );
}

function notFound404(provider: ApiProvider, url: string, raw: unknown): Error {
  // A 404 is ambiguous: wrong model, or wrong base_url/path. Distinguish by
  // the response body so the message points at the right knob instead of
  // always blaming the model.
  const body = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  const hint = /model/i.test(body)
    ? `model ${provider.model} not found — edit ~/.subagent-mcp/providers.jsonc model`
    : `endpoint ${url} returned 404 — check ~/.subagent-mcp/providers.jsonc base_url`;
  return new Error(`SUBAGENT_MCP_ERROR: provider ${provider.name} ${hint} (body: ${body.slice(0, 200)})`);
}

function authHeaders(provider: ApiProvider): HeadersInit {
  const key = process.env[provider.key_env];
  if (!key) throw missingKey(provider);
  return {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
    ...(provider.api_style === "claude" ? { "anthropic-version": "2023-06-01" } : {}),
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as JsonObj).text === "string") return (part as JsonObj).text as string;
      return "";
    })
    .join("");
}

function normalizeOpenAi(provider: ApiProvider, raw: unknown): ApiProviderResponse {
  const root = raw && typeof raw === "object" ? raw as JsonObj : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as JsonObj : {};
  const message = first.message && typeof first.message === "object" ? first.message as JsonObj : {};
  return { provider: provider.name, model: provider.model, text: textFromContent(message.content), raw };
}

function normalizeClaude(provider: ApiProvider, raw: unknown): ApiProviderResponse {
  const root = raw && typeof raw === "object" ? raw as JsonObj : {};
  return { provider: provider.name, model: provider.model, text: textFromContent(root.content), raw };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return error.message;
  const code = (cause as Error & { code?: unknown }).code;
  return [error.message, typeof code === "string" ? code : "", cause.message].filter(Boolean).join(": ");
}

export async function callApiProvider(
  provider: ApiProvider,
  request: ApiProviderRequest,
  deps: ProviderClientDeps = {}
): Promise<ApiProviderResponse> {
  const url = provider.api_style === "openai"
    ? endpoint(provider.base_url, "/v1/chat/completions")
    : endpoint(provider.base_url, "/v1/messages");
  const body = {
    model: provider.model,
    temperature: request.temperature ?? 0.5,
    max_tokens: request.max_tokens ?? 4096,
    tools: request.tools ?? [],
    messages: request.messages,
  };

  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? API_PROVIDER_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let raw: unknown;
  try {
    response = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: authHeaders(provider),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    raw = await readJson(response);
  } catch (e) {
    throw badUrl(provider, controller.signal.aborted ? `timeout after ${timeoutMs}ms` : errorDetail(e));
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) throw notFound404(provider, url, raw);
  if (!response.ok) throw badUrl(provider, `status ${response.status}`);
  return provider.api_style === "openai" ? normalizeOpenAi(provider, raw) : normalizeClaude(provider, raw);
}

export async function probeProviderHead(
  baseUrl: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<HeadProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 3000);
  try {
    const response = await (deps.fetch ?? fetch)(baseUrl, {
      method: "HEAD",
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timeout);
  }
}
