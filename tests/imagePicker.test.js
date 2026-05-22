// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createImagePicker,
  isNativeIosRuntime,
  promptForNativeImageSource
} from "../js/features/imagePicker.js";

function makeNativeCameraApi(overrides = {}) {
  const { Camera: cameraOverrides = {}, ...restOverrides } = overrides;
  const camera = {
    checkPermissions: vi.fn(async () => ({ camera: "granted", photos: "granted" })),
    requestPermissions: vi.fn(async () => ({ camera: "granted", photos: "granted" })),
    getPhoto: vi.fn(async () => ({
      webPath: "https://example.test/photo.jpg",
      format: "jpeg"
    })),
    ...cameraOverrides
  };

  return {
    Camera: camera,
    CameraResultType: { Uri: "uri" },
    CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
    ...restOverrides
  };
}

function makeNativeRuntime() {
  return {
    locationObj: { protocol: "capacitor:" },
    navigatorObj: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5
    }
  };
}

async function waitForCalls(spy, expected) {
  for (let i = 0; i < 20; i += 1) {
    if (spy.mock.calls.length === expected) return;
    await Promise.resolve();
  }
  expect(spy).toHaveBeenCalledTimes(expected);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("image picker", () => {
  it("detects native iOS runtime only when Capacitor/native iOS signals are present", () => {
    expect(isNativeIosRuntime(makeNativeRuntime())).toBe(true);

    expect(
      isNativeIosRuntime({
        locationObj: { protocol: "https:" },
        navigatorObj: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          platform: "MacIntel",
          maxTouchPoints: 0
        },
        capacitorObj: { isNativePlatform: () => false }
      })
    ).toBe(false);
  });

  it("cleans up the native source prompt after a selection", async () => {
    const choicePromise = promptForNativeImageSource();
    const filesBtn = Array.from(document.querySelectorAll("button")).find((btn) => btn.textContent === "Files");
    expect(filesBtn).toBeTruthy();

    filesBtn.click();

    await expect(choicePromise).resolves.toBe("files");
    expect(document.querySelector(".modalOverlay")).toBeNull();
  });

  it("uses the native camera branch on iOS and returns a File", async () => {
    const cameraApi = makeNativeCameraApi();
    const fetchImpl = vi.fn(async () => new Response(
      new Blob(["jpeg-data"], { type: "image/jpeg" }),
      { headers: { "Content-Type": "image/jpeg" } }
    ));
    const picker = createImagePicker({
      accept: "image/*",
      chooseNativeSource: vi.fn(async () => "camera"),
      cameraApi,
      fetchImpl,
      ...makeNativeRuntime()
    });

    const file = await picker.pickOne({ accept: "image/*" });

    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toBe("lore-ledger-camera.jpg");
    expect(cameraApi.Camera.checkPermissions).toHaveBeenCalledTimes(1);
    expect(cameraApi.Camera.getPhoto).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://example.test/photo.jpg");
  });

  it("shows a user-facing message and skips launch when camera permission is denied", async () => {
    const cameraApi = makeNativeCameraApi({
      Camera: {
        checkPermissions: vi.fn(async () => ({ camera: "prompt", photos: "granted" })),
        requestPermissions: vi.fn(async () => ({ camera: "denied", photos: "granted" })),
        getPhoto: vi.fn(async () => ({
          webPath: "https://example.test/photo.jpg",
          format: "jpeg"
        }))
      }
    });
    const uiAlert = vi.fn(async () => {});
    const setStatus = vi.fn();
    const picker = createImagePicker({
      accept: "image/*",
      chooseNativeSource: vi.fn(async () => "camera"),
      cameraApi,
      uiAlert,
      setStatus,
      ...makeNativeRuntime()
    });

    const file = await picker.pickOne({ accept: "image/*" });

    expect(file).toBeNull();
    expect(cameraApi.Camera.getPhoto).not.toHaveBeenCalled();
    expect(uiAlert).toHaveBeenCalledWith(
      "Camera access is turned off. Enable Camera for Lore Ledger in Settings to take character or campaign photos.",
      { title: "Camera Access Needed" }
    );
    expect(setStatus).toHaveBeenCalledWith(
      "Camera access is turned off. Enable Camera for Lore Ledger in Settings to take character or campaign photos."
    );
  });

  it("prevents duplicate native launches while the camera flow is already in progress", async () => {
    let resolvePhoto;
    const cameraApi = makeNativeCameraApi({
      Camera: {
        getPhoto: vi.fn(
          () =>
            new Promise((resolve) => {
              resolvePhoto = resolve;
            })
        )
      }
    });
    const fetchImpl = vi.fn(async () => new Response(
      new Blob(["jpeg-data"], { type: "image/jpeg" }),
      { headers: { "Content-Type": "image/jpeg" } }
    ));
    const picker = createImagePicker({
      accept: "image/*",
      chooseNativeSource: vi.fn(async () => "camera"),
      cameraApi,
      fetchImpl,
      ...makeNativeRuntime()
    });

    const firstPick = picker.pickOne({ accept: "image/*" });
    const secondPick = await picker.pickOne({ accept: "image/*" });

    expect(secondPick).toBeNull();
    await waitForCalls(cameraApi.Camera.getPhoto, 1);

    resolvePhoto({
      webPath: "https://example.test/photo.jpg",
      format: "jpeg"
    });

    await expect(firstPick).resolves.toBeInstanceOf(File);
    expect(cameraApi.Camera.getPhoto).toHaveBeenCalledTimes(1);
  });

  it("treats native camera cancellation as a clean null result", async () => {
    const cameraApi = makeNativeCameraApi({
      Camera: {
        getPhoto: vi.fn(async () => {
          throw new Error("User cancelled photos app");
        })
      }
    });
    const uiAlert = vi.fn(async () => {});
    const picker = createImagePicker({
      accept: "image/*",
      chooseNativeSource: vi.fn(async () => "camera"),
      cameraApi,
      uiAlert,
      ...makeNativeRuntime()
    });

    await expect(picker.pickOne({ accept: "image/*" })).resolves.toBeNull();
    expect(uiAlert).not.toHaveBeenCalled();
  });
});
