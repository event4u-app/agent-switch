import { fireEvent, screen } from "@testing-library/react";

/**
 * The Sessions window shows one list at a time (owner, 2026-11-25, alternative B):
 * Needs you (the Needs-you items), Running, Other. A test about one of them picks its tab first.
 */
export function paneTab(name: "Needs you" | "Running" | "Other"): void {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${name}`) }));
}
