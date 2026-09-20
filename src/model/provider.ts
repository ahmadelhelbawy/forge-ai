/**
 * The model provider boundary — every language-model call goes through this
 * interface (FR-047, INV-009, MB-R1 property 6 "Replaceable").
 *
 * Swapping providers requires no change outside `src/model/` (NFR-003). No
 * provider SDK type leaks into the Task IR or the compiler: providers return
 * plain text and FORGE parses it against Zod (spec.md §14).
 */
import { createHash } from "node:crypto";

/** What a boundary asks a model to do. Temperature is set by the boundary. */
export interface CompletionRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  /** Boundaries use 0: extraction must be as deterministic as the API allows. */
  readonly temperature: number;
  /**
   * Optional transport-level headers (e.g. gateway routing or session
   * metadata). Generic: the provider transmits them verbatim and never
   * interprets them. NEVER semantic — excluded from every hash, never logged.
   */
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /**
   * Response shape asked of the endpoint. Boundaries parse JSON, so
   * "json_object" is the default. "text" omits `response_format` entirely, for
   * endpoints that reject the parameter — a transport fact, never semantic.
   */
  readonly responseFormat?: "json_object" | "text";
}

export interface CompletionResponse {
  readonly text: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * A model backend. Implementations are thin adapters over a transport;
 * retries, fallbacks and "guesses" are forbidden here (MB-R3).
 */
export interface ModelProvider {
  /** Stable id, recorded in the run instance: "anthropic" | "openai-compat". */
  readonly id: string;
  readonly defaultModel: string;
  complete(request: CompletionRequest, model?: string): Promise<CompletionResponse>;
}

/**
 * Operational provenance for one boundary invocation (FR-049).
 *
 * VOLATILE (spec.md §12.1): latency, timestamp and token counts are never
 * hashed. `promptHash`/`outputHash` let a reviewer confirm a cassette replay
 * reproduced the recorded call without storing the full text twice.
 */
export interface ModelCallRecord {
  readonly boundaryId: string;
  readonly boundaryVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly promptHash: string;
  readonly outputHash: string;
  /** How many repair re-invocations this call needed (0 on first-pass success). */
  readonly repairs: number;
  readonly latencyMs: number;
  /** True when the response came from a cassette, not the network. */
  readonly replayed: boolean;
  readonly timestamp: string;
}

/**
 * Machine-readable facts about a rejected call, for actionable diagnostics.
 *
 * NEVER carries credentials: no key, no Authorization header, no raw request
 * body. Callers render these fields; they must not string-scrape `message`.
 */
export interface ProviderErrorDetail {
  /** Full request URL, credential-free (the key travels in a header). */
  readonly endpoint?: string;
  readonly httpStatus?: number;
  /** The upstream's own explanation, verbatim and untruncated. */
  readonly providerMessage?: string;
  readonly model?: string;
}

/** Transport, auth, or malformed-response failure. Never a silent fallback. */
export class ProviderError extends Error {
  readonly detail: ProviderErrorDetail;

  constructor(
    message: string,
    readonly provider: string,
    detail: ProviderErrorDetail = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.detail = detail;
  }
}

/** `"sha256:<64 hex>"` — the one hash format (docs/architecture.md §3.4). */
export function sha256Hex(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}
