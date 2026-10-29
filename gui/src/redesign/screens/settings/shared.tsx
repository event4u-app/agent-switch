import type { ReactNode } from "react";

/** Detail text plus the reason a control is not available yet. The control
 *  itself renders disabled — nothing is faked. */
export function WithReason({ detail, reason }: { detail?: ReactNode; reason: string }) {
  return (
    <>
      {detail}
      <span className="mt-1 block text-ac-faint" data-testid="unavailable-reason">
        {reason}
      </span>
    </>
  );
}
