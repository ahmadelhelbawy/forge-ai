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
import { PACKAGE_SCHEMAS } from "../src/package/schema.js";
import { PACKAGE_FORMAT_VERSION } from "../src/package/assemble.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

function document(schema: z.ZodType, id: string, title: string, description: string): string {
  const body = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    title,
    description,
    ...z.toJSONSchema(schema, { io: "input" }),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * Everything published under `schema/`.
 *
 * The Task IR schema is what a contributor validates a hand-authored IR
 * against; the package schemas are what makes `PK-R8` true — a third party
 * reads an Execution Package with JSON parsing and these files, and no FORGE
 * runtime at all.
 */
const OUTPUTS: ReadonlyArray<{ readonly file: string; readonly content: string }> = [
  {
    file: join("schema", "task-ir.schema.json"),
    content: document(
      TaskIRSchema,
      `https://forge.dev/schema/task-ir/${IR_VERSION}.json`,
      "FORGE Task IR",
      "Canonical, provider-independent representation of an engineering task. " +
        "Semantic layer only: no timestamps, scores, or compile-time decisions.",
    ),
  },
  ...Object.entries(PACKAGE_SCHEMAS).map(([name, schema]) => {
    const stem = name.replace(/\.json$/, "");
    return {
      file: join("schema", "package", `${stem}.schema.json`),
      content: document(
        schema,
        `https://forge.dev/schema/package/${PACKAGE_FORMAT_VERSION}/${stem}.json`,
        `FORGE Execution Package — ${name}`,
        `Published contract for ${name} inside an Execution Package (spec.md §11). ` +
          "Consuming a package requires only JSON parsing and this schema (PK-R8).",
      ),
    };
  }),
];

const isCheck = process.argv.includes("--check");
let failed = false;

for (const { file, content } of OUTPUTS) {
  const outPath = join(repoRoot, file);
  if (isCheck) {
    let existing: string;
    try {
      existing = readFileSync(outPath, "utf8");
    } catch {
      console.error(`schema:check FAILED — ${file} does not exist.\nRun: pnpm schema:emit`);
      failed = true;
      continue;
    }
    if (existing !== content) {
      console.error(
        `schema:check FAILED — ${file} is stale relative to the Zod source.\nRun: pnpm schema:emit`,
      );
      failed = true;
    }
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content, "utf8");
    console.log(`schema:emit wrote ${file} (${content.length} bytes)`);
  }
}

if (isCheck) {
  if (failed) process.exit(1);
  console.log(`schema:check OK — ${OUTPUTS.length} published schema(s) match the Zod source.`);
}
