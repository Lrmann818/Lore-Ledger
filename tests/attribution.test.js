// Release-gate pin for the CC-BY-4.0 attribution (matrix #20).
//
// Distributing SRD-derived builtin content without the attribution statement
// does not satisfy the license (docs/reference/attribution-requirements.md).
// LEGAL.md is the canonical statement; the in-app surface is the About dialog
// inside the Data & Settings modal (js/ui/dataPanel.js). This test fails if
// either copy drifts or silently disappears.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_PHRASES = [
  'System Reference Document 5.1',
  'Wizards of the Coast LLC',
  "dnd.wizards.com/resources/systems-reference-document",
  "Creative Commons Attribution 4.0",
  "creativecommons.org/licenses/by/4.0/legalcode"
];

describe("CC-BY-4.0 attribution", () => {
  it("keeps the canonical statement in LEGAL.md", () => {
    const legal = readFileSync(resolve(process.cwd(), "LEGAL.md"), "utf8");
    for (const phrase of REQUIRED_PHRASES) {
      expect(legal).toContain(phrase);
    }
  });

  it("keeps the in-app About dialog attribution in sync with LEGAL.md", () => {
    const dataPanel = readFileSync(resolve(process.cwd(), "js/ui/dataPanel.js"), "utf8");
    for (const phrase of REQUIRED_PHRASES) {
      expect(dataPanel).toContain(phrase);
    }
    // The About surface labels it explicitly so users can find it.
    expect(dataPanel).toContain("Legal / Licenses:");
  });
});
