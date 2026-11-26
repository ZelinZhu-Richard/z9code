# Google Gemini

z9code runs Google's official [Gemini CLI](https://github.com/google-gemini/gemini-cli) as an
[ACP](./providers-acp.md) agent. Gemini CLI signs in and talks to Google itself; z9code only
starts `gemini --acp` and exchanges protocol messages with it over stdio.

z9code never reads your Google tokens, keychain entries or `~/.gemini` credential files, never
calls Google endpoints itself, and never presents itself as another client. This is the use
Google's terms allow, unlike the Antigravity integration this fork removed.

## Set up

1. Install the CLI: `npm install -g @google/gemini-cli`.
2. Run `gemini` once in a terminal and pick a sign-in method: **Log in with Google**, a
   **Gemini API key** (`GEMINI_API_KEY`), or **Vertex AI**.
3. In z9code, open **Settings → Providers → Add provider** and choose **Set up Gemini CLI**.

To use an API key without the interactive sign-in, add `GEMINI_API_KEY` under the provider's
environment variables. It is stored in z9code's local secret store and passed only to the
`gemini` process.

## Privacy

Gemini CLI collects usage statistics by default. z9code starts it with Gemini CLI's own
telemetry switched off (`GEMINI_TELEMETRY_ENABLED=false`) and a lowest-precedence settings file
that sets `privacy.usageStatisticsEnabled` to `false`. Your own `~/.gemini/settings.json` still
wins if you deliberately turn usage statistics back on.

Prompts, files and tool output you send to Gemini go to Google under the account you signed in
with, as with any use of Gemini CLI.
