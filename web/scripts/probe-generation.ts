// Live measurement probe (not a test): rebuilds a stored turn's generation
// request and times it under several thinking settings. Never prints a key.
//   FORGE_DATA_DIR=data npx tsx scripts/probe-generation.ts <conversationId> <variant...>
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { loadConversation, currentPrompt } from "@/lib/store";
import { buildDeps } from "@/lib/turn/deps";
import { resolveCall, transportFor } from "@/lib/forge";
import { unresolvedQuestions } from "forge/dist/conversation/discovery.js";

const [id, ...variants] = process.argv.slice(2);
const convo = loadConversation(id!)!;
// Rewind to the "Generate (strengthen)" request: drop the failed assistant reply.
while (convo.messages.at(-1)?.role === "assistant") convo.messages.pop();
const message = convo.messages.at(-1)!.content;
const deps = buildDeps(convo, currentPrompt(convo));
const unresolved = convo.discovery ? unresolvedQuestions(convo.discovery) : [];
const revise = currentPrompt(convo) !== null;
const r = deps.renderGeneration(revise ? "REVISE" : "CREATE", message, revise
  ? { explicitGenerate: false, unresolved: [], mode: null, direct: false }
  : { explicitGenerate: true, unresolved, mode: "strengthen", direct: false });
console.log(JSON.stringify({ message: message.slice(0, 80), systemChars: r.system.length, userChars: r.user.length, unresolved: unresolved.length }));
const call = resolveCall(convo.provider, convo.model || undefined);
const spec = transportFor(call, convo.id);
const model = createAnthropic({ apiKey: spec.apiKey, baseURL: spec.baseURL!.replace(/\/+$/, ""), headers: { ...spec.headers } })(spec.modelId);

for (const v of variants) {
  const thinking =
    v === "default" ? undefined : v === "off" ? { type: "disabled" } : { type: "enabled", budgetTokens: Number(v) };
  const maxOutputTokens = 16000 + (thinking?.type === "enabled" ? Number(v) : 0);
  const started = Date.now();
  let firstReasoning = 0, firstText = 0, reasoningChars = 0, textChars = 0;
  try {
    const result = streamText({
      model, system: r.system, prompt: r.user, maxOutputTokens, temperature: thinking?.type === "enabled" ? undefined : 0.7,
      ...(thinking ? { providerOptions: { anthropic: { thinking } as never } } : {}),
    });
    for await (const p of result.fullStream as AsyncIterable<{ type: string; text?: string; error?: unknown }>) {
      if (p.type === "reasoning-delta") { firstReasoning ||= Date.now() - started; reasoningChars += p.text?.length ?? 0; }
      if (p.type === "text-delta") { firstText ||= Date.now() - started; textChars += p.text?.length ?? 0; }
      if (p.type === "error") throw p.error;
    }
    const usage = await result.usage;
    const text = await result.text;
    let envelopeOk = false;
    try { const o = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); envelopeOk = typeof o.prompt === "string"; } catch {}
    let problem = "";
    try { JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch (e) { problem = String((e as Error).message).slice(0, 160); }
    console.log(JSON.stringify({ tail: text.slice(-300), head: text.slice(0, 200), problem, textLen: text.length }));
    console.log(JSON.stringify({ variant: v, seconds: (Date.now() - started) / 1000, firstReasoningS: firstReasoning / 1000, firstTextS: firstText / 1000,
      finish: await result.finishReason, usage, reasoningChars, textChars, envelopeOk }));
  } catch (e) {
    console.log(JSON.stringify({ variant: v, seconds: (Date.now() - started) / 1000, error: String((e as Error).message ?? e).slice(0, 400) }));
  }
}
