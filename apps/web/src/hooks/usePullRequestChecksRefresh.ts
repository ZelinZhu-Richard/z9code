import { pullRequestChecksRefreshIntervalMs } from "@z9code/client-runtime/pull-request-checks";
import type { PullRequestCheck } from "@z9code/contracts";

import { useLiveRefresh } from "./useLiveRefresh";

export function usePullRequestChecksRefresh(input: {
  refresh: (() => void) | null;
  enabled: boolean;
  key: string;
  checks: ReadonlyArray<PullRequestCheck>;
}) {
  useLiveRefresh(input.refresh, {
    key: input.key,
    enabled: input.enabled,
    intervalMs: pullRequestChecksRefreshIntervalMs(input.checks),
  });
}
