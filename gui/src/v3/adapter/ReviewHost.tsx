/** The Review page of one session on real data: `diff --json` per scope,
 *  re-read after every action and every few seconds while a turn may change
 *  files; actions go to the CLI, comments to the session's chat. */

import { useCallback, useEffect, useState } from "react";

import * as ipc from "../../ipc.js";
import { Review } from "../review.js";

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
  io?: Pick<typeof ipc, "sessionReview" | "reviewAct" | "reviewUndo" | "reviewCommit">;
}

export function ReviewHost({ sessionKey, title, running, comment, agentReview, toast, askMessage, createPr, io = ipc }: ReviewHostProps) {
  const [scope, setScope] = useState<ipc.ReviewScope>("worktree");
  const [data, setData] = useState<{ files: ipc.ReviewFileJson[]; shared: string[] }>({ files: [], shared: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState(false);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    io.sessionReview(sessionKey, scope)
      .then((r) => alive && (setData({ files: r.files, shared: r.shared }), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sessionKey, scope, n, io]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(reload, REVIEW_POLL_MS);
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
      running={running}
      loading={loading}
      error={error}
      undoable={undoable}
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
