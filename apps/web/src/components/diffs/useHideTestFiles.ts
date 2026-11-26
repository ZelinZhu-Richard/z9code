import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

const HIDE_TEST_FILES_STORAGE_KEY = "z9code.diffHideTestFiles";

export function useHideTestFiles() {
  return useLocalStorage(HIDE_TEST_FILES_STORAGE_KEY, false, Schema.Boolean);
}
