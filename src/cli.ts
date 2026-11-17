#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type Source, collect, readStdin } from "./collect.js";
import { type CostOptions, buildRows } from "./core.js";
import { exactCount, exactSupported } from "./exact.js";
import { DEFAULT_MODELS, loadPrices, refreshPrices, selectModels } from "./prices.js";
import { type FileStat, formatReceipt } from "./report.js";
import { countTokens } from "./tokenize.js";

const HELP = `tokn: count tokens and price a prompt, file or whole repo across LLMs

Usage
  tokn <file|dir...> [options]
  cat prompt.md | tokn
  tokn -t "some text"

Options
  -m, --models <list>   Comma-separated ids or patterns: "gpt-5.5,claude-*,*flash*"
  -a, --all             Every known chat model
  -o, --out <n>         Add expected output tokens per call to the cost
  -n, --calls <n>       Also show the total for n calls (e.g. 1000)
      --cached          Use cached-input prices where available
  -f, --files           Show the biggest files (for directories)
  -x, --exclude <globs> Skip paths, e.g. "test/**,*.snap"
  -t, --text <text>     Count a string instead of files
      --exact           Ask Anthropic/Gemini for exact counts (needs ANTHROPIC_API_KEY / GEMINI_API_KEY)
      --refresh         Download the latest prices, then continue
      --list            List known models and prices
      --json            Machine-readable output
  -h, --help            Show help
  -v, --version         Show version

Prices come from LiteLLM's public price list. tokn ships a snapshot;
--refresh fetches today's prices into ~/.cache/tokn.`;

function version(): string {
  const pkg = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

function int(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.replace(/[_,]/g, ""));
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number, got "${v}"`);
  return n;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      models: { type: "string", short: "m", multiple: true },
      all: { type: "boolean", short: "a" },
      out: { type: "string", short: "o" },
      calls: { type: "string", short: "n" },
      cached: { type: "boolean" },
      files: { type: "boolean", short: "f" },
      exclude: { type: "string", short: "x", multiple: true },
      text: { type: "string", short: "t" },
      exact: { type: "boolean" },
      refresh: { type: "boolean" },
      list: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.help) return console.log(HELP), 0;
  if (values.version) return console.log(version()), 0;

  const opts: CostOptions = {
    out: int("out", values.out),
    calls: int("calls", values.calls),
    cached: values.cached ?? false,
  };

  if (values.refresh) {
    const book = await refreshPrices();
    console.error(`Updated prices for ${Object.keys(book.models).length} models.`);
  }
  const book = loadPrices();
  const split = (xs?: string[]) => (xs ?? []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);

  let models = values.all
    ? Object.keys(book.models)
    : selectModels(book, split(values.models).length ? split(values.models) : DEFAULT_MODELS);

  if (values.list) {
    const ids = values.models ? models : Object.keys(book.models);
    for (const id of ids.sort()) {
      const p = book.models[id]!;
      console.log(`${id.padEnd(44)} ${p.provider.padEnd(10)} in $${(p.input * 1e6).toFixed(2)}/1M  out $${(p.output * 1e6).toFixed(2)}/1M  ${p.context ? `ctx ${p.context.toLocaleString("en-US")}` : ""}`);
    }
    return 0;
  }
  if (models.length === 0) {
    console.error(`tokn: no models match ${split(values.models).join(", ")}. Try tokn --list.`);
    return 2;
  }

  // Gather input.
  let sources: Source[];
  let label: string;
  let skipped;
  if (values.text !== undefined) {
    sources = [{ label: "text", text: values.text }];
    label = "text";
  } else if (positionals.length) {
    const r = collect(positionals, split(values.exclude));
    sources = r.sources;
    skipped = r.skipped;
    label = positionals.length === 1 ? positionals[0]! : `${positionals.length} paths`;
  } else if (!process.stdin.isTTY) {
    sources = [{ label: "stdin", text: await readStdin() }];
    label = "stdin";
  } else {
    console.log(HELP);
    return 2;
  }

  const perFile: FileStat[] = sources.map((s) => ({ label: s.label, tokens: countTokens(s.text) }));
  const tokens = perFile.reduce((a, f) => a + f.tokens, 0);
  const chars = sources.reduce((a, s) => a + s.text.length, 0);

  // Optional exact counts from provider APIs, one call per provider/model.
  const exactCounts = new Map<string, number>();
  if (values.exact) {
    const all = sources.map((s) => s.text).join("\n\n");
    const wanted = models.filter((m) => exactSupported(book.models[m]!.provider));
    if (wanted.length === 0) {
      console.error("tokn: --exact needs ANTHROPIC_API_KEY or GEMINI_API_KEY (OpenAI counts are already exact).");
    }
    await Promise.all(
      wanted.map(async (m) => {
        try {
          exactCounts.set(m, await exactCount(book.models[m]!.provider, m, all));
        } catch (err) {
          console.error(`tokn: exact count for ${m} failed, using estimate (${(err as Error).message.slice(0, 120)})`);
        }
      }),
    );
  }

  const rows = buildRows(book, models, tokens, exactCounts, opts).sort((a, b) => a.cost - b.cost);

  if (values.json) {
    console.log(JSON.stringify({
      tokens, chars, files: sources.length,
      prices: { fetchedAt: book.fetchedAt, source: book.source, fromCache: book.fromCache },
      models: rows,
      ...(values.files ? { files_by_tokens: [...perFile].sort((a, b) => b.tokens - a.tokens) } : {}),
    }, null, 2));
    return 0;
  }

  console.log(
    formatReceipt(
      { label, files: sources.length, chars, tokens, pricesDate: book.fetchedAt, pricesFromCache: book.fromCache, ...(skipped ? { skipped } : {}) },
      rows,
      opts,
      values.files ? [...perFile].sort((a, b) => b.tokens - a.tokens) : undefined,
    ),
  );
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (err: Error & { code?: string }) => {
    const msg = err.code === "ENOENT" ? `no such file or directory: ${(err as { path?: string }).path}` : err.message;
    console.error(`tokn: ${msg}`);
    process.exitCode = err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? 2 : 1;
  },
);
