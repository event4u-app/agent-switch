import { afterEach, describe, expect, it, vi } from "vitest";

import { latestToolVersion, toolUpdateAvailable, versionToken, NPM_PACKAGES, RTK_REPO } from "./tool-updates.js";

describe("latestToolVersion", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("rtk: reads the GitHub latest release (via updates.ts) and strips the leading v", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ tag_name: "v0.43.0", html_url: "u", body: "", published_at: "" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;
    await expect(latestToolVersion("rtk")).resolves.toBe("0.43.0");
    expect(fetchMock).toHaveBeenCalledWith(`https://api.github.com/repos/${RTK_REPO}/releases/latest`, expect.anything());
  });

  it("claude/codex: read the npm registry's latest dist-tag version", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ version: "2.5.0" }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;
    await expect(latestToolVersion("claude")).resolves.toBe("2.5.0");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://registry.npmjs.org/${NPM_PACKAGES.claude}/latest`,
      expect.anything(),
    );
    await expect(latestToolVersion("codex")).resolves.toBe("2.5.0");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://registry.npmjs.org/${NPM_PACKAGES.codex}/latest`,
      expect.anything(),
    );
  });

  it("returns null for agent-config and agy WITHOUT fetching (App owns agent-config's detection)", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(latestToolVersion("agent-config")).resolves.toBeNull();
    await expect(latestToolVersion("agy")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws — network failure, HTTP error, rate limit, and malformed body all → null", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(latestToolVersion("rtk")).resolves.toBeNull();
    await expect(latestToolVersion("claude")).resolves.toBeNull();
    // GitHub rate limit (403) → fetchLatestRelease throws → swallowed to null.
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 403, ok: false } as Response);
    await expect(latestToolVersion("rtk")).resolves.toBeNull();
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response);
    await expect(latestToolVersion("codex")).resolves.toBeNull();
    // A 200 without a usable version string is still "unknown".
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({}) } as unknown as Response);
    await expect(latestToolVersion("claude")).resolves.toBeNull();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ status: 200, ok: true, json: async () => ({ version: 42 }) } as unknown as Response);
    await expect(latestToolVersion("codex")).resolves.toBeNull();
  });
});

describe("versionToken", () => {
  it("extracts the leading dotted-number token, stripping a leading v", () => {
    expect(versionToken("v0.43.0")).toBe("0.43.0");
    expect(versionToken("1.2.3-beta.1")).toBe("1.2.3");
    expect(versionToken("1.2.3 (build 7)")).toBe("1.2.3");
    expect(versionToken(" 2.0 ")).toBe("2.0");
  });
  it("returns null for garbage with no leading number", () => {
    expect(versionToken("garbage")).toBeNull();
    expect(versionToken("")).toBeNull();
    expect(versionToken("version 1.2.3")).toBeNull(); // not LEADING — not comparable
  });
});

describe("toolUpdateAvailable", () => {
  const entry = (version: string | null) => ({ version });

  it("true only when latest is strictly newer than the installed version", () => {
    expect(toolUpdateAvailable(entry("0.34.3"), "v0.43.0")).toBe(true);
    expect(toolUpdateAvailable(entry("1.2.3"), "1.2.3")).toBe(false); // equal is not newer
    expect(toolUpdateAvailable(entry("2.0.0"), "1.9.9")).toBe(false);
  });

  it("normalizes v prefixes and trailing suffixes on both sides", () => {
    expect(toolUpdateAvailable(entry("v1.2.3"), "1.3.0-beta.1")).toBe(true);
    expect(toolUpdateAvailable(entry("1.2.3 (build 7)"), "v1.2.4")).toBe(true);
    expect(toolUpdateAvailable(entry("1.2.4+meta"), "1.2.4")).toBe(false);
  });

  it("unknown or garbage on either side → false (no speculative button)", () => {
    expect(toolUpdateAvailable(entry(null), "1.0.0")).toBe(false);
    expect(toolUpdateAvailable(entry("1.0.0"), null)).toBe(false);
    expect(toolUpdateAvailable(entry("garbage"), "1.0.0")).toBe(false);
    expect(toolUpdateAvailable(entry("1.0.0"), "garbage")).toBe(false);
  });
});
