import {
  normalizeMarkdownLinkDestination,
  splitMarkdownLinkSearchAndHash,
} from "@z9code/shared/markdownLinks";

export {
  classifyMarkdownImageSource,
  type MarkdownImageSource,
} from "@z9code/shared/markdownLinks";

export function markdownImageSourceFragment(source: string): string {
  return splitMarkdownLinkSearchAndHash(normalizeMarkdownLinkDestination(source)).hash;
}
