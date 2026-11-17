import assert from "node:assert/strict";
import { test } from "node:test";
import { countTokens, formatUSD, priceRow, selectModels, trimPriceList } from "../dist/index.js";

test("counts tokens with o200k_base", () => {
  assert.equal(countTokens(""), 0);
  assert.equal(countTokens("hello world"), 2);
  assert.ok(countTokens("नमस्ते दुनिया") > 2);
});

test("special-token text is counted, not rejected", () => {
  assert.ok(countTokens("before <|endoftext|> after") > 3);
});

test("cost math: input, output, calls, cached", () => {
  const p = { provider: "openai", input: 5e-6, output: 3e-5, cacheRead: 5e-7, context: 1_000_000 };
  const r = priceRow("m", p, 100_000, true, { out: 1_000, calls: 1_000 });
  assert.equal(r.cost, 100_000 * 5e-6 + 1_000 * 3e-5); // $0.53
  assert.equal(r.total, r.cost * 1_000);
  assert.equal(r.contextUsed, 0.1);
  assert.equal(r.inputPer1M, 5);

  const cached = priceRow("m", p, 100_000, true, { cached: true });
  assert.equal(cached.cost, 100_000 * 5e-7);
  assert.ok(Math.abs(cached.inputPer1M - 0.5) < 1e-9);

  const noCache = priceRow("m", { ...p, cacheRead: undefined }, 10, true, { cached: true });
  assert.equal(noCache.cost, 10 * 5e-6, "falls back to the normal rate when there's no cache price");
});

test("money formatting never uses exponent notation", () => {
  assert.equal(formatUSD(0), "$0");
  assert.equal(formatUSD(7e-7), "$0.0000007");
  assert.equal(formatUSD(1.4e-5), "$0.000014");
  assert.equal(formatUSD(0.054), "$0.054");
  assert.equal(formatUSD(1234.5), "$1,234.50");
});

const RAW = {
  "gpt-x": { mode: "chat", litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: 2e-6, max_input_tokens: 1000 },
  "gemini/gemini-y": { mode: "chat", litellm_provider: "gemini", input_cost_per_token: 3e-7, output_cost_per_token: 1e-6 },
  "gemini-y": { mode: "chat", litellm_provider: "vertex_ai", input_cost_per_token: 9, output_cost_per_token: 9 },
  "claude-z": { mode: "chat", litellm_provider: "anthropic", input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5, cache_read_input_token_cost: 3e-7 },
  "free-model": { mode: "chat", litellm_provider: "gemini", input_cost_per_token: 0, output_cost_per_token: 0 },
  "embed": { mode: "embedding", litellm_provider: "openai", input_cost_per_token: 1e-7, output_cost_per_token: 0 },
  "bedrock/claude-z": { mode: "chat", litellm_provider: "bedrock", input_cost_per_token: 1, output_cost_per_token: 1 },
  sample_spec: { note: "not a model" },
};

test("price list trimming keeps priced chat models from main providers", () => {
  const book = trimPriceList(RAW, "2026-01-01T00:00:00Z");
  assert.deepEqual(Object.keys(book.models).sort(), ["claude-z", "gemini-y", "gpt-x"]);
  assert.equal(book.models["gemini-y"].provider, "gemini", "provider prefix stripped, other providers ignored");
  assert.equal(book.models["claude-z"].cacheRead, 3e-7);
  assert.equal(book.models["gpt-x"].context, 1000);
});

test("model selection: exact, glob, substring", () => {
  const book = trimPriceList(RAW);
  assert.deepEqual(selectModels(book, ["gpt-x"]), ["gpt-x"]);
  assert.deepEqual(selectModels(book, ["claude-*"]), ["claude-z"]);
  assert.deepEqual(selectModels(book, ["*-y"]), ["gemini-y"]);
  assert.deepEqual(selectModels(book, ["CLAUDE"]), ["claude-z"], "bare words match as case-insensitive substrings");
  assert.deepEqual(selectModels(book, ["nope"]), []);
});
