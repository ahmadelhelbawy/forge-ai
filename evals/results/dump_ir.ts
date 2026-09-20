import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, extractJsonPayload,
  intentExtractBoundary, renderIntentPrompt, renderRepairPrompt,
} from "../../src/intent/extract.js";
import { attributeDraft, userInputSegment } from "../../src/ir/attribution.js";
import { DraftIRSchema, type DraftIR } from "../../src/ir/schema.js";
import { cassetteKey, readCassette } from "../../src/model/cassette.js";

const tasks = parseYaml(readFileSync("evals/corpus/tasks.yaml", "utf8")) as Array<{id:string;text:string}>;
mkdirSync("evals/results/ir", { recursive: true });
for (const t of tasks) {
  const input = { text: t.text };
  const prompt = renderIntentPrompt(t.text);
  const key = cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, prompt);
  const hit = readCassette("evals/results/cassettes", key);
  if (!hit) { console.log(t.id, "NO CASSETTE"); continue; }
  const attempt = (responseText: string): DraftIR | null => {
    let payload: unknown;
    try { payload = extractJsonPayload(responseText); } catch { return null; }
    const shape = DraftIRSchema.safeParse(payload);
    if (!shape.success) return null;
    const problems = intentExtractBoundary.postValidators.flatMap((v) => v(input, shape.data));
    return problems.length === 0 ? shape.data : null;
  };
  let draft = attempt(hit.responseText);
  let via = "initial";
  if (!draft) {
    // Reconstruct the exact repair key the boundary used.
    let problems: string[];
    try {
      const payload = extractJsonPayload(hit.responseText);
      const shape = DraftIRSchema.safeParse(payload);
      problems = shape.success
        ? intentExtractBoundary.postValidators.flatMap((v) => v(input, shape.data))
        : shape.error.issues.map((i) => `${String(i.path.join(".")) || "<root>"}: ${i.message}`);
    } catch (e) { problems = [(e as Error).message]; }
    const key2 = cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION,
      renderRepairPrompt(prompt, hit.responseText, problems));
    const hit2 = readCassette("evals/results/cassettes", key2);
    draft = hit2 ? attempt(hit2.responseText) : null;
    via = "repair";
  }
  if (!draft) { console.log(t.id, "UNRESOLVED"); continue; }
  const ir = attributeDraft(draft, [userInputSegment("s1")]);
  writeFileSync(`evals/results/ir/${t.id}.json`, JSON.stringify(ir, null, 2) + "\n");
  console.log(t.id, `ok (${via}) goals=` + ir.goals.length, "constr=" + ir.constraints.length,
    "q=" + ir.open_questions.length, "assump=" + ir.assumptions.length);
}
