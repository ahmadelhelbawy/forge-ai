/**
 * Shared helpers for section emitters.
 *
 * Emitters are deliberately explicit and boring. There is no template DSL: the spec
 * does not ask for one, and a DSL would put a layer between the author and the trace
 * exactly where the trace matters most.
 */
import { steeringNodes, type SteeringNode } from "../../ir/integrity.js";
import type { TraceOrigin } from "../../trace/span.js";
import { TracedTextBuilder } from "../../trace/span.js";
import type { SectionInput } from "../types.js";

/**
 * Nodes this artifact must render as advisory rather than authoritatively (C052).
 *
 * Reads the single canonical enumeration in `src/ir/integrity.ts` so the renderer and
 * the diagnostic can never disagree about which nodes were demoted.
 */
export function demotedNodes(input: SectionInput): SteeringNode[] {
  return steeringNodes(input.effective.ir).filter((n) => input.advisoryNodeIds.has(n.nodeId));
}

/** True when this node must NOT appear in an authoritative section. */
export const isDemoted = (input: SectionInput, nodeId: string): boolean =>
  input.advisoryNodeIds.has(nodeId);

/** Origin for text the renderer itself authors: headings, labels, separators. */
export function templateOrigin(input: SectionInput, slot: string): TraceOrigin {
  return {
    kind: "renderer_template",
    renderer_id: input.rendererId,
    section_key: input.sectionKey,
    slot,
  };
}

/** Origin for a Task IR node. */
export const nodeOrigin = (node_id: string): TraceOrigin => ({ kind: "ir_node", node_id });

/**
 * Origin for a node that may have been introduced by a strategy overlay
 * (FR-018, PV-R4). Base nodes resolve to `ir_node`; overlay-added nodes to
 * their recorded `strategy` origin. No strategy-id branching anywhere:
 * the map decides, the emitter just looks up.
 */
export function effectiveOrigin(input: SectionInput, nodeId: string): TraceOrigin {
  return input.effective.introduced_by.get(nodeId) ?? nodeOrigin(nodeId);
}

/**
 * Start a section with a heading.
 *
 * The heading is `renderer_template`-originated, not `ir_node`. Attributing structural
 * text to an IR node would be a lie that `forge explain` would then repeat.
 */
export function heading(builder: TracedTextBuilder, input: SectionInput, text: string): TracedTextBuilder {
  return builder.add(`## ${text}`, templateOrigin(input, "heading")).gap("\n\n");
}

/** A bullet whose body is attributed to `origin` and whose marker is renderer text. */
export function bullet(
  builder: TracedTextBuilder,
  input: SectionInput,
  body: string,
  origin: TraceOrigin,
  marker = "- ",
): TracedTextBuilder {
  return builder
    .add(marker, templateOrigin(input, "bullet_marker"))
    .add(body, origin)
    .gap("\n");
}

/** A `label: value` line where the label is renderer text and the value is attributed. */
export function labelled(
  builder: TracedTextBuilder,
  input: SectionInput,
  label: string,
  value: string,
  origin: TraceOrigin,
): TracedTextBuilder {
  return builder
    .add(`${label}: `, templateOrigin(input, "label"))
    .add(value, origin)
    .gap("\n");
}

export { TracedTextBuilder };
