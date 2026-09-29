/**
 * Actionable, sanitized provider-failure diagnostics.
 *
 * "Request failed (502)" is not a diagnostic: it names neither the stage that
 * failed nor what the upstream actually said. This module turns a thrown
 * provider error into the labelled block the user sees in Settings and the
 * server writes to its log, from the structured `detail` a ProviderError
 * carries — never by scraping prose.
 *
 * Credential safety: only whitelisted fields are copied, and the endpoint is
 * stripped of its query string so a key carried in a base URL cannot leak into
 * the browser or a log line.
 */

export interface ProviderDiagnostic {
  readonly provider: string;
  readonly stage: string;
  readonly endpoint?: string;
  readonly model?: string;
  /** Wire protocol used, which is what selected the endpoint path. */
  readonly protocol?: string;
  readonly httpStatus?: number;
  readonly providerMessage?: string;
  /** Our own one-line summary — always present, so a block is never empty. */
  readonly summary: string;
}

interface DiagnosticContext {
  readonly provider: string;
  readonly stage: string;
  readonly model?: string;
  readonly protocol?: string;
  /** Fallback when the error itself does not name the URL. */
  readonly endpoint?: string;
}

/** Drop query and fragment: some gateways accept a key as a URL parameter. */
function safeEndpoint(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}

function readDetail(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return {};
  const detail = (error as { detail?: unknown }).detail;
  return typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : {};
}

/**
 * Build a diagnostic from a caught error plus the call site's own context.
 * Works for any error: a plain one degrades to provider, stage and message.
 */
/**
 * The AI SDK throws APICallError carrying `statusCode`, `url` and the raw
 * `responseBody`. Read those structurally — they are the same facts our own
 * ProviderError carries, under different names.
 */
function readSdkError(error: unknown): {
  endpoint?: string;
  httpStatus?: number;
  providerMessage?: string;
} {
  if (typeof error !== "object" || error === null) return {};
  const e = error as Record<string, unknown>;
  // A retry wrapper (AI_RetryError) carries the real failure as `lastError`;
  // reading only the wrapper loses the HTTP status that explains it.
  if (typeof e["statusCode"] !== "number" && typeof e["lastError"] === "object" && e["lastError"] !== null) {
    return readSdkError(e["lastError"]);
  }
  const status = typeof e["statusCode"] === "number" ? e["statusCode"] : undefined;
  const url = typeof e["url"] === "string" ? e["url"] : undefined;
  let message: string | undefined;
  const body = e["responseBody"];
  if (typeof body === "string" && body.trim().length > 0) {
    try {
      message = messageFromJson(JSON.parse(body)) ?? body.trim().slice(0, 500);
    } catch {
      message = body.trim().slice(0, 500);
    }
  }
  return {
    ...(url !== undefined ? { endpoint: url } : {}),
    ...(status !== undefined ? { httpStatus: status } : {}),
    ...(message !== undefined ? { providerMessage: message } : {}),
  };
}

/** Pull a human explanation out of whatever error envelope an endpoint uses. */
function messageFromJson(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = messageFromJson(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "detail", "description", "error_description", "reason"]) {
      if (typeof record[key] === "string") {
        const found = messageFromJson(record[key]);
        if (found !== undefined) return found;
      }
    }
    if (record["error"] !== undefined) return messageFromJson(record["error"]);
  }
  return undefined;
}

/**
 * A provider's error text, fit to show: an HTML page (a wrong path answered by
 * a website) is named rather than dumped, and anything else is capped. The
 * full page helps nobody and buried the status that explains it.
 */
export function conciseProviderText(text: string): string {
  if (/<!doctype html|<html[\s>]/i.test(text)) {
    const before = text.slice(0, text.search(/<!doctype html|<html[\s>]/i)).trim();
    return `${before ? `${before} ` : ""}(the endpoint answered with a web page, not an API response — the base URL or path is wrong)`;
  }
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

/**
 * Remove anything shaped like a credential from provider-supplied text. Some
 * upstreams echo the rejected key ("Incorrect API key provided: sk-…"), and
 * this text reaches the browser and the server log.
 */
export function redactCredentials(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b(sk|pk|rk|ak|oc|sess|key|api)[-_](?:[A-Za-z0-9]+[-_])*[A-Za-z0-9]{16,}\b/gi, "[redacted-key]")
    .replace(/(api[ _-]?key[^:]{0,20}:\s*)\S{8,}/gi, "$1[redacted]")
    .replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, "//[redacted]@");
}

export function providerDiagnostic(error: unknown, ctx: DiagnosticContext): ProviderDiagnostic {
  const detail = readDetail(error);
  const sdk = readSdkError(error);
  const summary = redactCredentials(conciseProviderText(error instanceof Error ? error.message : String(error)));
  const endpoint = safeEndpoint(detail["endpoint"] ?? sdk.endpoint ?? ctx.endpoint);
  const httpStatus =
    typeof detail["httpStatus"] === "number" ? detail["httpStatus"] : sdk.httpStatus;
  const rawProviderMessage =
    typeof detail["providerMessage"] === "string" && detail["providerMessage"].length > 0
      ? detail["providerMessage"]
      : sdk.providerMessage;
  const providerMessage =
    rawProviderMessage === undefined ? undefined : redactCredentials(conciseProviderText(rawProviderMessage));
  const model = typeof detail["model"] === "string" && detail["model"] ? detail["model"] : ctx.model;
  return {
    provider: ctx.provider,
    stage: ctx.stage,
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(ctx.protocol !== undefined ? { protocol: ctx.protocol } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(providerMessage !== undefined ? { providerMessage } : {}),
    summary,
  };
}

/**
 * Why the call failed, in the user's terms. Billing exhaustion is NOT an
 * authentication failure: telling someone their key is invalid when it is
 * merely out of credit sends them to re-issue a perfectly good key.
 */
export function classifyFailure(d: ProviderDiagnostic): string {
  const text = `${d.providerMessage ?? ""} ${d.summary}`.toLowerCase();
  // A 429 is a rate limit even when its message says "quota" (per-minute
  // quotas are rate limits). It is billing only when the provider says money:
  // telling a rate-limited user to top up sends them to the wrong fix.
  if (d.httpStatus === 429 && !/credit|billing|balance|prepayment|payment|depleted|insufficient funds/.test(text)) {
    return `${d.provider} is rate-limiting this key — wait and retry, or choose another model.${
      d.providerMessage ? ` (${d.providerMessage})` : ""
    }`;
  }
  // Money only when the provider says money. "insufficient permissions" or a
  // bare "quota" in a 400 is not a bill, and telling the user it is sends
  // them to the wrong fix.
  if (
    d.httpStatus === 402 ||
    /credit|billing|balance|prepayment|payment|depleted|insufficient[_ ](funds|quota|balance|credit)|exceeded your (current )?quota/.test(text)
  ) {
    return `${d.provider} rejected the request for billing reasons, not a bad key.`;
  }
  // An entitlement refusal ("requires explicit opt in") arrives as 403 but is
  // not a bad key: sending the user to re-issue a working key wastes their
  // time when the fix is a setting in their provider account.
  // Only the provider can refuse a model for an account, so this needs an
  // HTTP answer: FORGE's own "provider is not enabled" is a local setting,
  // and reading it as an account refusal sent users to the wrong place.
  if (d.httpStatus !== undefined && /opt in|opt-in|not enabled|enable this|not entitled|access denied for|region/.test(text)) {
    return `${d.provider} refused this model for your account: ${d.providerMessage ?? d.summary}`;
  }
  if (d.httpStatus === 401 || d.httpStatus === 403 || /invalid api key|unauthorized/.test(text)) {
    return "Authentication failed — the API key was rejected.";
  }
  if (d.httpStatus === 429) return `${d.provider} is rate-limiting this key.`;
  // A 400 about the reasoning parameter is not a bad model: the model works,
  // the effort setting does not. Naming the model sent users to switch it.
  if (d.httpStatus === 400 && /reasoning|thinking|budget_tokens|effort/.test(text)) {
    return `${d.provider} rejected the reasoning setting for this model — set Effort to Default (or another level) and retry.${
      d.providerMessage ? ` (${d.providerMessage})` : ""
    }`;
  }
  if (d.httpStatus === 404 || /not supported|does not exist|unknown model/.test(text)) {
    return `Model "${d.model ?? "unknown"}" was rejected by this endpoint.`;
  }
  if (/timeouterror|aborted due to timeout|timed out/.test(text)) {
    return `${d.provider} did not answer in time — the call was stopped. Retry, or choose a faster model.`;
  }
  if (d.httpStatus !== undefined && d.httpStatus >= 500) {
    return `${d.provider} failed on its side (HTTP ${d.httpStatus}) — nothing is wrong with your key; retry shortly.${
      d.providerMessage ? ` (${d.providerMessage})` : ""
    }`;
  }
  if (/fetch failed|enotfound|econnrefused|etimedout|socket hang up/.test(text)) {
    return "Endpoint unreachable — check the base URL and network.";
  }
  return d.providerMessage ?? d.summary;
}

/** The labelled block. A line is omitted when there is no fact for it. */
export function formatDiagnostic(d: ProviderDiagnostic): string {
  const lines = [`Provider: ${d.provider}`, `Stage: ${d.stage}`];
  if (d.model) lines.push(`Model (API id): ${d.model}`);
  if (d.protocol) lines.push(`Protocol: ${d.protocol}`);
  if (d.endpoint) lines.push(`Endpoint: ${d.endpoint}`);
  if (d.httpStatus !== undefined) lines.push(`HTTP status: ${d.httpStatus}`);
  if (d.providerMessage) lines.push(`Provider message: ${d.providerMessage}`);
  else if (d.summary) lines.push(d.summary);
  return lines.join("\n");
}

/**
 * One sanitized server-side line per failure, so a defect is debuggable from
 * the log without reproducing it. Carries no credential by construction.
 */
export function logProviderFailure(d: ProviderDiagnostic): void {
  console.error(
    `[forge] provider failure ${JSON.stringify({
      provider: d.provider,
      stage: d.stage,
      endpoint: d.endpoint ?? null,
      model: d.model ?? null,
      protocol: d.protocol ?? null,
      httpStatus: d.httpStatus ?? null,
      providerMessage: d.providerMessage ?? null,
      summary: d.summary,
    })}`,
  );
}
