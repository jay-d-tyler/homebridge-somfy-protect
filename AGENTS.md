# Agent guide

Read `README.md`, `package.json`, and the relevant source and tests before editing.
Inspect Git state and preserve unrelated changes. Keep public documentation
technical; never include credentials or private deployment details.

`src/platform.ts` owns site selection, polling, and commands across registered
alarms; `src/httpServer.ts` owns the authenticated HTTP endpoints. Preserve
site selection, token handling, freshness checks, and command confirmation.

For code changes, install with `npm ci` and run `npm run lint`, `npm test -- --runInBand`, `npm run build`, and `npm run verify-build`.
Use the mocked tests under `test/`; do not validate by controlling real devices.
For documentation-only changes, verify paths and commands against source and
run `git diff --check`. Do not infer runtime success from documentation checks.

`npm run watch` links the package and starts a development runtime. Do not run
it, `npm link`, device requests, service changes, or publishing/release commands
without explicit authorisation for that operation. Keep changes local unless
commit or push is requested.
