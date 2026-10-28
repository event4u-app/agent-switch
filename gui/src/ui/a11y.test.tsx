import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Segmented } from "./Segmented.js";
import { Toaster } from "./Toaster.js";

afterEach(cleanup);

describe("Segmented", () => {
  const options = [
    { value: "a", label: "A", disabled: true, why: "A is not available" },
    { value: "b", label: "B" },
    { value: "c", label: "C" },
  ];

  it("keeps the group reachable by Tab when the value matches no option", () => {
    render(<Segmented label="Pick" value="" onChange={() => {}} options={options} />);
    const tabbable = screen.getAllByRole("radio").filter((r) => r.tabIndex === 0);
    expect(tabbable.map((r) => r.textContent)).toEqual(["B"]);
  });

  it("only the selected option is tabbable otherwise", () => {
    render(<Segmented label="Pick" value="c" onChange={() => {}} options={options} />);
    expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0).map((r) => r.textContent)).toEqual(["C"]);
  });

  it("a disabled option's reason is in its accessible description, not only a tooltip", () => {
    render(<Segmented label="Pick" value="b" onChange={() => {}} options={options} />);
    const a = screen.getByRole("radio", { name: "A" });
    const id = a.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe("A is not available");
  });
});

describe("Toaster", () => {
  it("keeps its live regions mounted with no toasts, so the first toast is announced", () => {
    const { rerender } = render(<Toaster toasts={[]} onDismiss={() => {}} />);
    const status = screen.getByRole("status");
    const alert = screen.getByRole("alert");
    rerender(
      <Toaster
        toasts={[
          { id: 1, text: "Saved", tone: "ok" },
          { id: 2, text: "Broke", tone: "alert" },
        ]}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toContain("Saved");
    expect(status.textContent).not.toContain("Broke");
    expect(screen.getByRole("alert")).toBe(alert);
    expect(alert.textContent).toContain("Broke");
  });
});
