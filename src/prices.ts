import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Community-maintained price list used by LiteLLM; updated within days of price changes. */
export const PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const PROVIDERS = new Set(["openai", "anthropic", "gemini", "deepseek", "xai", "mistral"]);

export interface ModelPrice {
  provider: string;
  /** USD per input token */
  input: number;
  /** USD per output token */
  output: number;
  /** USD per cached input token, when the provider offers prompt caching */
  cacheRead?: number;
  /** Max input tokens */
  context?: number;
}

export interface PriceBook {
  source: string;
  fetchedAt: string;
  models: Record<string, ModelPrice>;
}

interface RawEntry {
  mode?: string;
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  max_input_tokens?: number;
}

/** Trim LiteLLM's ~6k-entry file down to chat models from the main providers. */
export function trimPriceList(raw: Record<string, unknown>, fetchedAt = new Date().toISOString()): PriceBook {
  const models: Record<string, ModelPrice> = {};
  for (const [id, v] of Object.entries(raw)) {
    const e = v as RawEntry;
    if (!e || typeof e !== "object" || e.mode !== "chat") continue;
    if (!e.litellm_provider || !PROVIDERS.has(e.litellm_provider)) continue;
    if (!e.input_cost_per_token || !e.output_cost_per_token) continue; // skip free/unpriced
    const name = id.replace(/^(gemini|deepseek|xai|mistral|openai|anthropic)\//, "");
    if (models[name]) continue; // first spelling wins ("gemini/x" and "x" are the same model)
    models[name] = {
      provider: e.litellm_provider,
      input: e.input_cost_per_token,
      output: e.output_cost_per_token,
      ...(e.cache_read_input_token_cost ? { cacheRead: e.cache_read_input_token_cost } : {}),
      ...(e.max_input_tokens ? { context: e.max_input_tokens } : {}),
    };
  }
  return { source: PRICES_URL, fetchedAt, models };
}

export function cachePath(): string {
  const base = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(base, "tokn", "prices.json");
}

const SNAPSHOT = new URL("../data/prices.json", import.meta.url);

/** Prices from the user's refreshed cache if present, else the snapshot shipped with the package. */
export function loadPrices(): PriceBook & { fromCache: boolean } {
  const cache = cachePath();
  if (existsSync(cache)) {
    try {
      return { ...(JSON.parse(readFileSync(cache, "utf8")) as PriceBook), fromCache: true };
    } catch {
      /* corrupt cache: fall through to the snapshot */
    }
  }
  return { ...(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as PriceBook), fromCache: false };
}

export async function fetchPrices(): Promise<PriceBook> {
  const res = await fetch(PRICES_URL);
  if (!res.ok) throw new Error(`price list download failed: HTTP ${res.status}`);
  return trimPriceList((await res.json()) as Record<string, unknown>);
}

export async function refreshPrices(dest = cachePath()): Promise<PriceBook> {
  const book = await fetchPrices();
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(book, null, 1) + "\n");
  return book;
}

/** One sensible pick per tier per provider. Shown when no -m/--all is given. */
export const DEFAULT_MODELS = [
  "gpt-5.5",
  "gpt-5.4-mini",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "gemini-pro-latest",
  "gemini-flash-latest",
  "deepseek-v4-flash",
  "grok-4.7",
];

/**
 * Pick models: exact ids, or patterns with `*` (e.g. "claude-*", "*mini*").
 * A bare word with no `*` that isn't an exact id matches as a substring.
 */
export function selectModels(book: PriceBook, patterns: string[]): string[] {
  const ids = Object.keys(book.models);
  const out: string[] = [];
  for (const p of patterns) {
    if (book.models[p]) {
      out.push(p);
      continue;
    }
    const re = p.includes("*")
      ? new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i")
      : new RegExp(p.replace(/[.+?^${}()|[\]\\*]/g, "\\$&"), "i");
    out.push(...ids.filter((id) => re.test(id)));
  }
  return [...new Set(out)];
}
