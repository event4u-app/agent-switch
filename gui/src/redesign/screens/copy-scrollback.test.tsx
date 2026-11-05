import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CopyScrollback } from "./terminal-sheet.js";

afterEach(cleanup);

describe("CopyScrollback (road-to-a-chat-that-reads-well 3.2)", () => {
  it("copies what the terminal holds when clicked, and nothing when it is empty", async () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const read = vi.fn(() => "line 1\nline 2");
    const { rerender } = render(<CopyScrollback read={read} />);
    expect(read).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getByRole("button")));
    expect(writeText).toHaveBeenCalledWith("line 1\nline 2");
    rerender(<CopyScrollback read={() => ""} />);
    writeText.mockClear();
    await act(async () => void fireEvent.click(screen.getByRole("button")));
    expect(writeText).not.toHaveBeenCalled();
  });
});
