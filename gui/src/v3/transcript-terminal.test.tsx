import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TranscriptTerminal } from "./transcript-terminal.js";
import type { AsEvent } from "./timeline.js";

afterEach(cleanup);

describe("transcript in terminal style (own terminal, read-only)", () => {
  it("draws the prompt, the reply and tool lines the way the CLI does", () => {
    const events: AsEvent[] = [
      { t: "turn", id: "t1", at: null },
      { t: "message", id: "m1", role: "user", text: "measure p95", images: 0 },
      { t: "tool.started", id: "x1", name: "Bash", summary: "hyperfine --runs 200", input: {}, parentToolId: null },
      { t: "tool.finished", id: "x1", ok: true, summary: "p95 6.2 ms" },
      { t: "message", id: "m2", role: "assistant", text: "6.7× faster", images: 0 },
    ];
    const { container } = render(<TranscriptTerminal events={events} />);
    const text = container.textContent ?? "";
    expect(text).toContain("> measure p95");
    expect(text).toContain("● Bash(hyperfine --runs 200)");
    expect(text).toContain("6.7× faster");
    expect(screen.getByLabelText("Transcript in terminal style, read-only")).toBeTruthy();
  });

  it("says so when there is nothing yet", () => {
    render(<TranscriptTerminal events={[]} />);
    expect(screen.getByText("Nothing in the transcript yet.")).toBeTruthy();
  });
});
