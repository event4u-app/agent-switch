/** The Review page of one session on real data: `diff --json` per scope,
 *  re-read after every action and, while a turn may change files, a few
 *  seconds after the last read settled; actions go to the CLI, comments to the session's chat. It opens on
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
  /** Absent when the session already has an open PR. */
  createPr?: () => void;
  /** The latest open of the review (and the file it was opened at); each new one goes back to Uncommitted. */
  focus?: ReviewFocus;
  io?: Pick<typeof ipc, "sessionReview" | "reviewAct" | "reviewUndo" | "reviewCommit">;
}

export function ReviewHost({ sessionKey, title, running, comment, agentReview, toast, askMessage, createPr, focus, io = ipc }: ReviewHostProps) {
  const [scope, setScope] = useState<ipc.ReviewScope>("uncommitted");
  /** What was read, and for which session and scope: shown, and acted on, only while both still match. */
  const [data, setData] = useState<{ key: string; scope: ipc.ReviewScope; files: ipc.ReviewFileJson[]; shared: string[]; compare: ReviewCompare | undefined } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState(false);
  const [n, setN] = useState(0);
  /** Counts reads that settled: the next poll is timed from the last one, so a slow read is never cut off by the next. */
  const [settled, setSettled] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  /** What the shown review was read at, per scope: a poll that finds it unchanged reads nothing more. */
  const seen = useRef<{ key: string; scope: ipc.ReviewScope; fingerprint: string } | null>(null);
  const polled = useRef(false);

  // Undo puts back this session's last discard; another session's offer is not this one's.
  useEffect(() => setUndoable(false), [sessionKey]);

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
    const since = poll && seen.current?.key === sessionKey && seen.current.scope === scope ? seen.current.fingerprint : undefined;
    if (!poll) setLoading(true);
    (since ? io.sessionReview(sessionKey, scope, since) : io.sessionReview(sessionKey, scope))
      .then((r) => {
        if (!alive) return;
        setError(null);
        if (r.unchanged) return;
        seen.current = r.fingerprint ? { key: sessionKey, scope, fingerprint: r.fingerprint } : null;
        setData({ key: sessionKey, scope, files: r.files, shared: r.shared, compare: { ref: r.baseRef, sha: r.base, note: r.note, omitted: r.omitted, more: r.more } });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        seen.current = null;
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setSettled((x) => x + 1);
      });
    return () => {
      alive = false;
    };
  }, [sessionKey, scope, n, io]);

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => {
      polled.current = true;
      reload();
    }, REVIEW_POLL_MS);
    return () => clearTimeout(id);
  }, [running, reload, settled]);

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

  // A read of another session or scope (a tab or scope switch still loading) is neither shown nor acted on.
  const shown = data && data.key === sessionKey && data.scope === scope ? data : null;
  /** A whole-file action carries the file's hash as shown; a hunk action its hunk. */
  const fileHash = (file: string, hunk?: string) => (hunk ? undefined : shown?.files.find((f) => f.path === file)?.hash);
  const ready = !!shown && !loading;
  const guard =
    <A extends unknown[]>(f: (...a: A) => void) =>
    (...a: A) => {
      if (ready) f(...a);
    };

  return (
    <Review
      title={title}
      scope={scope}
      files={shown?.files ?? []}
      shared={shown?.shared ?? []}
      compare={shown?.compare}
      running={running}
      ready={ready}
      loading={loading || !shown}
      error={error}
      undoable={undoable}
      focus={focus}
      on={{
        setScope,
        stage: guard((file: string, hunk?: string) => void run(io.reviewAct(sessionKey, "stage", file, hunk, fileHash(file, hunk)))),
        unstage: guard((file: string, hunk?: string) => void run(io.reviewAct(sessionKey, "unstage", file, hunk, fileHash(file, hunk)))),
        discard: guard((file: string, hunk?: string) => void run(io.reviewAct(sessionKey, "discard", file, hunk, fileHash(file, hunk)), () => setUndoable(true))),
        undo: guard(() => void run(io.reviewUndo(sessionKey), () => setUndoable(false))),
        comment: comment && guard(comment),
        commit: guard(() => askMessage((message) => void run(io.reviewCommit(sessionKey, message).then((sha) => `committed ${sha}`)))),
        createPr: createPr && guard(createPr),
        agentReview: agentReview && guard(agentReview),
      }}
    />
  );
}
