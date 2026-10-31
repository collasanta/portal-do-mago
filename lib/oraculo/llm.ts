import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
// Preço do Claude Haiku 5.5 (US$ por token, prompts até 100K tokens)
const PRICE_IN = 0.1 / 1e6;
const PRICE_OUT = 0.5 / 1e6;

const g = globalThis as unknown as { _anthropic?: Anthropic };
const client = (g._anthropic ??= new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID ?? "" },
  maxRetries: 1,
  timeout: 60_000,
}));

export type Usage = { input: number; output: number; usd: number };

function usageOf(u: Anthropic.Usage): Usage {
  const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  return { input, output, usd: input * PRICE_IN + output * PRICE_OUT };
}

const textOf = (m: Anthropic.Message) =>
  m.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

/** Chamada curta, sem streaming (reescrita da consulta, título). */
export async function complete(system: string, user: string, maxTokens = 60) {
  const m = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "disabled" },
    system,
    messages: [{ role: "user", content: user }],
  });
  return { text: textOf(m), usage: usageOf(m.usage) };
}

/** Resposta em streaming: chama onDelta a cada pedaço de texto. */
export async function streamAnswer(
  system: string,
  messages: Anthropic.MessageParam[],
  onDelta: (t: string) => void,
  signal: AbortSignal,
  maxTokens = 1000,
) {
  const s = client.messages.stream(
    { model: MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, system, messages },
    { signal },
  );
  s.on("text", (t) => onDelta(t));
  const final = await s.finalMessage();
  return usageOf(final.usage);
}
