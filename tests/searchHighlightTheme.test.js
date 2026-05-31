import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("search highlight theme tokens", () => {
  it("defines shared search highlight tokens and consumes them in search mark styles", () => {
    expect(stylesSource).toContain("--search-highlight-bg:");
    expect(stylesSource).toContain("--search-highlight-text:");
    expect(stylesSource).toContain("--search-highlight-active-bg:");
    expect(stylesSource).toContain("--search-highlight-active-text:");
    expect(stylesSource).toMatch(/\.searchMark\s*\{[^}]*background:\s*var\(--search-highlight-bg\);/s);
    expect(stylesSource).toMatch(/\.searchMark\s*\{[^}]*color:\s*var\(--search-highlight-text\);/s);
  });

  it("overrides search highlight tokens for the light-surface theme set", () => {
    expect(stylesSource).toMatch(
      /:root\[data-theme="light"\],\s*:root\[data-theme="beige"\],\s*:root\[data-theme="rose"\],\s*:root\[data-theme="teal"\],\s*:root\[data-theme="blue"\]\s*\{[^}]*--search-highlight-bg:[^}]*--search-highlight-active-bg:/s
    );
  });

  it("keeps dedicated active-match styling hooks at the shared mark selector", () => {
    expect(stylesSource).toMatch(
      /\.searchMark\.isCurrentSearchMatch,\s*\.searchMark\[data-search-active="true"\]\s*\{[^}]*background:\s*var\(--search-highlight-active-bg\);[^}]*color:\s*var\(--search-highlight-active-text\);/s
    );
  });
});
