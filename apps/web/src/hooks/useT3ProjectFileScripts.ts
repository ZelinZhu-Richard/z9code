import {
  Z9_PROJECT_FILE_NAME,
  type EnvironmentId,
  type Z9ProjectFile,
  type Z9ProjectFileScript,
} from "@z9code/contracts";
import { parseT3ProjectFile } from "@z9code/shared/t3ProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<Z9ProjectFileScript> = [];

export interface Z9ProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: Z9ProjectFile | null;
  scripts: ReadonlyArray<Z9ProjectFileScript>;
}

export function useT3ProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): Z9ProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", Z9_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseT3ProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useT3ProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<Z9ProjectFileScript> {
  return useT3ProjectFileState(environmentId, cwd).scripts;
}
