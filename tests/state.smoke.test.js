import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, migrateState } from "../js/state.js";

describe("state test runner smoke test", () => {
  it("loads migrateState from the app code", () => {
    expect(typeof migrateState).toBe("function");
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
