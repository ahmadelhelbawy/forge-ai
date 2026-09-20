# Authentication sessions

Session refresh MUST reuse the existing `AuthProvider` interface declared in
`src/auth.ts`. Refresh tokens rotate on each use; the provider signature is
the contract behind constraint `c1`.

Login flow lives in `src/session.ts` and delegates token issuance to the
provider. Nothing here overrides the interface.
