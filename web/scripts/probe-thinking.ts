// Live probe (not a test): does each OpenCode Go anthropic-messages model think
// by default, accept thinking disabled, and honour a thinking budget?
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { resolveCall, transportFor } from "@/lib/forge";

const models = process.argv.slice(2);
const prompt = "Rewrite this instruction to be clearer, in one sentence: 'do the thing with the files carefully and dont break stuff'.";
for (const id of models) {
  const call = resolveCall("opencode-go", id);
  const spec = transportFor(call, "probe");
  const model = createAnthropic({ apiKey: spec.apiKey, baseURL: spec.baseURL!.replace(/\/+$/, ""), headers: { ...spec.headers } })(id);
  for (const v of ["default", "off", "1024"]) {
    const thinking = v === "default" ? undefined : v === "off" ? { type: "disabled" } : { type: "enabled", budgetTokens: 1024 };
    const started = Date.now();
    let reasoning = 0, text = 0;
    try {
      const r = streamText({ model, prompt, maxOutputTokens: 4000 + (v === "1024" ? 1024 : 0),
        ...(thinking ? { providerOptions: { anthropic: { thinking } as never } } : {}) });
      for await (const p of r.fullStream as AsyncIterable<{ type: string; text?: string; error?: unknown }>) {
        if (p.type === "reasoning-delta") reasoning += p.text?.length ?? 0;
        if (p.type === "text-delta") text += p.text?.length ?? 0;
        if (p.type === "error") throw p.error;
      }
      const u = await r.usage;
      console.log(JSON.stringify({ id, v, s: (Date.now() - started) / 1000, finish: await r.finishReason, out: u.outputTokens, reasoning, text }));
    } catch (e) {
      console.log(JSON.stringify({ id, v, s: (Date.now() - started) / 1000, error: String((e as Error).message).slice(0, 200) }));
    }
  }
}
