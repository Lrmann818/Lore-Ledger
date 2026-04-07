import { beforeEach, describe, expect, it, vi } from "vitest";

const { withAllowedStateMutationSpy } = vi.hoisted(() => ({
  withAllowedStateMutationSpy: vi.fn((fn) => fn())
}));

vi.mock("../js/utils/dev.js", () => ({
  DEV_MODE: true,
  withAllowedStateMutation: withAllowedStateMutationSpy
}));

import { createStateActions } from "../js/domain/stateActions.js";

function makeState(overrides = {}) {
  return {
    tracker: {
      npcs: [],
      party: [],
      locationsList: [],
      ...overrides.tracker
    },
    character: {
      ...overrides.character
    },
    map: {
      ...overrides.map
    },
    ...overrides
  };
}

function makeSubject(overrides = {}) {
  const state = overrides.state ?? makeState();
  const SaveManager = overrides.SaveManager ?? { markDirty: vi.fn() };

  return {
    state,
    SaveManager,
    actions: createStateActions({ state, SaveManager })
  };
}

describe("createStateActions", () => {
  beforeEach(() => {
    withAllowedStateMutationSpy.mockClear();
  });

  it("exposes the expected public helper surface", () => {
    const { actions } = makeSubject();

    expect(Object.keys(actions).sort()).toEqual([
      "addTrackerCard",
      "mutateCharacter",
      "mutateState",
      "mutateTracker",
      "removeTrackerCard",
      "setCardPortraitHidden",
      "setPath",
      "swapTrackerCards",
      "updateCharacterField",
      "updateMapField",
      "updateTrackerCardField",
      "updateTrackerField"
    ]);
  });

  it("throws when state is missing", () => {
    expect(() => createStateActions()).toThrow("createStateActions: state is required");
  });

  it("runs mutations through withAllowedStateMutation and queues saves by default", () => {
    const { actions, state, SaveManager } = makeSubject();

    const result = actions.mutateState((draft) => {
      draft.ui = { theme: "sepia" };
      return "ok";
    });

    expect(result).toBe("ok");
    expect(state.ui).toEqual({ theme: "sepia" });
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(1);
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);
  });

  it("preserves the false-result contract and skips save queueing when a mutator declines to update", () => {
    const { actions, SaveManager } = makeSubject();

    expect(actions.mutateTracker(() => false)).toBe(false);
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(1);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("supports array-style path segments and suppresses save queueing when queueSave is false", () => {
    const { actions, state, SaveManager } = makeSubject();

    expect(
      actions.updateCharacterField(["", "stats", "hp", "current", " "], 17, { queueSave: false })
    ).toBe(true);

    expect(state.character).toEqual({
      stats: {
        hp: {
          current: 17
        }
      }
    });
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(1);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("rejects empty or malformed paths without mutating state or queueing saves", () => {
    const { actions, state, SaveManager } = makeSubject({
      state: makeState({
        character: {
          existing: true
        }
      })
    });

    expect(actions.updateCharacterField("", "ignored")).toBe(false);
    expect(actions.updateCharacterField(null, "ignored")).toBe(false);
    expect(actions.updateCharacterField([], "ignored")).toBe(false);

    expect(state.character).toEqual({ existing: true });
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(3);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it("throws in DEV when helper paths try to write the legacy hitDieAmount alias", () => {
    const { actions, state, SaveManager } = makeSubject({
      state: makeState({
        character: {
          hitDieAmt: 4
        }
      })
    });

    expect(() => actions.updateCharacterField("hitDieAmount", 7)).toThrow(/hitDieAmt/);
    expect(() => actions.setPath("character.hitDieAmount", 7)).toThrow(/hitDieAmt/);
    expect(state.character).toEqual({ hitDieAmt: 4 });
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(2);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });

  it.each([
    "__proto__.polluted",
    "constructor.prototype.polluted",
    "prototype.polluted",
    "__defineGetter__.polluted",
    "__defineSetter__.polluted"
  ])("blocks unsafe string path segment %s", (path) => {
    const { actions, SaveManager } = makeSubject();

    expect(() => actions.setPath(path, "owned")).toThrow(/Unsafe path segment/);
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(1);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
    expect({}.polluted).toBeUndefined();
  });

  it.each([
    { path: ["safe", "__proto__", "polluted"] },
    { path: ["safe", "constructor", "polluted"] },
    { path: ["safe", "prototype", "polluted"] },
    { path: ["safe", "__defineGetter__", "polluted"] },
    { path: ["safe", "__defineSetter__", "polluted"] }
  ])("blocks unsafe array path segments $path", ({ path }) => {
    const { actions, SaveManager } = makeSubject();

    expect(() => actions.setPath(path, "owned")).toThrow(/Unsafe path segment/);
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(1);
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
    expect({}.polluted).toBeUndefined();
  });

  it("normalizes tracker card type aliases to the expected backing lists", () => {
    const { actions, state, SaveManager } = makeSubject({
      state: makeState({
        tracker: {
          npcs: [{ id: "npc-1", name: "Scout" }],
          party: [{ id: "party-1", name: "Tess" }],
          locationsList: [{ id: "loc-1", name: "The Docks" }]
        }
      })
    });

    expect(actions.updateTrackerCardField("  NpC  ", "npc-1", "name", "Watcher")).toBe(true);
    expect(actions.setCardPortraitHidden(" PARTY ", "party-1", 1)).toBe(true);
    expect(actions.updateTrackerCardField(" locationsList ", "loc-1", "name", "Old Harbor")).toBe(true);

    expect(state.tracker.npcs[0].name).toBe("Watcher");
    expect(state.tracker.party[0].portraitHidden).toBe(true);
    expect(state.tracker.locationsList[0].name).toBe("Old Harbor");
    expect(withAllowedStateMutationSpy).toHaveBeenCalledTimes(3);
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(3);
  });

  it("rejects unknown tracker card types before entering the mutation wrapper", () => {
    const { actions, state, SaveManager } = makeSubject({
      state: makeState({
        tracker: {
          npcs: [{ id: "npc-1", name: "Scout" }]
        }
      })
    });

    expect(actions.updateTrackerCardField("dragon", "npc-1", "name", "Watcher")).toBe(false);
    expect(actions.addTrackerCard("dragon", { id: "npc-2", name: "Mage" })).toBe(false);
    expect(actions.removeTrackerCard("dragon", "npc-1")).toBeNull();
    expect(actions.swapTrackerCards("dragon", "a", "b")).toBe(false);

    expect(state.tracker.npcs).toEqual([{ id: "npc-1", name: "Scout" }]);
    expect(withAllowedStateMutationSpy).not.toHaveBeenCalled();
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
  });
});
