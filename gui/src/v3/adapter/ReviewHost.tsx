/** The Review page of one session on real data: `diff --json` per scope,
 *  re-read after every action and every few seconds while a turn may change
 *  files; actions go to the CLI, comments to the session's chat. It opens on
 *  Uncommitted, the files the Summary and Changes counts count. */

import { useCallback, useEffect, useRef, useState } from "react";

import * as ipc from "../../ipc.js";
import { Review, type ReviewCompare, type ReviewFocus } from "../review.js";

export const REVIEW_POLL_MS = 5000;

export interface ReviewHostProps {
  sessionKey: string;
  title: string;
  running: boolean;
  /** Send text to the session as its next prompt (the chat's bridge queues it). */
  comment?: (text: string) => void;
  agentReview?: () => void;
  toast: (t: { tone: "ok" | "alert" | "info"; text: string }) => void;
  askMessage: (onSubmit: (message: string) => void) => void;
  createPr: () => void;
  /** The latest open of the review (and the file it was opened at); each new one goes back to Uncommitted. */
  focus?: ReviewFocus;
  io?: Pick<typeof ipc, "sessionReview" | "reviewAct" | "reviewUndo" | "reviewCommit">;
}

export function ReviewHost({ sessionKey, title, running, comment, agentReview, toast, askMessage, createPr, focus, io = ipc }: ReviewHostProps) {
  const [scope, setScope] = useState<ipc.ReviewScope>("uncommitted");
  const [data, setData] = useState<{ files: ipc.ReviewFileJson[]; shared: string[]; compare: ReviewCompare | undefined }>({ files: [], shared: [], compare: undefined });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState(false);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  /** What the shown review was read at, per scope: a poll that finds it unchanged reads nothing more. */
  const seen = useRef<{ scope: ipc.ReviewScope; fingerprint: string } | null>(null);
  const polled = useRef(false);

  // Every later open from a count lands on the files that count counts, read fresh.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) return void (mounted.current = true);
    setScope("uncommitted");
    reload();
  }, [focus?.seq, reload]);

  useEffect(() => {
    let alive = true;
    const poll = polled.current;
    polled.current = false;
    const since = poll && seen.current?.scope === scope ? seen.current.fingerprint : undefined;
    if (!poll) setLoading(true);
    (since ? io.sessionReview(sessionKey, scope, since) : io.sessionReview(sessionKey, scope))
      .then((r) => {
        if (!alive) return;
        setError(null);
        if (r.unchanged) return;
        seen.current = r.fingerprint ? { scope, fingerprint: r.fingerprint } : null;
        setData({ files: r.files, shared: r.shared, compare: { ref: r.baseRef, sha: r.base, note: r.note, omitted: r.omitted } });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        seen.current = null;
        setData({ files: [], shared: [], compare: undefined });
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sessionKey, scope, n, io]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      polled.current = true;
      reload();
    }, REVIEW_POLL_MS);
    return () => clearInterval(id);
  }, [running, reload]);

  const run = (p: Promise<string>, after?: () => void) =>
    p
      .then((done) => {
        if (done) toast({ tone: "ok", text: done.charAt(0).toUpperCase() + done.slice(1) });
        after?.();
        reload();
      })
      .catch((e: unknown) => {
        toast({ tone: "alert", text: e instanceof Error ? e.message : String(e) });
        reload();
      });

  return (
    <Review
      title={title}
      scope={scope}
      files={data.files}
      shared={data.shared}
      compare={data.compare}
      running={running}
      loading={loading}
      error={error}
      undoable={undoable}
      focus={focus}
      on={{
        setScope,
        stage: (file, hunk) => void run(io.reviewAct(sessionKey, "stage", file, hunk)),
        unstage: (file, hunk) => void run(io.reviewAct(sessionKey, "unstage", file, hunk)),
        discard: (file, hunk) => void run(io.reviewAct(sessionKey, "discard", file, hunk), () => setUndoable(true)),
        undo: () => void run(io.reviewUndo(sessionKey), () => setUndoable(false)),
        comment,
        commit: () => askMessage((message) => void run(io.reviewCommit(sessionKey, message).then((sha) => `committed ${sha}`))),
        createPr,
        agentReview,
      }}
    />
  );
}
