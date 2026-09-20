/**
 * Topology coverage — FORGE-C102 `topology_gap` (FR-050, INV-012, AP-R9).
 *
 * THE DEFECT THIS CLOSES.
 *
 * A profile selects which sections its artifacts carry. Nothing checked that content
 * actually present in the IR had somewhere to go. So a topology omitting `non_goals`,
 * `verification`, `scope` or `acceptance` silently deleted them: the compile succeeded,
 * `refused` was false, and not one diagnostic named the loss. `FORGE-C002` protects hard
 * constraints only, and `FORGE-C001` computes goal coverage from the verification LIST
 * rather than from spans — so a package could report every goal verified while its
 * artifacts contained no verification at all.
 *
 * Worse, the advisory case made a diagnostic lie: `FORGE-C052` says a semi-trusted node
 * "will be rendered as advisory", and with no `advisory` section in the topology it was
 * rendered nowhere.
 *
 * Reachable entirely through profile DATA, which is the supported extension mechanism
 * (AC-017) — so it was reachable by a third-party contributor with no code review.
 *
 * THE RULE. For each class of agent-steering or supporting content, the topology must
 * declare at least one section able to render it. A gap is:
 *
 *   error   → compilation REFUSED, when the class is instruction-bearing, or carries
 *             nodes demoted to advisory by the trust model. Losing either would break
 *             INV-003/INV-012 or silently discard a security control.
 *   warning → recorded and reported, when the class is influence-bearing or supporting
 *             (context pointers, untrusted appendix, environment notes). The content is
 *             not authoritative, so an explicit, named degradation is proportionate.
 *
 * Nothing here branches on a profile id: it reads the declared section list and the IR.
 */
import { diagnostic, measureEvidence, nodeEvidence, type Diagnostic } from "../../ir/diagnostic.js";
import { steeringNodes } from "../../ir/integrity.js";
import type { TaskIR } from "../../ir/schema.js";
import type { AgentProfile } from "../../profile/schema.js";
import type { Materialization, SectionKey } from "../../compile/vocabulary.js";
import type { TopologyGap } from "../../compile/types.js";

/** One content class, the sections that can render it, and what it costs to lose. */
interface ContentClass {
  readonly id: string;
  /** Human-readable name used in the diagnostic. */
  readonly label: string;
  readonly destinations: readonly SectionKey[];
  readonly severity: "error" | "warning";
  /** Node ids at risk, empty when the class is not present in this IR. */
  readonly nodes: readonly string[];
}

export interface TopologyCoverageInput {
  readonly ir: TaskIR;
  readonly profile: AgentProfile;
  /** Node ids demoted to advisory by the trust model (`advisoryNodeIds`). */
  readonly advisory: ReadonlySet<string>;
  /** Materialization decisions for the references that survived budgeting. */
  readonly materialization: ReadonlyMap<string, Materialization>;
  /** True when the compiler produced any degradation or capability note to report. */
  readonly hasEnvironmentNotes: boolean;
}

function contentClasses(input: TopologyCoverageInput): ContentClass[] {
  const { ir, advisory } = input;
  const authoritative = (ids: readonly string[]) => ids.filter((id) => !advisory.has(id));
  const demoted = steeringNodes(ir)
    .filter((n) => advisory.has(n.nodeId))
    .map((n) => n.nodeId);

  const refs = [...input.materialization.entries()].map(([id, mode]) => ({
    id,
    mode,
    trust: ir.context_refs.find((r) => r.id === id)?.trust ?? "untrusted",
  }));

  return [
    {
      id: "objective",
      label: "the objective",
      destinations: ["objective"],
      severity: "error",
      nodes: authoritative(["objective"]),
    },
    {
      id: "goals",
      label: "goals",
      destinations: ["goals", "task_checklist"],
      severity: "error",
      nodes: authoritative(ir.goals.map((g) => g.id)),
    },
    {
      id: "acceptance",
      label: "acceptance criteria",
      destinations: ["acceptance", "task_checklist"],
      severity: "error",
      nodes: authoritative(ir.goals.filter((g) => g.acceptance.length > 0).map((g) => g.id)),
    },
    {
      id: "constraints",
      label: "constraints",
      destinations: ["constraints"],
      severity: "error",
      nodes: authoritative(ir.constraints.map((c) => c.id)),
    },
    {
      id: "non_goals",
      label: "non-goals",
      destinations: ["non_goals"],
      severity: "error",
      nodes: authoritative(ir.non_goals.map((n) => n.id)),
    },
    {
      id: "scope",
      label: "the scope",
      destinations: ["scope"],
      severity: "error",
      nodes: authoritative(["scope"]),
    },
    {
      id: "verification",
      label: "verification steps",
      destinations: ["verification"],
      severity: "error",
      nodes: authoritative(ir.verification.map((v) => v.id)),
    },
    {
      id: "deliverables",
      label: "deliverables",
      destinations: ["deliverables"],
      severity: "error",
      nodes: authoritative(ir.deliverables.map((d) => d.id)),
    },
    {
      // The trust model's advisory demotion is a security control, so losing its
      // destination is a refusal rather than a degradation (SC-R1 mechanism 2).
      id: "advisory",
      label: "nodes demoted to advisory by the trust model",
      destinations: ["advisory"],
      severity: "error",
      nodes: demoted,
    },
    {
      id: "assumptions",
      label: "assumptions",
      destinations: ["assumptions"],
      severity: "warning",
      nodes: authoritative(ir.assumptions.map((a) => a.id)),
    },
    {
      id: "open_questions",
      label: "open questions",
      destinations: ["open_questions"],
      severity: "warning",
      nodes: authoritative(ir.open_questions.map((q) => q.id)),
    },
    {
      id: "context_pointers",
      label: "context references kept as pointers",
      destinations: ["context_plan"],
      severity: "warning",
      nodes: refs
        .filter((r) => r.trust !== "untrusted" && (r.mode === "by_reference" || r.mode === "summary"))
        .map((r) => r.id),
    },
    {
      id: "context_inline",
      label: "context references marked for inlining",
      destinations: ["context_inline"],
      severity: "warning",
      nodes: refs.filter((r) => r.trust !== "untrusted" && r.mode === "by_value").map((r) => r.id),
    },
    {
      id: "untrusted_refs",
      label: "untrusted references",
      destinations: ["untrusted_appendix"],
      severity: "warning",
      nodes: refs.filter((r) => r.trust === "untrusted").map((r) => r.id),
    },
    {
      id: "environment_notes",
      label: "degradation and capability notes",
      destinations: ["capability_notes"],
      severity: "warning",
      nodes: input.hasEnvironmentNotes ? ["capability_notes"] : [],
    },
  ];
}

export interface TopologyCoverageResult {
  readonly gaps: readonly TopologyGap[];
  readonly diagnostics: readonly Diagnostic[];
  /** True when at least one gap is error-severity, so compilation must be refused. */
  readonly refused: boolean;
}

export function checkTopologyCoverage(input: TopologyCoverageInput): TopologyCoverageResult {
  const declared = new Set<string>(
    input.profile.output.artifacts.flatMap((a) => a.sections as readonly string[]),
  );

  const gaps: TopologyGap[] = [];
  const diagnostics: Diagnostic[] = [];
  let refused = false;

  for (const klass of contentClasses(input)) {
    if (klass.nodes.length === 0) continue;
    if (klass.destinations.some((d) => declared.has(d))) continue;

    if (klass.severity === "error") refused = true;
    gaps.push({
      content_class: klass.id,
      severity: klass.severity,
      destinations: klass.destinations,
      node_ids: klass.nodes,
    });

    diagnostics.push(
      diagnostic(
        "FORGE-C102",
        `${input.profile.display_name}'s artifact topology declares no section that can render ` +
          `${klass.label}, but this task has ${klass.nodes.length}. ` +
          `Add one of [${klass.destinations.join(", ")}] to the topology` +
          (klass.severity === "error"
            ? `. Compilation refused rather than emitting a package with this content missing.`
            : `, or accept that this content is omitted from the artifacts.`),
        [
          ...klass.nodes.slice(0, 8).map(nodeEvidence),
          measureEvidence("unrenderable_nodes", klass.nodes.length, "nodes"),
        ],
        klass.severity,
      ),
    );
  }

  return { gaps, diagnostics, refused };
}
