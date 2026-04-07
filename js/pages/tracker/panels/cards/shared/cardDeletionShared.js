import { commitStateChangeWithDeferredBlobDeletion } from "../../../../../storage/blobReplacement.js";

/** @typedef {typeof import("../../../../../storage/blobs.js").deleteBlob} DeleteBlobFn */
/** @typedef {import("../../../../../storage/saveManager.js").SaveManager} SaveManager */

/** @type {Readonly<Record<string, "npcs" | "party" | "locationsList">>} */
const TRACKER_LIST_KEYS = Object.freeze({
  npc: "npcs",
  npcs: "npcs",
  party: "party",
  location: "locationsList",
  locations: "locationsList",
  locationslist: "locationsList",
});

/**
 * @param {{
 *   type?: string,
 *   itemId?: string,
 *   getItemById?: (itemId: string | undefined) => { imgBlobId?: string | null } | null,
 *   mutateTracker?: (mutator: (tracker: Record<string, unknown>) => unknown, options?: { queueSave?: boolean }) => unknown,
 *   SaveManager?: SaveManager,
 *   deleteBlob?: DeleteBlobFn
 * }} options
 * @returns {Promise<boolean>}
 */
export async function deleteTrackerCardWithBlobCleanup({
  type,
  itemId,
  getItemById,
  mutateTracker,
  SaveManager,
  deleteBlob,
} = {}) {
  if (typeof getItemById !== "function") {
    throw new Error("deleteTrackerCardWithBlobCleanup: getItemById is required");
  }
  if (typeof mutateTracker !== "function") {
    throw new Error("deleteTrackerCardWithBlobCleanup: mutateTracker is required");
  }

  const listKey = TRACKER_LIST_KEYS[String(type || "").trim().toLowerCase()];
  if (!listKey) {
    throw new Error(`deleteTrackerCardWithBlobCleanup: unsupported tracker card type "${String(type || "")}"`);
  }

  const existingItem = getItemById(itemId);
  if (!existingItem) return false;

  const oldBlobId = existingItem.imgBlobId || null;
  let removedItem = null;
  let removedIndex = -1;

  await commitStateChangeWithDeferredBlobDeletion({
    SaveManager,
    deleteBlob,
    blobIdsToDelete: [oldBlobId],
    applyStateChange: () => mutateTracker((tracker) => {
      const list = Array.isArray(tracker[listKey]) ? tracker[listKey] : null;
      if (!list) return false;
      const nextIndex = list.findIndex((item) => item && item.id === itemId);
      if (nextIndex === -1) return false;
      removedIndex = nextIndex;
      [removedItem] = list.splice(nextIndex, 1);
      return !!removedItem;
    }, { queueSave: false }),
    rollbackStateChange: () => {
      if (!removedItem || removedIndex < 0) return false;
      return mutateTracker((tracker) => {
        const list = Array.isArray(tracker[listKey]) ? tracker[listKey] : null;
        if (!list) return false;
        const insertAt = Math.max(0, Math.min(removedIndex, list.length));
        list.splice(insertAt, 0, removedItem);
        return true;
      }, { queueSave: false });
    },
  });

  return true;
}
