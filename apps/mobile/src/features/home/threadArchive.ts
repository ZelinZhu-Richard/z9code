import {
  threadRuntimeCanArchive,
  type ThreadRuntimeSummary,
} from "@z9code/client-runtime/state/models";

export function threadCanArchive(runtime: ThreadRuntimeSummary | null | undefined): boolean {
  return threadRuntimeCanArchive(runtime);
}
