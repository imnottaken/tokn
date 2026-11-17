import { Tiktoken } from "js-tiktoken/lite";
import o200k from "js-tiktoken/ranks/o200k_base";

let enc: Tiktoken | undefined;

/**
 * Count tokens with o200k_base, the tokenizer used by current OpenAI models.
 * Exact for OpenAI; a close estimate for other providers, whose tokenizers
 * aren't public (use --exact to ask their APIs instead).
 */
export function countTokens(text: string): number {
  enc ??= new Tiktoken(o200k);
  // Treat special-token strings like "<|endoftext|>" as plain text instead of throwing.
  return enc.encode(text, [], []).length;
}
