import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@z9code/contracts";
import { createModelSelection } from "@z9code/shared/model";

import { getCodexServiceTierOptionValue } from "./codexModelOptions.ts";

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "fast");
});
