<h1 align="center">z9code</h1>

<p align="center">A private, local-first control plane for coding agents.</p>

z9code runs the coding agents already installed on your machine (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Grok Build, Kiro, Pi, Muse Code, fx and any [ACP](./docs/user/providers-acp.md) agent) and gives them one fast interface on desktop, web and phone.

z9code is an independent fork of [t3code](https://github.com/pingdotgg/t3code) (MIT). It is **not affiliated with or endorsed by T3 Tools, Inc.**

## What is different from upstream

|                                        | upstream t3code                                                                                                         | z9code                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Product telemetry                      | On by default: PostHog via `ingest.t3.codes`, with hashed install, device and account ids, model names and token counts | **Removed.** No analytics code ships.                                          |
| Client fingerprint on every connection | Device type, OS, model, app version, browser, hashed owner ids                                                          | **Removed**                                                                    |
| Startup network calls                  | Model manifest from GitHub, CLI release feeds, npm, ACP registry, pricing table                                         | **Off** until you enable _Check for provider updates_                          |
| Link favicons                          | Every linked hostname sent to Google's favicon service                                                                  | **Local icons only**                                                           |
| Deleting a thread                      | Hidden, but messages, tool output, search index, events and logs stay on disk                                           | **Purged**, with SQLite `secure_delete`                                        |
| Claude **Auto** mode                   | Silently approved asks Claude Code forwarded for a human (e.g. a blocked `git push --force`)                            | **Asks you**                                                                   |
| Google models                          | "Antigravity" provider that read Google OAuth tokens from your keychain and spoofed Google's client                     | **Official Gemini CLI** over ACP; z9code never touches your Google credentials |
| Cloud relay (T3 Connect)               | Phone ↔ computer traffic via T3's Cloudflare account, no end-to-end encryption, Axiom traces                            | **Removed.** Connect directly over your LAN, Tailscale or SSH.                 |
| File reads                             | Any absolute path, including `~/.ssh`                                                                                   | Project, agent folders and temp dir only; credential stores always refused     |

See [docs/user/privacy.md](./docs/user/privacy.md) for every outbound connection z9code can make and when.

## Install from source

```bash
pnpm install
pnpm dev
```

Requires Node.js 26 and pnpm 12 (see `package.json`). The [development runbook](./docs/operations/00_development.md) covers desktop builds and the mobile app.

### Sign in to an agent

z9code needs one agent that is installed and signed in, for example:

- [Claude Code](https://claude.com/product/claude-code): `claude auth login`
- [Codex CLI](https://developers.openai.com/codex/cli): `codex login`
- [Gemini CLI](./docs/user/gemini.md): `npm install -g @google/gemini-cli`, then `gemini` to sign in

z9code drives the CLIs you are already signed in to. It does not proxy, resell or extract their credentials.

## Documentation

- [Privacy and network access](./docs/user/privacy.md)
- [Google Gemini](./docs/user/gemini.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Remote access over LAN, Tailscale or SSH](./docs/user/remote-access.md)
- [All docs](./docs/README.md)

## License

MIT. See [LICENSE](./LICENSE). Original work © 2026 T3 Tools Inc.; modifications © 2026 Zelin Zhu.
