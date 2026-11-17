import { type CostOptions, type ModelRow, formatInt, formatRate, formatUSD } from "./core.js";

const useColor = !process.env["NO_COLOR"] && process.stdout.isTTY === true;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = paint(2);
const bold = paint(1);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);

// ANSI-aware padding
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
const padEnd = (s: string, n: number) => s + " ".repeat(Math.max(0, n - visible(s)));
const padStart = (s: string, n: number) => " ".repeat(Math.max(0, n - visible(s))) + s;

export interface Summary {
  label: string;
  files: number;
  chars: number;
  tokens: number;
  pricesDate: string;
  pricesFromCache: boolean;
  skipped?: { binary: number; excluded: number; tooBig: number };
}

export interface FileStat {
  label: string;
  tokens: number;
}

export function formatReceipt(
  s: Summary,
  rows: ModelRow[],
  opts: CostOptions,
  perFile?: FileStat[],
): string {
  const calls = opts.calls ?? 1;
  const L: string[] = [];
  const date = s.pricesDate.slice(0, 10);
  L.push(`${bold("tokn")}  ${dim("·")}  ${s.label}${" ".repeat(4)}${dim(`prices ${date}${s.pricesFromCache ? "" : " (bundled)"}`)}`);
  L.push("");
  const parts = [`${bold(formatInt(s.tokens))} tokens`, `${formatInt(s.chars)} chars`];
  if (s.files > 1) parts.push(`${formatInt(s.files)} files`);
  L.push(parts.join(dim(" · ")));
  if (opts.out) L.push(dim(`per call: input + ${formatInt(opts.out)} output tokens${opts.cached ? " · cached input pricing" : ""}`));
  else if (opts.cached) L.push(dim("cached input pricing"));
  L.push("");

  const head = ["MODEL", "TOKENS", "$/1M IN", opts.out ? "$/1M OUT" : null, "PER CALL", calls > 1 ? `× ${formatInt(calls)}` : null, "CONTEXT"]
    .filter((h): h is string => h !== null);
  const body = rows.map((r) => {
    const fits =
      r.contextUsed === undefined
        ? dim("?")
        : r.contextUsed > 1
          ? red("✖ too big")
          : r.contextUsed > 0.8
            ? yellow(pct(r.contextUsed))
            : green(pct(r.contextUsed));
    const cells = [
      r.model,
      (r.exact ? "" : dim("≈")) + formatInt(r.tokens),
      formatRate(r.inputPer1M),
      opts.out ? formatRate(r.outputPer1M) : null,
      bold(formatUSD(r.cost)),
      calls > 1 ? formatUSD(r.total) : null,
      fits,
    ];
    return cells.filter((c): c is string => c !== null);
  });

  const widths = head.map((h, i) => Math.max(visible(h), ...body.map((b) => visible(b[i]!))));
  const line = (cells: string[]) =>
    "  " + cells.map((c, i) => (i === 0 ? padEnd(c, widths[i]!) : padStart(c, widths[i]!))).join("   ");
  L.push(dim(line(head)));
  L.push(dim("  " + "─".repeat(widths.reduce((a, w) => a + w, 0) + 3 * (widths.length - 1))));
  for (const b of body) L.push(line(b));

  if (rows.length) {
    const cheapest = rows.reduce((a, b) => (b.cost < a.cost ? b : a));
    const priciest = rows.reduce((a, b) => (b.cost > a.cost ? b : a));
    if (priciest.cost > 0 && cheapest !== priciest) {
      const x = priciest.cost / Math.max(cheapest.cost, 1e-12);
      L.push("");
      L.push(dim(`  cheapest: ${cheapest.model} · ${x >= 10 ? Math.round(x) : x.toFixed(1)}× cheaper than ${priciest.model}`));
    }
  }

  if (perFile?.length) {
    L.push("", bold("Biggest files"));
    const top = perFile.slice(0, 15);
    const max = top[0]!.tokens || 1;
    const w = Math.max(...top.map((f) => f.label.length));
    for (const f of top) {
      const bar = "█".repeat(Math.max(1, Math.round((f.tokens / max) * 20)));
      const share = s.tokens ? pct(f.tokens / s.tokens) : "0%";
      L.push(`  ${padEnd(f.label, w)}  ${padStart(formatInt(f.tokens), 9)}  ${padStart(share, 4)}  ${dim(bar)}`);
    }
    if (perFile.length > top.length) L.push(dim(`  … and ${perFile.length - top.length} more`));
  }

  const notes: string[] = [];
  if (rows.some((r) => !r.exact)) {
    notes.push("≈ estimated with OpenAI's tokenizer (Claude/Gemini tokenizers aren't public). Add --exact for real counts.");
  }
  const sk = s.skipped;
  if (sk && sk.binary + sk.excluded + sk.tooBig > 0) {
    const bits = [
      sk.binary && `${sk.binary} binary`,
      sk.excluded && `${sk.excluded} lockfiles/minified/excluded`,
      sk.tooBig && `${sk.tooBig} over 5 MB`,
    ].filter(Boolean);
    notes.push(`skipped ${bits.join(", ")}`);
  }
  if (notes.length) L.push("", ...notes.map((n) => dim("  " + n)));
  return L.join("\n");
}

function pct(x: number): string {
  if (x > 0 && x < 0.01) return "<1%";
  return `${Math.round(x * 100)}%`;
}
