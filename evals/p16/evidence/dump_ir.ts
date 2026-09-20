import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, extractJsonPayload,
  intentExtractBoundary, renderIntentPrompt, renderRepairPrompt,
} from "../../../src/intent/extract.js";
import { attributeDraft, userInputSegment } from "../../../src/ir/attribution.js";
import { DraftIRSchema, type DraftIR } from "../../../src/ir/schema.js";
import { cassetteKey, readCassette } from "../../../src/model/cassette.js";
import { semanticHash } from "../../../src/ir/projection.js";

const tasks = parseYaml(readFileSync("evals/p16/corpus.yaml", "utf8")) as Array<{id:string;text:string}>;
mkdirSync("evals/p16/evidence/ir", { recursive: true });
for (const t of tasks) {
  const input = { text: t.text.trim() };
  const prompt = renderIntentPrompt(t.text.trim());
  const hit = readCassette("evals/p16/evidence/cassettes", cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, prompt));
  if (!hit) { console.log(t.id, "NO CASSETTE"); continue; }
  const attempt = (rt: string): DraftIR | null => {
    let p: unknown; try { p = extractJsonPayload(rt); } catch { return null; }
    const s = DraftIRSchema.safeParse(p); if (!s.success) return null;
    return intentExtractBoundary.postValidators.flatMap((v) => v(input, s.data)).length === 0 ? s.data : null;
  };
  let draft = attempt(hit.responseText); let via = "initial";
  if (!draft) {
    let problems: string[];
    try {
      const p = extractJsonPayload(hit.responseText);
      const s = DraftIRSchema.safeParse(p);
      problems = s.success ? intentExtractBoundary.postValidators.flatMap((v) => v(input, s.data))
        : s.error.issues.map((i) => `${String(i.path.join(".")) || "<root>"}: ${i.message}`);
    } catch (e) { problems = [(e as Error).message]; }
    const hit2 = readCassette("evals/p16/evidence/cassettes",
      cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, renderRepairPrompt(prompt, hit.responseText, problems)));
    draft = hit2 ? attempt(hit2.responseText) : null; via = "repair";
  }
  if (!draft) { console.log(t.id, "UNRESOLVED"); continue; }
  const ir = attributeDraft(draft, [userInputSegment("s1")]);
  writeFileSync(`evals/p16/evidence/ir/${t.id}.json`, JSON.stringify(ir, null, 2) + "\n");
  console.log(t.id, `ok (${via}) hash=${semanticHash(ir).slice(0, 20)}… goals=${ir.goals.length} constr=${ir.constraints.length} q=${ir.open_questions.length} blocking=${ir.open_questions.filter((q) => q.blocking).length}`);
}
