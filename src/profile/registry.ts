/**
 * Agent profile loading (FR-012, FR-013).
 *
 * Profiles are DATA. This module reads and validates YAML; it never imports a profile
 * as code, and nothing anywhere in the compiler branches on a profile id.
 *
 * NOTE ON INV-011: that invariant governs reads of *context* — repository content that
 * flows into an agent's prompt — which must go through WorkspaceGuard (P2). Loading
 * first-party configuration shipped inside this package is not a context read. When the
 * P2 lint rule lands it must be scoped to context access, not to `fs` generally, or it
 * will forbid the wrong thing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import { parseAgentProfile, type AgentProfile } from "./schema.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Profiles shipped with FORGE. Overridable for tests and for `--profile-dir`. */
export const BUILTIN_PROFILE_DIR = resolve(here, "..", "..", "profiles");

export class ProfileNotFoundError extends Error {
  constructor(id: string, available: readonly string[]) {
    super(
      `No agent profile named "${id}". Available: ${available.join(", ") || "(none)"}.\n` +
        `Adding a target is a YAML file in profiles/ — no code change is required for ` +
        `compatibility or native_topology fidelity.`,
    );
    this.name = "ProfileNotFoundError";
  }
}

export interface ProfileRegistry {
  readonly all: readonly AgentProfile[];
  get(id: string): AgentProfile;
  has(id: string): boolean;
  readonly ids: readonly string[];
}

/** Read and validate every `*.yaml` in a directory, ordered by id for determinism. */
export function loadProfilesFrom(...dirs: readonly string[]): ProfileRegistry {
  const profiles = new Map<string, AgentProfile>();

  for (const dir of dirs) {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort();

    for (const file of files) {
      const path = join(dir, file);
      const parsed = parseAgentProfile(parseYaml(readFileSync(path, "utf8")), path);
      if (parsed.id !== file.replace(/\.ya?ml$/, "")) {
        throw new Error(
          `Profile ${path} declares id "${parsed.id}" but its filename says ` +
            `"${file.replace(/\.ya?ml$/, "")}". They must match so a profile is findable by name.`,
        );
      }
      profiles.set(parsed.id, parsed);
    }
  }

  const ids = [...profiles.keys()].sort();
  return {
    all: ids.map((id) => profiles.get(id)!),
    ids,
    has: (id) => profiles.has(id),
    get(id) {
      const profile = profiles.get(id);
      if (!profile) throw new ProfileNotFoundError(id, ids);
      return profile;
    },
  };
}

let builtin: ProfileRegistry | null = null;

/** The shipped profile registry, loaded once. */
export function builtinProfiles(): ProfileRegistry {
  builtin ??= loadProfilesFrom(BUILTIN_PROFILE_DIR);
  return builtin;
}
