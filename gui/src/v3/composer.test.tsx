import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer, chipOf, tokenAt } from "./composer.js";

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = { running: false, queued: 0, mode: "default" as const, onMode: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), commands: ["compact", "review", "clear"], findFiles: vi.fn(async (q: string) => [`src/${q || "a"}.ts`, "README.md"]), ...over };
  render(<Composer {...props} />);
  return { ...props, box: screen.getByLabelText("Message") as HTMLTextAreaElement };
}
const type = (box: HTMLTextAreaElement, v: string) => {
  fireEvent.change(box, { target: { value: v, selectionStart: v.length } });
};

describe("tokenAt", () => {
  it("finds @ anywhere and / only at the start", () => {
    expect(tokenAt("look at @src/st", 15)).toEqual({ kind: "@", query: "src/st", start: 8 });
    expect(tokenAt("/rev", 4)).toEqual({ kind: "/", query: "rev", start: 0 });
    expect(tokenAt("a/b", 3)).toBeNull();
    expect(tokenAt("mail me@x", 9)).toBeNull();
  });
});

describe("Composer", () => {
  it("Enter sends text and chips, Shift+Enter does not, ⌘. stops", () => {
    const c = setup({ running: true });
    expect(c.box.placeholder).toBe("Queue a message — sent when this turn ends · @ files · / commands · drop images");
    type(c.box, "hello");
    fireEvent.keyDown(c.box, { key: "Enter", shiftKey: true });
    expect(c.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(c.box, { key: "Enter" });
    expect(c.onSend).toHaveBeenCalledWith("hello", []);
    expect(c.box.value).toBe("");
    fireEvent.keyDown(c.box, { key: ".", metaKey: true });
    expect(c.onStop).toHaveBeenCalled();
  });

  it("@ suggests repository files; picking one becomes an @file chip sent as a path", async () => {
    const c = setup();
    type(c.box, "fix @sto");
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Files" })).toBeTruthy());
    expect(c.findFiles).toHaveBeenLastCalledWith("sto");
    fireEvent.mouseDown(screen.getByText("src/sto.ts"));
    expect(screen.getByText("@src/sto.ts")).toBeTruthy();
    expect(c.box.value).toBe("fix ");
    fireEvent.keyDown(c.box, { key: "Enter" });
    expect(c.onSend).toHaveBeenCalledWith("fix", [{ path: "src/sto.ts" }]);
  });

  it("/ at the start suggests the agent's commands; Tab picks the first", async () => {
    const c = setup();
    type(c.box, "/re");
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["/review"]);
    fireEvent.keyDown(c.box, { key: "Tab" });
    expect(c.box.value).toBe("/review ");
  });

  it("a pasted image becomes an image chip; Stop is off while idle; Queue needs content", async () => {
    const c = setup();
    expect((screen.getByText("Stop").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Queue").closest("button") as HTMLButtonElement).disabled).toBe(true);
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(c.box, { clipboardData: { files: [png] } });
    });
    await waitFor(() => expect(screen.getByText("shot.png")).toBeTruthy());
    fireEvent.click(screen.getByText("Queue"));
    expect(c.onSend).toHaveBeenCalledWith("", [{ image: { mediaType: "image/png", data: "iVBORw==" } }]);
  });

  it("the mode menu offers the three modes, never a bypass", () => {
    const c = setup();
    fireEvent.click(screen.getByText("Ask before edits"));
    expect(screen.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["Ask before edits", "Edit without asking", "Plan only"]);
    fireEvent.click(screen.getByText("Plan only"));
    expect(c.onMode).toHaveBeenCalledWith("plan");
  });

  it("chipOf: a non-image file is sent by name and bytes; the bridge stages it", async () => {
    const chip = await chipOf(new File(["hi"], "notes.txt", { type: "text/plain" }));
    expect(chip.attachment).toEqual({ file: { name: "notes.txt", data: "aGk=" } });
    expect(chip.kind).toBe("file");
  });
});
