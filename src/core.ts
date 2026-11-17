import type { ModelPrice, PriceBook } from "./prices.js";

export interface CostOptions {
  /** Expected output tokens per call */
  out?: number;
  /** Number of calls to total up */
  calls?: number;
  /** Price input at the cached rate where the provider has one */
  cached?: boolean;
}

export interface ModelRow {
  model: string;
  provider: string;
  tokens: number;
  /** true when tokens came from OpenAI's tokenizer or a provider API, false when estimated */
  exact: boolean;
  inputPer1M: number;
  outputPer1M: number;
  /** USD for one call */
  cost: number;
  /** USD for all calls */
  total: number;
  context?: number;
  /** Share of the context window this input uses, 0–1+ */
  contextUsed?: number;
}

export function priceRow(
  model: string,
  p: ModelPrice,
  tokens: number,
  exact: boolean,
  opts: CostOptions = {},
): ModelRow {
  const inRate = opts.cached && p.cacheRead ? p.cacheRead : p.input;
  const cost = tokens * inRate + (opts.out ?? 0) * p.output;
  const calls = opts.calls ?? 1;
  return {
    model,
    provider: p.provider,
    tokens,
    exact,
    inputPer1M: inRate * 1e6,
    outputPer1M: p.output * 1e6,
    cost,
    total: cost * calls,
    ...(p.context ? { context: p.context, contextUsed: tokens / p.context } : {}),
  };
}

export function buildRows(
  book: PriceBook,
  models: string[],
  openaiTokens: number,
  exactCounts: Map<string, number>,
  opts: CostOptions,
): ModelRow[] {
  return models.map((m) => {
    const p = book.models[m]!;
    const exact = exactCounts.get(m);
    const tokens = exact ?? openaiTokens;
    return priceRow(m, p, tokens, exact !== undefined || p.provider === "openai", opts);
  });
}

export function formatUSD(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 0.01) return "$" + n.toFixed(3);
  // Tiny amounts: plain decimals with two significant digits, never 7e-7 notation.
  const decimals = Math.min(12, Math.ceil(-Math.log10(n)) + 1);
  return "$" + n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

/** Per-million rates read best as plain dollars and cents. */
export function formatRate(n: number): string {
  return n >= 0.01 ? "$" + n.toFixed(2) : formatUSD(n);
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}
