# Contributing to z9code

z9code is a privacy-focused fork of [t3code](https://github.com/pingdotgg/t3code). Issues and pull
requests are welcome.

## Before you open a pull request

- **One problem per pull request.** Explain the problem in a sentence or two, then how the change
  fixes it.
- **No telemetry, ever.** Do not add analytics, crash reporting, tracing to third parties, or any
  request z9code makes on its own that [docs/user/privacy.md](./docs/user/privacy.md) does not list.
  `pnpm check:egress` runs in CI.
- **Respect other tools' credentials.** Never read another application's tokens, keychain entries
  or credential files, and never present z9code as a different client. Integrations go through the
  vendor's own CLI or a key the user gives z9code.
- **Run the checks** for what you changed: `vp run check:changed`, plus the focused tests in
  [docs/internals/15_testing.md](./docs/internals/15_testing.md). A bug fix comes with a test that
  fails without it.
- **UI changes** need before and after screenshots in the pull request.

Using AI tools to write code is fine; you are responsible for what you submit.

## Security issues

Report vulnerabilities privately; see [SECURITY.md](./SECURITY.md).
