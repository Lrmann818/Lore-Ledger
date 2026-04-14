import { describe, expect, it } from "vitest";

import {
  notifyPanelDataChanged,
  subscribePanelDataChanged
} from "../js/ui/panelInvalidation.js";

describe("panelInvalidation", () => {
  it("notifies subscribers for the matching panel id with the source detail", () => {
    const source = {};
    const calls = [];
    const unsubscribe = subscribePanelDataChanged("spells", (detail) => calls.push(detail));

    expect(notifyPanelDataChanged("spells", { source })).toBe(1);

    expect(calls).toEqual([{ panelId: "spells", source }]);
    unsubscribe();
  });

  it("keeps panel ids isolated and unsubscribes safely", () => {
    const spellCalls = [];
    const vitalsCalls = [];
    const unsubscribeSpells = subscribePanelDataChanged("spells", (detail) => spellCalls.push(detail.panelId));
    const unsubscribeVitals = subscribePanelDataChanged("vitals", (detail) => vitalsCalls.push(detail.panelId));

    expect(notifyPanelDataChanged("spells")).toBe(1);
    unsubscribeSpells();
    expect(notifyPanelDataChanged("spells")).toBe(0);
    expect(notifyPanelDataChanged("vitals")).toBe(1);
    unsubscribeVitals();

    expect(spellCalls).toEqual(["spells"]);
    expect(vitalsCalls).toEqual(["vitals"]);
  });
});

