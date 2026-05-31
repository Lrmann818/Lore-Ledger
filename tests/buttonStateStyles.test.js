import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function hoverLinesOutsideFinePointerMedia(source) {
  const badLines = [];
  const mediaDepths = [];
  let depth = 0;
  let pendingFinePointerMedia = false;

  source.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(":hover") && mediaDepths.length === 0) {
      badLines.push(index + 1);
    }

    if (line.includes("@media (hover: hover) and (pointer: fine)")) {
      pendingFinePointerMedia = true;
    }

    for (const char of line) {
      if (char === "{") {
        depth += 1;
        if (pendingFinePointerMedia) {
          mediaDepths.push(depth);
          pendingFinePointerMedia = false;
        }
      } else if (char === "}") {
        if (mediaDepths.at(-1) === depth) {
          mediaDepths.pop();
        }
        depth = Math.max(0, depth - 1);
      }
    }
  });

  return badLines;
}

describe("button state style contracts", () => {
  it("keeps hover-only visuals behind fine pointer media queries", () => {
    expect(hoverLinesOutsideFinePointerMedia(stylesSource)).toEqual([]);
  });

  it("does not style every expanded collapse button like an open dropdown", () => {
    expect(stylesSource).toContain('button[aria-haspopup="true"][aria-expanded="true"]');
    expect(stylesSource).not.toContain('button[aria-expanded="true"] {');
  });
});
