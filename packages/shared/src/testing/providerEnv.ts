// Agent shells carry real provider credentials (a gateway sets ANTHROPIC_AUTH_TOKEN and
// ANTHROPIC_BASE_URL) and the agent's own z9code state. Tests that read the ambient environment
// then pass or fail by who runs them. Tests that need one of these variables set it
// themselves. Set Z9CODE_TEST_KEEP_PROVIDER_ENV=1 to keep them, for example for a live run.
const PROVIDER_ENV_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "CODEX_", "OPENAI_", "Z9CODE_"];

const KEPT_ENV = new Set([
  // CI sets these so the transfer budget integration test writes its report for the job summary.
  "Z9CODE_TRANSFER_BUDGET_REPORT_PATH",
  "Z9CODE_TRANSFER_BUDGET_RESULT_PATH",
  "Z9CODE_TRANSFER_BUDGET_SCENARIOS_PATH",
  // Opt-in: points the HtmlRender tests at a headless browser, which they skip without.
  "Z9CODE_TEST_HEADLESS_SHELL",
]);

if (process.env.Z9CODE_TEST_KEEP_PROVIDER_ENV !== "1") {
  for (const key of Object.keys(process.env)) {
    if (KEPT_ENV.has(key)) continue;
    if (PROVIDER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete process.env[key];
    }
  }
}
