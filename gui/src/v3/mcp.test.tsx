import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { McpView } from "./mcp.js";
import { McpHost } from "./adapter/McpHost.js";
import type { McpAccountJson } from "../ipc.js";

afterEach(cleanup);

const A: McpAccountJson[] = [
  { key: "claude/work", provider: "claude", account: "work", configFile: "/Users/me/.agent-switch/claude/work/config/.claude.json", servers: [{ name: "github", transport: "http", scope: "user" }, { name: "db", transport: "sse", scope: "/Users/me/code/app" }], plugins: [{ name: "review@official", enabled: false }] },
  { key: "codex/me", provider: "codex", account: "me", configFile: "/home/me/.codex/config.toml", servers: [], plugins: [] },
];

describe("MCP & plugins", () => {
  it("per account: servers with transport and scope, plugins, the config file, Reveal config; nothing configured says so", () => {
    const onReveal = vi.fn();
    render(<McpView accounts={A} loading={false} onReveal={onReveal} />);
    expect(screen.getByText("github")).toBeTruthy();
    expect(screen.getByText("MCP · http")).toBeTruthy();
    expect(screen.getByText("every project")).toBeTruthy();
    expect(screen.getByText("~/code/app")).toBeTruthy();
    expect(screen.getByText("plugin · off")).toBeTruthy();
    expect(screen.getByText("~/.agent-switch/claude/work/config/.claude.json")).toBeTruthy();
    expect(screen.getByText("No MCP servers or plugins configured.")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Reveal config")[1]);
    expect(onReveal).toHaveBeenCalledWith("codex/me");
    expect(screen.getByText(/Agent Switch installs nothing/)).toBeTruthy();
  });

  it("the host reads the CLI once and reports a failure", async () => {
    const io = { mcpList: vi.fn(async () => A), mcpOpen: vi.fn(async () => {}) };
    render(<McpHost toast={vi.fn()} io={io} />);
    await waitFor(() => expect(screen.getByText("github")).toBeTruthy());
    const toast = vi.fn();
    cleanup();
    render(<McpHost toast={toast} io={{ mcpList: vi.fn(async () => Promise.reject(new Error("boom"))), mcpOpen: vi.fn() }} />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ tone: "alert", text: "Could not read the MCP configuration: boom" }));
  });
});
