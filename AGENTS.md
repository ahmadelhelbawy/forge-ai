# Repository Guidelines

## Project Structure & Module Organization

FORGE is a Node 22, TypeScript, ESM command-line compiler. Production code lives in `src/`: `ir/` defines Task IR, `compile/` lowers and renders it, `profile/` loads agent YAML, `model/` isolates providers, and `cli/` exposes commands. Tests live under `tests/{boundaries,contract,golden,property}/`, with utilities in `tests/helpers/`. Profiles and reusable inputs live in `profiles/` and `fixtures/`. Treat `schema/task-ir.schema.json` as generated output. Read `intent.md`, `spec.md`, `docs/architecture.md`, and `plan.md` for intent, requirements, design, and sequencing.

## Build, Test, and Development Commands

- `pnpm install` installs the lockfile-pinned dependencies.
- `pnpm build` compiles TypeScript into `dist/` and copies the extraction prompt.
- `pnpm typecheck` runs strict TypeScript checks without emitting files.
- `pnpm test` runs the complete offline Vitest suite once; `pnpm test:watch` reruns affected tests during development.
- `pnpm schema:check` verifies that the committed JSON Schema matches the Zod source. Use `pnpm schema:emit` to regenerate it.
- `pnpm forge <command>` runs the CLI from source, for example `pnpm forge agents`.

## Coding Style & Naming Conventions

Use two-space indentation, double quotes, semicolons, trailing commas, and `.js` extensions in relative ESM imports. Keep TypeScript strict and validate runtime boundaries with Zod. Use `camelCase` for values/functions, `PascalCase` for types/classes, and lowercase or kebab-case filenames. No formatter or linter is configured; match adjacent code and run `pnpm typecheck`. Prefer pure deterministic functions and profile data over target-specific branches.

## Testing Guidelines

Vitest runs in Node and must require neither network access nor API keys. Name tests `*.test.ts` and place them in the suite matching the guarantee exercised. Add regression tests for behavior changes, especially trust, hashing, degradation, topology, and trace coverage. No numeric coverage threshold is configured; invariant and contract tests are the gate.

## Commit & Pull Request Guidelines

This repository has no commit history, so no subject format can be inferred. Use short, imperative subjects and cite applicable requirement IDs such as `INV-003` or `FR-041`. Pull requests should explain the change, link the governing spec or issue, list verification results, and call out schema or snapshot updates. Include CLI output for user-visible changes. Never weaken an invariant or test to obtain a green build.

## Security & Configuration

Keep API keys in environment variables and out of fixtures, profiles, logs, and commits. Do not hand-edit generated schema files or introduce model calls outside the provider boundary registry.
