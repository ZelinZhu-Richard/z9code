# Release Runbook

z9code does not publish releases yet. Upstream's release, nightly, npm, AUR, EAS and hosted-web
workflows were removed with the rest of T3's infrastructure; the build scripts they called
(`scripts/build-desktop-artifact.ts`, `scripts/build-cli-archive.ts`) are kept so a release
workflow can be added later.

When one is added, keep these invariants from the upstream design:

- **Server self-update ordering:** connected servers update to the exact client version by
  downloading the GitHub Release CLI archive. Publish the CLI archives, `SHA256SUMS` and
  `release.json` before anything that tells clients a new version exists.
- **No npm package:** the `z9` name on npm belongs to an unrelated publisher, so z9code ships only
  through GitHub Releases. Never suggest `npx z9` or `npm install -g z9`; `check:egress` rejects
  them in shipped source.
- **Exact Node pin:** `engines.node` in the root `package.json` must stay exact, because Node SEA
  builds reject mismatches. There is no macOS x64 CLI archive; x64 desktop uses Electron.
- **No update feed by default:** desktop and CLI update checks stay off unless a release feed is
  configured, so a source build never contacts a release host on its own.
