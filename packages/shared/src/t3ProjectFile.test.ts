import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { parseT3ProjectFile, Z9ProjectFileFromJson } from "./t3ProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(Z9ProjectFileFromJson);

describe("Z9ProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", "stopOnSettle": true, },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev", stopOnSettle: true });
  });
});

describe("parseT3ProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parseT3ProjectFile(`{
        /* See https://github.com/ZelinZhu-Richard/z9code/blob/main/docs/user/project-settings.md */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });
});
