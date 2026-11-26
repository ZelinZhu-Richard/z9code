import { assert, it } from "@effect/vitest";

import {
  repositoryPathFromRemoteUrl,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it.each([
  ["git@github.com:Z9Code/z9code.git", "Z9Code/z9code"],
  ["github.com:Z9Code/z9code.git", "Z9Code/z9code"],
  ["gitlab.com:Z9Code/platform/z9code", "Z9Code/platform/z9code"],
  ["https://github.com/Z9Code/z9code.git", "Z9Code/z9code"],
  ["https://github.com/Z9Code/z9code.git?view=compact", "Z9Code/z9code"],
  ["https://github.com/Z9Code/z9code.git#section", "Z9Code/z9code"],
  ["C:/repos/z9code", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
