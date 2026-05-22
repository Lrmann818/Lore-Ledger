// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createImagePicker } from "../js/features/imagePicker.js";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Yield enough microtask turns for _pickOnce to run and attach listeners. */
async function waitTicks(n = 12) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function getFileInput() {
  return /** @type {HTMLInputElement | null} */ (document.querySelector('input[type="file"]'));
}

describe("image picker", () => {
  it("returns the selected File when the user picks one", async () => {
    const picker = createImagePicker({ accept: "image/*" });
    const pickPromise = picker.pickOne({ accept: "image/*" });

    await waitTicks();

    const input = getFileInput();
    const file = new File(["img"], "portrait.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: { 0: file, length: 1 }, configurable: true });
    input.dispatchEvent(new Event("change"));

    expect(await pickPromise).toBe(file);
  });

  it("returns null when the user cancels via the cancel event", async () => {
    const picker = createImagePicker({ accept: "image/*" });
    const pickPromise = picker.pickOne();

    await waitTicks();

    getFileInput().dispatchEvent(new Event("cancel"));

    expect(await pickPromise).toBeNull();
  });

  it("uses image/* accept so the native iOS action sheet offers Photo Library, Take Photo, and Files", async () => {
    const picker = createImagePicker();
    const pickPromise = picker.pick();

    await waitTicks();

    const input = getFileInput();
    expect(input?.accept).toBe("image/*");

    // Clean up: cancel the pending pick
    input.dispatchEvent(new Event("cancel"));
    await pickPromise;
  });

  it("does not show any in-app source chooser overlay", async () => {
    const picker = createImagePicker({ accept: "image/*" });
    const pickPromise = picker.pick();

    await waitTicks();

    expect(document.querySelector(".modalOverlay")).toBeNull();

    getFileInput().dispatchEvent(new Event("cancel"));
    await pickPromise;
  });

  it("serializes concurrent pick requests so a second call does not race the first", async () => {
    const picker = createImagePicker({ accept: "image/*" });

    const firstPick = picker.pick();
    await waitTicks();

    const input = getFileInput();

    // Second pick is queued, not a concurrent race
    const secondPick = picker.pick();

    // Resolve the first pick
    const file = new File(["img"], "portrait.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: { 0: file, length: 1 }, configurable: true });
    input.dispatchEvent(new Event("change"));

    const firstResult = await firstPick;
    expect(firstResult[0]).toBe(file);

    // Second pick now runs; cancel it
    await waitTicks();
    input.dispatchEvent(new Event("cancel"));

    const secondResult = await secondPick;
    expect(secondResult).toEqual([]);
  });
});
