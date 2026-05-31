import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/**
 * Walks the stylesheet line by line, tracking whether the current line sits
 * inside an `@media (hover: hover) and (pointer: fine)` block. Returns the
 * 1-based line numbers where `needle` appears, split by location.
 *
 * @param {string} source
 * @param {string} needle
 * @returns {{ inside: number[], outside: number[] }}
 */
function locateSelector(source, needle) {
  const inside = [];
  const outside = [];
  const mediaDepths = [];
  let depth = 0;
  let pendingFinePointerMedia = false;

  source.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(needle)) {
      if (mediaDepths.length > 0) {
        inside.push(index + 1);
      } else {
        outside.push(index + 1);
      }
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

  return { inside, outside };
}

describe("button state style contracts", () => {
  it("keeps hover-only visuals behind fine pointer media queries", () => {
    expect(locateSelector(stylesSource, ":hover").outside).toEqual([]);
  });

  it("does not style every expanded collapse button like an open dropdown", () => {
    expect(stylesSource).toContain('button[aria-haspopup="true"][aria-expanded="true"]');
    expect(stylesSource).not.toContain('button[aria-expanded="true"] {');
  });

  it("applies momentary pressed feedback to plain buttons on all pointer types", () => {
    // The global button :active rule must live OUTSIDE the fine-pointer hover
    // query so touch/iPad taps still get a brief pressed state.
    const { inside, outside } = locateSelector(stylesSource, "button:active");
    expect(outside.length).toBeGreaterThan(0);
    expect(inside).toEqual([]);
  });

  it("keeps collapse/expand button pressed feedback outside the hover query", () => {
    for (const selector of [
      ".panelCollapseBtn:active",
      ".collapseMini:active",
      ".cardCollapseBtn:active",
    ]) {
      const { inside, outside } = locateSelector(stylesSource, selector);
      expect(outside.length, `${selector} should be outside fine-pointer media`).toBeGreaterThan(0);
      expect(inside, `${selector} should not be gated behind hover media`).toEqual([]);
    }
  });

  it("does not neutralize :active inside coarse/touch pointer resets", () => {
    // Guard against a regression where a coarse-pointer block blanket-resets
    // active styling. We only allow the intentional numStepper exception.
    const coarseResets = stylesSource.match(
      /@media \(hover: none\)[\s\S]*?\{[\s\S]*?\}/g
    );
    if (coarseResets) {
      for (const block of coarseResets) {
        const touchesActive = block.includes(":active");
        const isNumStepperException = block.includes("numStepBtn");
        expect(
          !touchesActive || isNumStepperException,
          "coarse-pointer media must not blanket-reset :active styling"
        ).toBe(true);
      }
    }
  });

  it("keeps :focus-visible visually distinct from :active (ring, not fill)", () => {
    // The shared focus-visible rule uses an inset ring box-shadow, while the
    // pressed state uses a background fill. They must not collapse into one look.
    expect(stylesSource).toMatch(
      /button:focus-visible[\s\S]*?box-shadow: 0 0 0 2px var\(--ring\) inset;/
    );
    expect(stylesSource).toMatch(/button:active,\s*\.filebtn:active \{\s*background:/);
  });
});
