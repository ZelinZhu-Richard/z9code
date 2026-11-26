import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { Z9ProjectFile } from "@z9code/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const Z9ProjectFileFromJson = fromLenientJson(Z9ProjectFile);

const decodeT3ProjectFile = Schema.decodeExit(Z9ProjectFileFromJson);

export function parseT3ProjectFile(contents: string): Z9ProjectFile | null {
  const decoded = decodeT3ProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}
