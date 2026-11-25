import { describe, expect, it } from "@effect/vitest";

import { toolActivityFaviconUrl } from "./favicon.ts";

describe("toolActivityFaviconUrl", () => {
  it("never derives a network favicon from the page the agent visited", () => {
    expect(
      toolActivityFaviconUrl({ pageUrl: "https://example.com/docs/page?q=1" }, "light"),
    ).toBeNull();
    expect(toolActivityFaviconUrl({ pageUrl: "https://github.com/acme/app" }, "dark")).toBeNull();
  });

  it("rejects provider-supplied remote and extension URLs", () => {
    expect(
      toolActivityFaviconUrl(
        { pageUrl: "https://example.com/docs", faviconUrl: "https://example.com/icon.png" },
        "light",
      ),
    ).toBeNull();
    expect(
      toolActivityFaviconUrl(
        { pageUrl: "https://example.com/docs", faviconUrl: "chrome-extension://example/_favicon/" },
        "light",
      ),
    ).toBeNull();
  });

  it("shows inline images a provider already sent", () => {
    const light = "data:image/png;base64,iVBORw0KGgo=";
    const dark = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(
      toolActivityFaviconUrl({ pageUrl: "https://example.com", faviconUrl: light }, "light"),
    ).toBe(light);
    expect(
      toolActivityFaviconUrl(
        { pageUrl: "https://example.com", faviconUrl: light, faviconUrlDark: dark },
        "dark",
      ),
    ).toBe(dark);
  });
});
