/**
 * The closed section emitter registry (FR-021, AP-R5).
 *
 * Profiles SELECT and ORDER keys from this catalogue. They cannot define new emitters.
 * That is precisely what makes "adding an agent is data, not code" true while keeping
 * rendering first-party, reviewable, and uniformly traced.
 *
 * There is no vendor branching anywhere below. Differences between targets come from
 * which sections a profile's topology selects, in what order, into which files — never
 * from a check on a profile id.
 */
import { SECTION_KEYS, type SectionKey } from "../vocabulary.js";
import type { SectionEmitter } from "../types.js";

import { objectiveSection } from "./objective.js";
import { acceptanceSection, goalsSection } from "./goals.js";
import { constraintsSection } from "./constraints.js";
import {
  assumptionsSection,
  deliverablesSection,
  nonGoalsSection,
  openQuestionsSection,
  projectConventionsSection,
  scopeSection,
} from "./scope.js";
import {
  stopConditionsSection,
  taskChecklistSection,
  verificationSection,
} from "./verification.js";
import {
  advisorySection,
  contextInlineSection,
  contextPlanSection,
  untrustedAppendixSection,
} from "./context.js";
import { capabilityNotesSection } from "./capability.js";

const EMITTERS: readonly SectionEmitter[] = [
  objectiveSection,
  goalsSection,
  acceptanceSection,
  constraintsSection,
  nonGoalsSection,
  scopeSection,
  contextPlanSection,
  contextInlineSection,
  assumptionsSection,
  openQuestionsSection,
  taskChecklistSection,
  verificationSection,
  stopConditionsSection,
  deliverablesSection,
  capabilityNotesSection,
  advisorySection,
  untrustedAppendixSection,
  projectConventionsSection,
];

export const SECTION_REGISTRY: ReadonlyMap<SectionKey, SectionEmitter> = new Map(
  EMITTERS.map((e) => [e.key, e]),
);

/** Every catalogue key has an emitter. Asserted at module load, not merely in a test. */
for (const key of SECTION_KEYS) {
  if (!SECTION_REGISTRY.has(key)) {
    throw new Error(
      `Section catalogue declares "${key}" but no emitter is registered for it. ` +
        `Every key in SECTION_KEYS must have an implementation (AP-R5).`,
    );
  }
}

export function getSectionEmitter(key: SectionKey): SectionEmitter {
  const emitter = SECTION_REGISTRY.get(key);
  if (!emitter) throw new Error(`No section emitter registered for "${key}".`);
  return emitter;
}
