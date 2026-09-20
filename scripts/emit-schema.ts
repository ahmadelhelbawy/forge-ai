/**
 * Emit the published JSON Schema for the Task IR (FR-010).
 *
 * The schema under `schema/` is a PUBLISHED ARTIFACT: it is how a third party consumes
 * an Execution Package without running FORGE (PK-R8), and how a contributor validates
 * a hand-authored IR. It is generated, never hand-edited.
 *
 *   pnpm schema:emit    regenerate
 *   pnpm schema:check   fail if the committed file is stale (runs in CI)
 *
 * `io: "input"` is deliberate: the published schema describes what an author may
 * WRITE, so defaulted fields are optional and the pre-normalization form of any
 * transformed field is what is documented.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { TaskIRSchema } from "../src/ir/schema.js";
import { IR_VERSION } from "../src/ir/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const outPath = join(repoRoot, "schema", "task-ir.schema.json");

function build(): string {
  const jsonSchema = z.toJSONSchema(TaskIRSchema, { io: "input" });
  const document = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://forge.dev/schema/task-ir/${IR_VERSION}.json`,
    title: "FORGE Task IR",
    description:
      "Canonical, provider-independent representation of an engineering task. " +
      "Semantic layer only: no timestamps, scores, or compile-time decisions.",
    ...jsonSchema,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

const isCheck = process.argv.includes("--check");
const generated = build();

if (isCheck) {
  let existing: string;
  try {
    existing = readFileSync(outPath, "utf8");
  } catch {
    console.error(
      `schema:check FAILED — ${outPath} does not exist.\nRun: pnpm schema:emit`,
    );
    process.exit(1);
  }
  if (existing !== generated) {
    console.error(
      `schema:check FAILED — the committed JSON Schema is stale relative to the Zod source.\n` +
        `Run: pnpm schema:emit`,
    );
    process.exit(1);
  }
  console.log(`schema:check OK — ${outPath} matches the Zod source.`);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated, "utf8");
  console.log(`schema:emit wrote ${outPath} (${generated.length} bytes)`);
}
