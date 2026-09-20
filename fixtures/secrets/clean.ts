// Clean code: the scanner must NOT flag prose about secrets, identifiers,
// content hashes, or short tokens. If this file ever trips a rule, the rule
// is too broad and must be narrowed (AC-014 guards against both directions).
export interface PasswordField {
  label: string;
  required: boolean;
}

// A content hash is not a secret (lowercase hex only).
export const FIXTURE_HASH = "sha256:b98c049956023b48d7d1f85b9e7ec91c73f7b1d1e900aeb354571232c231a0ac";

// Short tokens and version pins are not secrets.
export const PORT = 3000;
export const APP_VERSION = "1.0.0";
export const TOKEN_TTL_SECONDS = 3600;
