/**
 * Artifact topology: path templating and section composition (FR-021, FR-024, AP-R4).
 *
 * This is where "adding an agent is data, not code" actually happens. Which sections
 * appear, in what order, in which files is entirely profile data. Nothing here branches
 * on a profile id.
 */
import { rawHash } from "../ir/canonical.js";
import { getSectionEmitter } from "./sections/index.js";
import { rebase, type Span } from "../trace/span.js";
import type { Artifact, SectionInput } from "./types.js";
import type { ArtifactTopologyEntry } from "../profile/schema.js";
import { PATH_VARS, type PathVar, type SectionKey } from "./vocabulary.js";

export class PathTemplateError extends Error {
  constructor(template: string, reason: string) {
    super(`Invalid artifact path template ${JSON.stringify(template)}: ${reason}`);
    this.name = "PathTemplateError";
  }
}

/**
 * Render a path template from the closed variable set.
 *
 * The template is validated by the profile schema; this additionally validates the
 * RESULT, because a legal template with a hostile value would otherwise escape. Both
 * checks are needed: the template check catches the defect, the result check catches
 * the input.
 */
export function renderPath(template: string, vars: Readonly<Record<PathVar, string>>): string {
  const rendered = template.replace(/\{([^}]*)\}/g, (_match, name: string) => {
    if (!(PATH_VARS as readonly string[]).includes(name)) {
      throw new PathTemplateError(template, `unknown variable "${name}"`);
    }
    return vars[name as PathVar];
  });

  if (rendered.startsWith("/")) throw new PathTemplateError(template, "rendered to an absolute path");
  if (rendered.includes("\\")) throw new PathTemplateError(template, "rendered a backslash separator");
  if (rendered.split("/").includes("..")) {
    throw new PathTemplateError(template, 'rendered a ".." segment');
  }
  if (rendered.trim().length === 0) throw new PathTemplateError(template, "rendered an empty path");
  return rendered;
}

/** Values a path template may reference. Sanitised so no value can introduce a separator. */
export function pathVars(taskSlug: string, taskId: string): Record<PathVar, string> {
  const sanitise = (value: string): string =>
    value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
  return { task_slug: sanitise(taskSlug), task_id: sanitise(taskId) };
}

const SECTION_SEPARATOR = "\n\n";

/**
 * Compose one artifact from its declared sections.
 *
 * Sections that return null are skipped entirely, so a topology may list a section
 * unconditionally without producing an empty heading. Separators are whitespace and
 * therefore need no origin; everything else arrives already traced.
 */
export function composeArtifact(
  entry: ArtifactTopologyEntry,
  input: Omit<SectionInput, "sectionKey">,
  vars: Readonly<Record<PathVar, string>>,
): { artifact: Artifact; spans: Span[] } {
  const path = renderPath(entry.path, vars);
  const chunks: string[] = [];
  const spans: Span[] = [];
  let offset = 0;

  for (const key of entry.sections as readonly SectionKey[]) {
    const emitter = getSectionEmitter(key);
    const output = emitter.emit({ ...input, sectionKey: key });
    if (output === null || output.text.length === 0) continue;

    if (chunks.length > 0) {
      chunks.push(SECTION_SEPARATOR);
      offset += Buffer.byteLength(SECTION_SEPARATOR, "utf8");
    }
    chunks.push(output.text);
    spans.push(...rebase(output.spans, path, offset));
    offset += Buffer.byteLength(output.text, "utf8");
  }

  const trailing = chunks.length > 0 ? "\n" : "";
  const content = chunks.join("") + trailing;
  return {
    artifact: { path, content, content_hash: rawHash(content) },
    spans,
  };
}
