#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A one-shot CI check; synchronous Node APIs keep it small.
// Fails when shipped source mentions a host that z9code must never contact on its own: telemetry
// sinks, the former T3 cloud, third-party favicon services, or private vendor endpoints reached
// with another app's credentials, or the unrelated `z9` npm package. Tests, fixtures and docs are
// not shipped, so they are skipped.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/ingest\.t3\.codes/i, "T3 telemetry ingest"],
  [/\bposthog\b/i, "PostHog analytics"],
  [/api\.axiom\.co|x-axiom-dataset/i, "Axiom tracing"],
  [/\b(?:relay|app|nightly\.app)\.t3\.codes\b/i, "T3 Connect cloud"],
  [/google\.com\/s2\/favicons/i, "Google favicon service"],
  [/cloudcode-pa\.googleapis\.com|v1internal:/i, "private Google Cloud Code endpoint"],
  [/antigravity\/hub\/|aidev_client/i, "spoofed Antigravity client identity"],
  [/["'`]claude-code\/\d/i, "spoofed Claude Code user agent"],
  [/\b(?:[a-z0-9-]+\.)?t3\.codes\b/i, "upstream T3 site"],
  // Links to upstream issues are history; fetching from upstream is not.
  [
    /raw\.githubusercontent\.com\/pingdotgg|api\.github\.com\/repos\/pingdotgg|github\.com\/pingdotgg\/t3code\/releases/i,
    "upstream T3 repository",
  ],
  // `z9` on npm belongs to another publisher; z9code ships only through GitHub Releases.
  [/registry\.npmjs\.org\/z9(?![\w-])/i, "unrelated z9 npm package"],
  [
    /\b(?:npx|pnpm\s+dlx|bunx|npm\s+exec)\s+(?:(?:--yes|-y|--package(?:=|\s+)\S+)\s+)*z9(?![\w-])/,
    "unrelated z9 npm package",
  ],
  [
    /\bnpm\s+(?:(?:install|i|uninstall|un|remove|rm)\s+(?:-g|--global)|(?:-g|--global)\s+(?:install|i|uninstall|un|remove|rm))\s+(?:--prefix\s+\S+\s+)?z9(?![\w-])/,
    "unrelated z9 npm package",
  ],
  [/\bnpm\s+(?:install|i)\s+z9(?![\w-])\S*\s+(?:-g|--global)\b/, "unrelated z9 npm package"],
  [
    /\b(?:(?:pnpm|bun)\s+add\s+(?:-g|--global)|yarn\s+global\s+add)\s+z9(?![\w-])/,
    "unrelated z9 npm package",
  ],
];

const SHIPPED = /^(?:apps|packages)\/[^/]+\/(?:src|app\.config\.ts)/;
const SKIPPED =
  /(?:\.test\.|\.spec\.|\.browser\.test\.|\/__tests__\/|\/fixtures?\/|\/testkit\/|\/testing\/|\/test\/|\.stories\.)/;

const root = NodePath.resolve(import.meta.dirname, "..");
const files = NodeChildProcess.execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
})
  .toString("utf8")
  .split("\0")
  .filter(
    (file) =>
      SHIPPED.test(file) &&
      !SKIPPED.test(file) &&
      /\.(?:[cm]?[jt]sx?|json)$/.test(file) &&
      // A deletion that is not committed yet is still listed.
      NodeFS.existsSync(NodePath.join(root, file)),
  );

const problems: string[] = [];
for (const file of files) {
  const lines = NodeFS.readFileSync(NodePath.join(root, file), "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(line)) problems.push(`${file}:${index + 1}: ${label}: ${line.trim()}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`check-egress: ${problems.length} forbidden reference(s) in shipped source:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`check-egress: ${files.length} shipped files, no forbidden hosts.`);
