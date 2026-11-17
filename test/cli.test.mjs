import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collect, exactCount } from "../dist/index.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
// Point the price cache at an empty dir so tests always use the bundled snapshot.
const ENV = { ...process.env, XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "tokn-cache-")), NO_COLOR: "1" };
const run = (args, input) => spawnSync("node", [CLI, ...args], { encoding: "utf8", env: ENV, input });

function project(files, { git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tokn-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  if (git) {
    execFileSync("git", ["-C", root, "init", "-q"]);
  }
  return root;
}

test("--text with --json", () => {
  const r = run(["-t", "hello world", "--json", "-m", "gpt-5.5"]);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.tokens, 2);
  assert.equal(j.models.length, 1);
  assert.equal(j.models[0].model, "gpt-5.5");
  assert.equal(j.models[0].exact, true);
  assert.ok(j.models[0].cost > 0);
});

test("stdin input", () => {
  const r = run(["--json", "-m", "gpt-5.5"], "hello world");
  assert.equal(JSON.parse(r.stdout).tokens, 2);
});

test("non-OpenAI models are marked as estimates", () => {
  const j = JSON.parse(run(["-t", "hi", "--json", "-m", "claude-opus-5-5"]).stdout);
  assert.equal(j.models[0].exact, false);
});

test("default model set renders a receipt sorted cheapest first", () => {
  const r = run(["-t", "The quick brown fox jumps over the lazy dog"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /tokens · \d+ chars/);
  assert.match(r.stdout, /cheapest: /);
  const j = JSON.parse(run(["-t", "x".repeat(500), "--json"]).stdout);
  const costs = j.models.map((m) => m.cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
  assert.ok(j.models.length >= 5);
});

test("--out and --calls change the math", () => {
  const base = JSON.parse(run(["-t", "hello world", "--json", "-m", "gpt-5.5"]).stdout).models[0];
  const more = JSON.parse(run(["-t", "hello world", "--json", "-m", "gpt-5.5", "-o", "1000", "-n", "10"]).stdout).models[0];
  assert.ok(more.cost > base.cost);
  assert.ok(Math.abs(more.total - more.cost * 10) < 1e-12);
});

test("directories respect .gitignore and skip lockfiles and binaries", () => {
  const root = project(
    {
      ".gitignore": "secret/\n",
      "src/a.ts": "export const a = 1;",
      "README.md": "# hi",
      "secret/big.txt": "x".repeat(10_000),
      "package-lock.json": "{}".repeat(5_000),
      "logo.png": "\x89PNG\x00\x00",
      "data.bin": "a\x00b",
    },
    { git: true },
  );
  const r = collect([root]);
  assert.deepEqual(r.sources.map((s) => s.label).sort(), [".gitignore", "README.md", "src/a.ts"]);
  assert.equal(r.skipped.binary, 2);
  assert.equal(r.skipped.excluded, 1);

  const ex = collect([root], ["*.md"]);
  assert.ok(!ex.sources.some((s) => s.label === "README.md"));
});

test("-f lists biggest files", () => {
  const root = project({ "big.txt": "word ".repeat(2000), "small.txt": "hi" });
  const r = run([root, "-f", "-m", "gpt-5.5"]);
  assert.match(r.stdout, /Biggest files\n\s+big\.txt/);
});

test("unknown model → exit 2 with a hint", () => {
  const r = run(["-t", "x", "-m", "definitely-not-a-model"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /tokn --list/);
});

test("bad numbers and missing files are clear errors", () => {
  assert.match(run(["-t", "x", "-o", "lots"]).stderr, /--out must be a whole number/);
  const r = run(["/no/such/file.txt"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no such file or directory/);
});

test("--list prints models with prices", () => {
  const r = run(["--list", "-m", "claude-opus-5-5"]);
  assert.match(r.stdout, /claude-opus-5-5\s+anthropic\s+in \$\d/);
});

test("exact counts call provider APIs with the key in a header, not the URL", async () => {
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.GEMINI_API_KEY = "test-gemini";
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    const body = url.includes("anthropic") ? { input_tokens: 42 } : { totalTokens: 37 };
    return { ok: true, json: async () => body, text: async () => "" };
  };
  assert.equal(await exactCount("anthropic", "claude-opus-5-5", "hi", fakeFetch), 42);
  assert.equal(await exactCount("gemini", "gemini-pro-latest", "hi", fakeFetch), 37);
  assert.equal(calls[0].init.headers["x-api-key"], "test-anthropic");
  assert.equal(calls[1].init.headers["x-goog-api-key"], "test-gemini");
  assert.ok(!calls[1].url.includes("test-gemini"));
  assert.match(calls[1].url, /models\/gemini-pro-latest:countTokens$/);

  const failing = async () => ({ ok: false, status: 401, text: async () => "bad key" });
  await assert.rejects(exactCount("anthropic", "m", "hi", failing), /HTTP 401/);
});
