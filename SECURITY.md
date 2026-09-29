# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **"Report a
vulnerability"** (Security → Advisories) on this repository, not in a public
issue. Include the version or commit, what an attacker needs (network position,
local access, a crafted repository or file), and a minimal reproduction.

FORGE is an alpha maintained on a best-effort basis: expect an acknowledgement
within a week. Fixes land on `main` and in the next tagged release; there are no
back-ported patch lines yet.

## What FORGE is, security-wise

FORGE is a **single-user tool you run on your own machine**. It turns intent into
reviewable artifacts and **never executes anything** — no agent, no shell command,
no verification step (`INV-004`; a static test asserts no core code path could).
It stops at the artifact.

It holds two kinds of sensitive data:

- **model-provider API keys** you configure (environment, or Settings);
- **your conversations, prompts and evidence** under `FORGE_DATA_DIR`.

## The trust model, and its limits

**There is no login.** Anyone who can reach FORGE's port can use it and spend the
provider keys stored in it. The defaults are chosen for that:

| Protection | Default |
|---|---|
| Listening interface | `127.0.0.1` for `pnpm --dir web dev` and `start` (`FORGE_HOST` widens it) |
| Cross-origin writes from a browser | refused (`web/middleware.ts`: `Origin` / `Sec-Fetch-Site`) |
| Unknown `Host` names (DNS rebinding) | refused; `FORGE_ALLOWED_HOSTS` lists extra names |
| Framing (clickjacking) | refused (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) |
| Provider keys at rest | AES-256-GCM; the key is `FORGE_APP_SECRET`, or a random per-install `app.secret` (0600) |
| Keys in responses | never returned: Settings shows a masked key; health reports booleans |
| Keys in error text / logs | provider messages are scrubbed of key-, bearer- and URL-credential shapes |
| Key exfiltration by endpoint change | a saved key is only sent to the endpoint it was saved with; changing the base URL requires re-entering it |
| Repository access | only directories under `FORGE_REPO_ROOTS`, only through `WorkspaceGuard` (real-path containment, deny rules, ignore rules, secret scanning); binding is refused when it is unset |
| Untrusted content (attachments, repository files, evidence) | trust-classified; never becomes an authoritative instruction (`INV-002`); evidence is schema-validated and FORGE keeps hashes, not output |

**Do not expose FORGE to a network you do not trust** without an authenticating
reverse proxy in front of it (and HTTPS). The middleware stops drive-by attacks
from web pages; it does not stop a client that can reach the port directly.

Known limits, stated so nobody relies on more:

- `WorkspaceGuard` checks a path's real path and reads it in a separate call: a
  **hostile workspace** that swaps a symlink between the two can race it. Bind
  only repositories you trust.
- Verification evidence is **unsigned**. `VERIFIED` means the supplied evidence,
  taken at its word, shows the expected exit code.
- `app.secret` sits in the data directory. Anyone who copies the whole directory
  can decrypt the keys in it; set `FORGE_APP_SECRET` to keep the key elsewhere.
- Voice input uses the browser's speech recognizer; in Chromium that sends audio
  to the browser vendor's service. FORGE itself receives only the text.

## Supported versions

Only the latest release (and `main`) receives fixes during the alpha.
