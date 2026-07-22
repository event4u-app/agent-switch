import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getVersion } = vi.hoisted(() => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));

import {
  parseVersion,
  compareVersions,
  isNewer,
  parseRelease,
  checkForUpdate,
  fetchLatestRelease,
  releaseKind,
} from "./updates.js";

describe("releaseKind", () => {
  it("classifies the bump by the highest changed component", () => {
    expect(releaseKind("1.2.3", "2.0.0")).toBe("major");
    expect(releaseKind("1.2.3", "2.5.9")).toBe("major"); // major wins even if minor/patch also jump
    expect(releaseKind("1.2.3", "1.3.0")).toBe("minor");
    expect(releaseKind("1.2.3", "1.2.4")).toBe("patch");
  });
  it("returns null when latest is not strictly newer", () => {
    expect(releaseKind("1.2.3", "1.2.3")).toBeNull();
    expect(releaseKind("1.2.3", "1.2.0")).toBeNull();
    expect(releaseKind("2.0.0", "1.9.9")).toBeNull();
  });
  it("tolerates a leading v and missing components", () => {
    expect(releaseKind("1.2.3", "v1.2.4")).toBe("patch");
    expect(releaseKind("1.0.0", "1.1")).toBe("minor"); // 1.1 == 1.1.0
  });
});

describe("parseVersion", () => {
  it("strips a leading v and splits on dots", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });
  it("drops pre-release and build metadata", () => {
    expect(parseVersion("v2.0.0-beta.1")).toEqual([2, 0, 0]);
    expect(parseVersion("1.4.0+build.7")).toEqual([1, 4, 0]);
  });
  it("collapses non-numeric or missing components to 0 instead of throwing", () => {
    expect(parseVersion("v1.x.3")).toEqual([1, 0, 3]);
    expect(parseVersion("garbage")).toEqual([0]);
  });
});

describe("compareVersions", () => {
  it("orders by numeric component, left to right", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1); // numeric, not lexical
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });
  it("treats a missing trailing component as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });
  it("is v-prefix agnostic", () => {
    expect(compareVersions("v1.1.0", "1.1.0")).toBe(0);
  });
});

describe("isNewer", () => {
  it("is strictly-greater — equal is not newer", () => {
    expect(isNewer("1.1.0", "1.0.0")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0.0", "1.1.0")).toBe(false);
  });
});

describe("parseRelease", () => {
  const base = {
    tag_name: "v1.1.0",
    name: "Release 1.1.0",
    html_url: "https://github.com/event4u-app/agent-switch/releases/tag/v1.1.0",
    body: "notes",
    published_at: "2026-07-16T00:00:00Z",
  };
  it("reshapes a well-formed payload", () => {
    expect(parseRelease(base)).toEqual({
      tag: "v1.1.0",
      name: "Release 1.1.0",
      url: "https://github.com/event4u-app/agent-switch/releases/tag/v1.1.0",
      notes: "notes",
      publishedAt: "2026-07-16T00:00:00Z",
    });
  });
  it("rejects drafts and prereleases", () => {
    expect(parseRelease({ ...base, draft: true })).toBeNull();
    expect(parseRelease({ ...base, prerelease: true })).toBeNull();
  });
  it("rejects a payload with no tag", () => {
    expect(parseRelease({ ...base, tag_name: undefined })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
  it("falls back to the tag for a missing name and a repo URL for a missing html_url", () => {
    const r = parseRelease({ tag_name: "v2.0.0" });
    expect(r?.name).toBe("v2.0.0");
    expect(r?.url).toBe("https://github.com/event4u-app/agent-switch/releases");
  });
});

describe("fetchLatestRelease", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });
  it("returns null on 404 (no releases yet)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response);
    await expect(fetchLatestRelease("owner/repo")).resolves.toBeNull();
  });
  it("throws on a non-404 HTTP failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 500, ok: false } as Response);
    await expect(fetchLatestRelease("owner/repo")).rejects.toThrow("500");
  });
  it("parses a 200 payload", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ tag_name: "v1.2.0", html_url: "u", body: "b", published_at: "p" }),
    } as unknown as Response);
    const r = await fetchLatestRelease("owner/repo");
    expect(r?.tag).toBe("v1.2.0");
  });
});

describe("checkForUpdate", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => getVersion.mockResolvedValue("1.0.0"));
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockRelease(tag: string) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ tag_name: tag, html_url: "u", body: "", published_at: "" }),
    } as unknown as Response);
  }

  it("classifies a newer release as available", async () => {
    mockRelease("v1.1.0");
    const r = await checkForUpdate("owner/repo");
    expect(r.kind).toBe("available");
    if (r.kind === "available") expect(r.release.tag).toBe("v1.1.0");
  });
  it("classifies the same version as uptodate", async () => {
    mockRelease("v1.0.0");
    const r = await checkForUpdate("owner/repo");
    expect(r).toEqual({ kind: "uptodate", current: "1.0.0", latest: "v1.0.0" });
  });
  it("classifies a 404 as no-releases", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response);
    const r = await checkForUpdate("owner/repo");
    expect(r).toEqual({ kind: "no-releases", current: "1.0.0" });
  });
  it("never throws — a network failure becomes an error result", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const r = await checkForUpdate("owner/repo");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toBe("offline");
  });
});
