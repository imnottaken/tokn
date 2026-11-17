/**
 * Exact token counts from the providers' own counting endpoints. Both are
 * free to call; they just need an API key in the environment.
 */

type Fetch = typeof fetch;

export function exactSupported(provider: string): boolean {
  if (provider === "anthropic") return !!process.env["ANTHROPIC_API_KEY"];
  if (provider === "gemini") return !!(process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"]);
  return false;
}

export async function exactCount(
  provider: string,
  model: string,
  text: string,
  fetchImpl: Fetch = fetch,
): Promise<number> {
  if (provider === "anthropic") {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env["ANTHROPIC_API_KEY"] ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
    });
    if (!res.ok) throw new Error(`Anthropic count_tokens: HTTP ${res.status} ${await res.text()}`);
    return ((await res.json()) as { input_tokens: number }).input_tokens;
  }

  if (provider === "gemini") {
    const key = process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"] || "";
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:countTokens`,
      {
        method: "POST",
        // Key goes in a header, never the URL, so it can't leak into logs.
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
      },
    );
    if (!res.ok) throw new Error(`Gemini countTokens: HTTP ${res.status} ${await res.text()}`);
    return ((await res.json()) as { totalTokens: number }).totalTokens;
  }

  throw new Error(`no exact counter for provider "${provider}"`);
}
