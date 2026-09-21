/**
 * The compiler version, pinned as a literal (`IR-R14`, `INV-005`).
 *
 * `forge_compiler_version` is a member of the semantic input tuple, which means
 * it participates in `semantic_id`: two packages built by compilers that render
 * differently must not share an id, and two built by the same compiler must.
 *
 * It is a literal rather than a read of `package.json` for two reasons. A
 * filesystem read at module load is a dependency the pure core does not need
 * and cannot make in every consumer's bundle. And a value read at runtime can
 * drift from the value the build was tested against, which is exactly the
 * failure the tokenizer pin already guards against
 * (`tests/property/tokenizer-identity.test.ts`). A test asserts this constant
 * equals the package's version, so the two cannot disagree silently.
 *
 * **Bump this when a change alters rendered bytes for an unchanged IR.** A
 * refactor that renders identically must not bump it, or every stored
 * `semantic_id` becomes unreproducible for no reason.
 */
export const FORGE_COMPILER_VERSION = "0.1.0-alpha.0";
