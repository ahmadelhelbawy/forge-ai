/**
 * Strategy archetype registry (FR-031).
 *
 * Archetypes are DATA in `strategies/*.yaml`, validated by
 * `parseStrategyArchetype`. Mirrors `profile/registry.ts`: first-party
 * configuration, never code, loaded in id order for determinism.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import { parseStrategyArchetype, type StrategyArchetype } from "./schema.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Archetypes shipped with FORGE. */
export const BUILTIN_STRATEGY_DIR = resolve(here, "..", "..", "strategies");

export class StrategyNotFoundError extends Error {
  constructor(id: string, available: readonly string[]) {
    super(
      `No strategy archetype named "${id}". Available: ${available.join(", ") || "(none)"}.\n` +
        `Adding an archetype is a YAML file in strategies/ — no code change is required.`,
    );
    this.name = "StrategyNotFoundError";
  }
}

export interface StrategyRegistry {
  readonly all: readonly StrategyArchetype[];
  get(id: string): StrategyArchetype;
  has(id: string): boolean;
  readonly ids: readonly string[];
}

/** Read and validate every `*.yaml` in a directory, ordered by id for determinism. */
export function loadStrategiesFrom(...dirs: readonly string[]): StrategyRegistry {
  const archetypes = new Map<string, StrategyArchetype>();

  for (const dir of dirs) {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort();

    for (const file of files) {
      const path = join(dir, file);
      const parsed = parseStrategyArchetype(parseYaml(readFileSync(path, "utf8")), path);
      if (parsed.id !== file.replace(/\.ya?ml$/, "")) {
        throw new Error(
          `Strategy ${path} declares id "${parsed.id}" but its filename says ` +
            `"${file.replace(/\.ya?ml$/, "")}". They must match so an archetype is findable by name.`,
        );
      }
      archetypes.set(parsed.id, parsed);
    }
  }

  const ids = [...archetypes.keys()].sort();
  return {
    all: ids.map((id) => archetypes.get(id)!),
    ids,
    has: (id) => archetypes.has(id),
    get: (id) => {
      const archetype = archetypes.get(id);
      if (!archetype) throw new StrategyNotFoundError(id, ids);
      return archetype;
    },
  };
}

export function builtinStrategies(): StrategyRegistry {
  return loadStrategiesFrom(BUILTIN_STRATEGY_DIR);
}
