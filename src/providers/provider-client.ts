export interface HeadProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
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
