import {
  Z9_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectReadFileResult,
  type Z9ProjectFile,
} from "@z9code/contracts";
import { parseT3ProjectFile } from "@z9code/shared/t3ProjectFile";
import { executeAtomQuery } from "@z9code/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

function toT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
  result: ProjectReadFileResult | null,
): Z9ProjectFile | null {
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    Z9_PROJECT_FILE_NAME,
    result,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseT3ProjectFile(data.contents);
}

export async function readT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<Z9ProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, Z9_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  return toT3ProjectFile(
    environmentId,
    workspaceRoot,
    result._tag === "Success" ? result.value : null,
  );
}

/** The project's t3.json from an earlier read, or `undefined` when none has loaded yet. */
export function peekT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Z9ProjectFile | null | undefined {
  const result = appAtomRegistry.get(
    getProjectFileQueryAtom(environmentId, workspaceRoot, Z9_PROJECT_FILE_NAME),
  );
  return AsyncResult.isSuccess(result)
    ? toT3ProjectFile(environmentId, workspaceRoot, result.value)
    : undefined;
}
