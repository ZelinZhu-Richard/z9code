# Privacy and network access

z9code sends **no telemetry**: no analytics, usage events, crash reports, traces, install or
device identifiers. There is no setting to turn it on because the code is not there.
`pnpm check:egress` runs in CI and fails if shipped source references a telemetry sink, the
former T3 cloud, a favicon service, or a vendor endpoint reached with another app's credentials.

## What z9code itself connects to

z9code's server only makes these connections, and only in the situations listed:

| When                                                               | Host                                                                                                                               | Why                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Check for provider updates** is on (off by default)              | `registry.npmjs.org`, `downloads.claude.ai`, `releases.openai.com`, the z9code repository on GitHub, `cdn.agentclientprotocol.com` | New CLI versions and the model list                                           |
| You refresh pricing on the Usage page, or update checks are on     | `raw.githubusercontent.com` (LiteLLM price table)                                                                                  | Cost estimates                                                                |
| You open **Settings → About → Update track** to switch tracks      | `api.github.com` and `github.com` release downloads, which redirect to GitHub's asset CDN                                          | The newest z9code release on that track and whether it can open your database |
| You install or update an agent CLI                                 | npm or the vendor's release host                                                                                                   | Download the CLI                                                              |
| You sign in to an integration                                      | that service (GitHub, GitLab, Linear, …)                                                                                           | The integration you configured                                                |
| You enable voice input with a cloud model, or download a local one | the speech provider you chose, `huggingface.co`                                                                                    | Transcription                                                                 |
| You browse or install a theme                                      | `open-vsx.org`                                                                                                                     | Themes                                                                        |
| You open the preview browser for the first time                    | `storage.googleapis.com` (Chrome for Testing)                                                                                      | The preview browser                                                           |
| You configure an OTLP endpoint in **Settings → Diagnostics**       | your endpoint                                                                                                                      | Traces you asked for, sent to you                                             |

Agent CLIs (Claude Code, Codex, Gemini CLI, …) talk to their own vendors under your account.
That traffic is between you and that vendor. When the server starts, z9code runs each enabled
agent CLI once to check that it is installed and signed in, and that check can contact the
CLI's vendor (Claude Code reaches `api.anthropic.com`, for example). Disable a provider in
**Settings → Providers** to stop z9code from starting it. z9code does not read their credentials and starts
Gemini CLI with its usage statistics off.

The desktop app checks for updates only if a release feed is configured at build time; source
builds have none. The mobile app does not check for over-the-air updates.

## Local data

- Threads, messages and settings live in the SQLite database in z9code's state directory.
- **Deleting a thread** removes its rows from every table, its events (one scrubbed tombstone is
  kept so other devices learn about the deletion), its search index entries and its provider
  logs. SQLite `secure_delete` zeroes the freed pages. A thread whose history a live fork still
  shows is kept until that fork is deleted too.
- Agent feedback reports, if enabled, are stored locally and never sent anywhere.
- The resource monitor samples only z9code's own process tree, redacts secrets from command
  lines, and can be turned off with `Z9CODE_RESOURCE_MONITOR_DISABLED=1`.

## File access

Clients can read files inside your projects, agent folders such as `~/.claude` and `~/.codex`,
and the temp directory. Credential stores (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.docker`,
`~/.netrc`, `~/.npmrc`, gcloud/gh config, and agents' own auth files) are always refused, even
through a symlink inside a project.
