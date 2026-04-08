import { describe, expect, it, vi } from "vitest";

describe("support helpers", () => {
  it("formats safe debug info and a valid encoded mailto URL", async () => {
    const {
      buildBugReportMailtoUrl,
      buildDebugInfoText,
      collectDebugInfoSnapshot
    } = await import("../js/ui/support.js");

    const debugInfo = buildDebugInfoText({
      version: "1.2.3",
      build: "abc123",
      runtimeMode: "pwa",
      currentRoute: "#map",
      timestamp: "2026-04-08T12:34:56.000Z",
      userAgent: "LoreLedgerTest/1.0"
    });

    expect(debugInfo).toBe(
      [
        "App version: 1.2.3",
        "Build id: abc123",
        "Runtime mode: pwa",
        "Current page: #map",
        "Timestamp: 2026-04-08T12:34:56.000Z",
        "User agent: LoreLedgerTest/1.0"
      ].join("\n")
    );

    const mailtoUrl = buildBugReportMailtoUrl({
      recipient: "support@example.com",
      debugInfoText: debugInfo
    });

    expect(mailtoUrl.startsWith("mailto:support%40example.com?")).toBe(true);

    const params = new URLSearchParams(mailtoUrl.split("?")[1]);
    expect(params.get("subject")).toBe("Lore Ledger Bug Report");
    expect(params.get("body")).toContain("Please describe the bug:");
    expect(params.get("body")).toContain("What happened instead?");
    expect(params.get("body")).toContain("Debug info:");
    expect(params.get("body")).toContain("App version: 1.2.3");

    const snapshot = collectDebugInfoSnapshot({
      version: "1.2.3",
      build: "abc123",
      fallbackPage: "tracker",
      locationObj: {
        hash: "",
        pathname: "/",
        search: "?notes=secret"
      },
      navigatorObj: {
        userAgent: "LoreLedgerTest/1.0"
      },
      windowObj: {
        matchMedia: () => ({ matches: false })
      },
      timestamp: "2026-04-08T12:34:56.000Z"
    });

    expect(snapshot.currentRoute).toBe("#tracker");
    expect(buildDebugInfoText(snapshot)).not.toContain("secret");
  });

  it("falls back to execCommand copy when the async clipboard API is unavailable", async () => {
    const { copyPlainText } = await import("../js/ui/support.js");

    const appendChild = vi.fn();
    const remove = vi.fn();
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove
    };
    const documentObj = {
      body: { appendChild },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true)
    };

    await expect(copyPlainText("Debug block", { clipboard: null, documentObj })).resolves.toBe(true);

    expect(documentObj.createElement).toHaveBeenCalledWith("textarea");
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(documentObj.execCommand).toHaveBeenCalledWith("copy");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("falls back to execCommand copy when async clipboard write fails", async () => {
    const { copyPlainText } = await import("../js/ui/support.js");

    const appendChild = vi.fn();
    const remove = vi.fn();
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove
    };
    const documentObj = {
      body: { appendChild },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true)
    };
    const clipboard = {
      writeText: vi.fn(async () => {
        throw new Error("denied");
      })
    };

    await expect(copyPlainText("Debug block", { clipboard, documentObj })).resolves.toBe(true);

    expect(clipboard.writeText).toHaveBeenCalledWith("Debug block");
    expect(documentObj.execCommand).toHaveBeenCalledWith("copy");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
