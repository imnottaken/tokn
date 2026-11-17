# tokn

**Count tokens and see what a prompt, file or whole repo costs across GPT, Claude, Gemini and more.**

Before you paste a codebase into a model or ship a prompt that runs 10,000 times a day, find out what it costs, which model is cheapest, and whether it even fits in the context window.

```console
$ npx @76yuh/tokn ./my-app -o 1000 -n 1000 -f

tokn  ·  my-app    prices 2026-11-17

176,248 tokens · 656,224 chars · 176 files
per call: input + 1,000 output tokens

  MODEL                   TOKENS   $/1M IN   $/1M OUT   PER CALL   × 1,000   CONTEXT
  ──────────────────────────────────────────────────────────────────────────────────
  claude-haiku-5-5      ≈176,248     $0.10      $0.50     $0.018    $18.12       18%
  deepseek-v4-flash     ≈176,248     $0.30      $1.20     $0.054    $54.07       18%
  gemini-flash-latest   ≈176,248     $0.75      $3.75     $0.136   $135.94       17%
  gpt-5.4-mini           176,248     $0.75      $4.50     $0.137   $136.69       65%
  grok-4.7              ≈176,248     $2.00      $6.00     $0.358   $358.50       35%
  claude-sonnet-5-5     ≈176,248     $2.00     $10.00     $0.362   $362.50       18%
  gemini-pro-latest     ≈176,248     $2.00     $12.00     $0.364   $364.50       17%
  claude-opus-5-5       ≈176,248     $4.00     $20.00     $0.725   $724.99       18%
  gpt-5.5                176,248     $5.00     $30.00     $0.911   $911.24       17%

  cheapest: claude-haiku-5-5 · 50× cheaper than gpt-5.5

Biggest files
  components/chat/icons.tsx                   28,351   16%  ████████████████████
  components/ai-elements/prompt-input.tsx      8,333    5%  ██████
  components/chat/multimodal-input.tsx         6,229    4%  ████
  …
```

That last part is often the most useful: one SVG icons file was 16% of this entire repo's tokens.

## Install

```bash
npx @76yuh/tokn <file-or-folder>   # no install
npm i -g @76yuh/tokn               # or install it, then just run: tokn
```

## Usage

```bash
tokn prompt.md                         # one file
tokn src/ docs/                        # folders (respects .gitignore)
cat prompt.md | tokn                   # stdin
tokn -t "Summarize this ticket…"       # a string

tokn prompt.md -o 800                  # include 800 expected output tokens per call
tokn prompt.md -o 800 -n 10000         # …and the total for 10,000 calls
tokn prompt.md --cached                # prompt-caching prices where offered
tokn . -f                              # show which files eat the most tokens
tokn . -x "test/**,*.snap"             # skip paths

tokn prompt.md -m "claude-*,gpt-5.5"   # pick models (ids, globs or substrings)
tokn prompt.md --all                   # every known chat model
tokn --list -m flash                   # look up model ids and prices
tokn prompt.md --json                  # for scripts and CI
```

## How accurate is it?

- **OpenAI models: exact.** tokn uses `o200k_base`, the tokenizer behind current GPT models (via [js-tiktoken](https://github.com/dqbd/tiktoken)).
- **Claude, Gemini, others: estimates (marked `≈`).** Their tokenizers aren't public, so tokn counts with OpenAI's. Close enough for budgeting, but the real number will differ.
- **Want exact Claude/Gemini counts?** Set `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` and add `--exact`. tokn calls Anthropic's and Google's free token-counting endpoints. Nothing is generated and nothing is billed.

## Where prices come from

Prices and context windows come from [LiteLLM's community-maintained price list](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json), which the community updates as providers change prices.

- Each tokn release ships a snapshot, so it works offline.
- `tokn --refresh` downloads today's prices into `~/.cache/tokn/` and uses them from then on.
- The header shows the date of the prices in use, so you always know how fresh they are.

Prices change. Treat the numbers as a planning estimate, not an invoice.

## What gets counted in a folder

- In a git repo: exactly the files git sees, so `.gitignore` is respected.
- Outside git: everything except `node_modules`, `dist`, `.next`, `venv` and similar folders.
- Always skipped: binaries (images, fonts, archives…), lockfiles (`package-lock.json`, `yarn.lock`, `go.sum`…), minified files and source maps, files over 5 MB.
- A file you name directly is always counted.

## As a library

```ts
import { countTokens, loadPrices, priceRow } from "@76yuh/tokn";

const tokens = countTokens(prompt);
const book = loadPrices();
const row = priceRow("gpt-5.5", book.models["gpt-5.5"], tokens, true, { out: 500 });
console.log(row.cost); // USD per call
```

## Development

```bash
npm install
npm test          # build + tests
npm run prices    # regenerate the bundled price snapshot
```

## License

MIT
