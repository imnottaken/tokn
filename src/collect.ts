import { execFileSync } from "node:child_process";
import { openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface Source {
  /** Display name: a path, "stdin" or "text" */
  label: string;
  text: string;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo",
  ".vercel", "coverage", "vendor", "target", "venv", ".venv", "__pycache__", ".cache",
]);

/** Files that are big, machine-written and never pasted into a prompt. */
const DEFAULT_EXCLUDE = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "Cargo.lock",
  "poetry.lock", "uv.lock", "composer.lock", "Gemfile.lock", "go.sum",
  "*.min.js", "*.min.css", "*.map",
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|psd|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|mp[34]|mov|avi|mkv|webm|wav|flac|ogg|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|wasm|class|o|a|pyc|sqlite|db)$/i;

const MAX_FILE_BYTES = 5_000_000;

export function pathMatcher(globs: string[]): (path: string) => boolean {
  const res = globs.map((g) => {
    const clean = g.replace(/^\.\//, "").replace(/\/$/, "");
    const body = clean
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0000")
      .replace(/\*\*/g, "\u0001")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*");
    // Patterns without a slash match the file name anywhere, like .gitignore.
    return clean.includes("/")
      ? new RegExp(`^${body}(?:/.*)?$`)
      : new RegExp(`(?:^|/)${body}(?:/.*)?$`);
  });
  return (path) => res.some((re) => re.test(path));
}

function looksBinary(path: string): boolean {
  if (BINARY_EXT.test(path)) return true;
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(8000);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

function gitFiles(dir: string): string[] | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 },
    );
    return out.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function walk(root: string, dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(root, join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(relative(root, join(dir, e.name)).split(sep).join("/"));
    }
  }
}

export interface CollectResult {
  sources: Source[];
  skipped: { binary: number; excluded: number; tooBig: number };
}

/** Expand files and directories into text sources. Directories respect .gitignore when in a git repo. */
export function collect(paths: string[], exclude: string[] = []): CollectResult {
  const isExcluded = pathMatcher([...DEFAULT_EXCLUDE, ...exclude]);
  const skipped = { binary: 0, excluded: 0, tooBig: 0 };
  const sources: Source[] = [];

  for (const p of paths) {
    const st = statSync(p); // throws ENOENT for a bad path, which the CLI reports
    if (st.isFile()) {
      // An explicitly named file is always counted, even if it matches an exclude.
      sources.push({ label: p, text: readFileSync(p, "utf8") });
      continue;
    }
    const rels = gitFiles(p) ?? (() => {
      const acc: string[] = [];
      walk(p, p, acc);
      return acc;
    })();
    for (const rel of rels.sort()) {
      if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
      if (isExcluded(rel)) {
        skipped.excluded++;
        continue;
      }
      const full = join(p, rel);
      let size: number;
      try {
        const s = statSync(full);
        if (!s.isFile()) continue;
        size = s.size;
      } catch {
        continue; // deleted but still in the git index
      }
      if (size > MAX_FILE_BYTES) {
        skipped.tooBig++;
        continue;
      }
      if (looksBinary(full)) {
        skipped.binary++;
        continue;
      }
      // With a single directory, show paths relative to it; with several, keep the prefix.
      const label = paths.length === 1 ? rel : join(p, rel).split(sep).join("/");
      sources.push({ label, text: readFileSync(full, "utf8") });
    }
  }
  return { sources, skipped };
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

