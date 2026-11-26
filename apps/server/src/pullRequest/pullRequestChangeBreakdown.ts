import type { PullRequestChangeBreakdown } from "@z9code/contracts";
import { summarizeChangedFiles } from "@z9code/shared/changedFileKind";
import type { ProviderFileStats } from "@z9code/source-control-core/server/PullRequestProvider";

export function toChangeBreakdown(stats: ProviderFileStats): PullRequestChangeBreakdown {
  if (stats.truncated) return null;
  return summarizeChangedFiles(stats.files);
}
