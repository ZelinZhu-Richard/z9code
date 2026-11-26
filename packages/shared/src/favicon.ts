/**
 * Favicons are never fetched over the network: loading `<origin>/favicon.ico` or a
 * favicon service would tell that host (or Google) which pages the user's agent
 * visited. Only inline `data:` images a provider already sent are shown; everything
 * else falls back to a local icon.
 */
function inlineFaviconUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || rawUrl.length > 65_536) return null;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "data:" && /^data:image\//i.test(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

export function toolActivityFaviconUrl(
  icon: {
    readonly pageUrl: string;
    readonly faviconUrl?: string | undefined;
    readonly faviconUrlDark?: string | undefined;
  },
  appearance: "light" | "dark",
  _size = 32,
): string | null {
  if (appearance === "dark") {
    return inlineFaviconUrl(icon.faviconUrlDark) ?? inlineFaviconUrl(icon.faviconUrl);
  }
  return inlineFaviconUrl(icon.faviconUrl);
}
