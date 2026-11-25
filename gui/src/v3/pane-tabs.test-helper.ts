import { fireEvent, screen } from "@testing-library/react";

/**
 * The Sessions window shows one list at a time (owner, 2026-11-25, alternative B):
 * For you (the Needs-you items), Running, All. A test about one of them picks its tab first.
 */
export function paneTab(name: "For you" | "Running" | "All"): void {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${name}`) }));
}
