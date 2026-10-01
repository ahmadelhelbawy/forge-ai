# FORGE identity

## Words

**Tagline** — Turn intent into auditable instructions for AI agents.

**One sentence** — FORGE turns a vague idea or an existing prompt into versioned
requirements and target-specific agent instructions, packages them as an
Execution Contract, and checks the evidence of a run against it.

**Elevator pitch** — Prompting an agent works until the idea is vague, the
requirements change, or you need to know what the agent was actually asked to
do. FORGE sits between you and the agent: it asks what it needs to know, keeps
the requirements you pin through every revision (checked without a model),
compiles one task for Claude Code, Codex, Kiro and others, and turns the result
into a contract an external run can be verified against. It never executes
anything.

**GitHub description** (≤ 350 characters) — Turn intent into auditable
instructions for AI agents: discovery, pinned requirements, target-specific
compilation, Execution Contracts and evidence-based verification. Local,
single-user, provider-independent.

**Voice** — precise, skeptical, calm. Say what is checked and how; say what is
not claimed. No "10×", no "magic", no scores. Prefer a verb and a noun to an
adjective.

## Mark

| File | Use |
|---|---|
| [`mark.svg`](mark.svg) | App icon, favicon (`web/app/icon.svg` is the same drawing) |
| [`wordmark-dark.svg`](wordmark-dark.svg) | Mark + FORGE on dark backgrounds |
| [`wordmark-light.svg`](wordmark-light.svg) | Mark + FORGE on light backgrounds |
| [`avatar.png`](avatar.png) | GitHub organisation/repository avatar (512 × 512) |
| [`social-preview.png`](social-preview.png) | GitHub social preview (1280 × 640) |

The mark is a geometric **F** — the structure FORGE produces — with one amber
point: the spark of intent the structure is built from. The wordmark letters
are drawn as strokes on a 24-unit grid, so they render identically wherever the
SVG is shown, with no font.

| Colour | Hex | Role |
|---|---|---|
| Ink 900 | `#161a20` | Mark ground |
| Ink 950 | `#0d1014` | Page ground |
| Steel | `#e4e7ec` | Letterform |
| Spark | `#f5a55b` | The one accent; never a second one in the mark |

Clear space: the height of the spark on every side. Do not recolour the F, add
gradients or glows, or rotate the mark.

The PNGs are rendered from these SVGs with Chromium; replace them by editing
the SVGs and re-rendering.

## Name and trademark

The code is Apache-2.0. The license does not grant rights to the FORGE name or
mark (Apache-2.0 §6). You may say a fork or product is "based on FORGE"; please
do not name an unrelated or modified product "FORGE" or use the mark in a way
that suggests it is this project or endorsed by it.
