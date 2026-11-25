import type * as Path from "effect/Path";

/**
 * Home-relative locations that hold credentials. Client file reads never serve them: a
 * prompt-injected agent could otherwise link one in a message and have the UI read it back.
 */
const CREDENTIAL_DIRECTORIES = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  ".password-store",
  ".config/gcloud",
  ".config/gh",
  ".config/op",
  "Library/Keychains",
] as const;

const CREDENTIAL_FILES = [
  ".netrc",
  ".git-credentials",
  ".npmrc",
  ".pypirc",
  ".claude.json",
  ".claude/.credentials.json",
  ".codex/auth.json",
  ".gemini/oauth_creds.json",
  ".gemini/google_accounts.json",
] as const;

/** Agent folders under home whose plans, memory and instructions the UI shows. */
const AGENT_CONFIG_DIRECTORIES = [
  ".claude",
  ".codex",
  ".gemini",
  ".kiro",
  ".cursor",
  ".agents",
  ".config/opencode",
] as const;

const homeRelative = (path: Path.Path, realPath: string, home: string) => {
  const relative = path.relative(path.resolve(home), path.resolve(realPath));
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative)
    ? null
    : relative.split(path.sep).join("/");
};

const isUnder = (relative: string, prefix: string) =>
  relative === prefix || relative.startsWith(`${prefix}/`);

/** Takes an absolute, symlink-resolved path. */
export function isCredentialPath(path: Path.Path, realPath: string, home: string): boolean {
  const relative = homeRelative(path, realPath, home);
  if (relative === null) return false;
  return (
    CREDENTIAL_DIRECTORIES.some((directory) => isUnder(relative, directory)) ||
    CREDENTIAL_FILES.some((file) => relative === file)
  );
}

/** Takes an absolute, symlink-resolved path; credential files inside are refused separately. */
export function isAgentConfigPath(path: Path.Path, realPath: string, home: string): boolean {
  const relative = homeRelative(path, realPath, home);
  return relative !== null && AGENT_CONFIG_DIRECTORIES.some((dir) => isUnder(relative, dir));
}
