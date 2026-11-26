import type { UsageProviderKind } from "@z9code/contracts";
import type { TranscriptUsageFormat } from "@z9code/provider-core/server/usage";
import { piUsageFormat } from "@z9code/provider-pi/server/usage";
import { grokUsageFormat } from "@z9code/provider-grok/server/usage";
import { museUsageFormat } from "@z9code/provider-muse/server/usage";

import { claudeUsageFormat } from "../provider/Drivers/claudeUsage.ts";
import { codexUsageFormat } from "../provider/Drivers/codexUsage.ts";

export const TEST_FORMATS: Record<
  "claude" | "codex" | "grok" | "pi" | "muse",
  TranscriptUsageFormat<unknown>
> = {
  claude: claudeUsageFormat,
  codex: codexUsageFormat,
  grok: grokUsageFormat,
  pi: piUsageFormat,
  muse: museUsageFormat,
};

export const TEST_FORMAT_MAP = new Map<UsageProviderKind, TranscriptUsageFormat<unknown>>(
  Object.entries(TEST_FORMATS) as Array<[UsageProviderKind, TranscriptUsageFormat<unknown>]>,
);
