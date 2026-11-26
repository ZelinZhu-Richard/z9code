# FAQ

## Is z9code a harness?

No. A harness is what turns an LLM into an agent: it gives the model tools, a way to call them, runs them, and hands the results back. Claude Code is kind of a harness. It is an interface (the TUI, the Code tab in the desktop app) plus a harness underneath (the Anthropic Agent SDK). Codex is the same split: the app plus the Codex App Server. z9code uses those harnesses. It is not a harness, and it does not work without one.

Chef = LLM. Kitchen = harness. z9code = the restaurant that lets you bring whatever kitchen you want. Our MCP is a cookbook we hand the kitchen, but the chef won't open it unless you tell them to :) I wrote the long version here: [What is a harness?](https://t3.gg/blog/post/what-is-a-harness)

Bring your own: Claude Code, Codex, Cursor, Grok Build, OpenCode, Kiro, Pi, Muse Code, or fx. [Provider setup](./install.md#providers)

## Why use z9code instead of Claude Code or the Codex app?

We were inspired by the Codex desktop app, Conductor, Claude Desktop, and Cursor Glass, but none met our bar. What you get:

- Bring your own sub. Claude, Codex, and whatever else you already have installed.
- Best in class remote. Run `z9 up` on any box and drive it from anywhere.
- Best in class mobile app.
- Truly 100% open source code (MIT). If we go the wrong direction, fork it under your own branding.

Every harness feels nearly identical in here, so you can stop worrying about harnesses and focus on building :) [Install](./install.md)

## Can I use z9code with my Claude Code subscription?

Yes.

## How much does z9code cost?

Nothing. There's no way to pay us to use z9code. You bring your own sub. The source code is free and open source (MIT). You still pay your provider like you already do. [Install](./install.md)

## Can I fork or redistribute z9code?

Yes. z9code is MIT licensed, like the t3code project it is forked from. Keep the copyright notices in [LICENSE](../../LICENSE).

## Why is my Claude 5-hour limit draining so fast?

It shouldn't anymore. z9code drives Claude through Anthropic's Agent SDK, and Anthropic's 5h meter used to charge Agent SDK usage about 1.7x more than using Claude Code directly. Weekly limits were never affected. Since v0.1.7, Claude in z9code drains your 5h limit at the same rate as Claude Code. Still seeing it? [Update z9code](./updating.md) on the machine that runs your agents. [Tracking issue](https://github.com/pingdotgg/t3code/issues/24649)

## How do I use z9code remotely?

Your agents run wherever z9code runs: your desktop, a server, a VPS. You connect to it from anywhere. I do this constantly. Less than 5% of my prompts run on my laptop. Run `z9 up` on that machine, then pair your other devices over your LAN or Tailscale. [Remote access](./remote-access.md)

## How do I use z9code on my phone?

Get the [iOS](https://apps.apple.com/us/app/z9code-remote-claude-more/id6787819824) or [Android](https://play.google.com/store/apps/details?id=com.z9code.z9code) app, then connect it to your computer with a pairing link over your LAN or Tailscale. The phone is a remote. Your computer does the work and needs to stay on. [Mobile setup](./install.md#mobile-app) · [Remote access](./remote-access.md)

## Will I get banned for using my subscription?

No. z9code is within the TOS of Claude Code and Codex: it drives each provider through its own CLI or SDK and never reuses another product's sign-in or client identity. Everything else uses official ACP bindings.

## Can I add a bunch of accounts for one provider?

I don't think z9code is the right place to manage a pile of accounts. If we add an auto-switcher, we are risking TOS bans for our users.

A separate work account is fine. Setup for two: [Codex](./providers-codex.md#use-multiple-accounts) · [Claude](./providers-claude.md#separate-accounts-or-configurations).

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in Settings and give it its own keys and endpoint. Claude has a full OpenRouter recipe. Your subscription setup stays untouched. [OpenRouter](./providers-claude.md#openrouter) · [Provider instances](./install.md#providers)

## Does z9code support local models?

No. z9code is a serious developer tool. Locally runnable models are not capable of meaningful engineering work.

## Does my code go to z9code servers?

No. Your code and prompts go from your machine to your provider (Anthropic, OpenAI, etc.), not to us. Your devices connect to your machine directly, with no hosted relay or tunnel in between, and this build sends no product usage events. [Product usage data](./privacy.md)

## Worktrees are eating my disk. How do I clean them up?

Open **Settings → Worktrees → Cleanup** and turn on automatic worktree cleanup. You can also run it now from there. Worktrees add up fast. One user cleared 500 GB. [Storage cleanup](./project-settings.md#storage-cleanup)

## Is there voice input?

Yes. On iPhone and Android, dictation uses on-device speech by default, with the option to use a paired environment. On macOS 26 or later, desktop users can choose Apple Speech directly under **On this Mac** or choose an environment. Web and other desktop users can enable dictation by choosing an environment. The transcript goes into your draft for review. See [Voice input](./voice-input.md).

## Does it work on Windows, Mac, and Linux?

Yes, all three. Desktop app, CLI, the works. One catch: there is no `z9` binary for Intel Macs, so use the desktop app there. Windows folks can also run agents inside WSL. [Install](./install.md)

## Why is my provider not showing up?

Almost always, the CLI is not installed or not on the `PATH` of the machine that runs the server. (Not your phone. The computer.) Log in on that machine first, like `codex login` or `claude auth login`. Still missing? Point **Binary path** at it in provider settings. Version managers love to cause this one. [Provider setup](./install.md#providers)
