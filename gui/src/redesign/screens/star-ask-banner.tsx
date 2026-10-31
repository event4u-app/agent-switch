import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle, Share2, Star, X } from "lucide-react";
import {
  readStarAsk,
  recordStarAskShown,
  REDDIT_POST_URL,
  REPO_URL,
  setStarAskStopped,
  SHARE_CLIPBOARD_TEXT,
  shareLinks,
  starAskDue,
} from "../../star-ask.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { openExternal } from "./tools.js";

function StarTile({ size = 36 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-ac-violet-line bg-ac-violet-tint text-ac-violet-text"
      style={{ width: size, height: size }}
    >
      <Star className="size-[45%]" fill="currentColor" />
    </span>
  );
}

/** The share links, plus a copy button for the networks that have no web
 *  share link (TikTok, Instagram). Used by the banner and by Settings. */
export function ShareButtons({ variant = "ghost" }: { variant?: "ghost" | "violet" }) {
  const look = variant === "violet" ? { variant: "primary" as const, className: "bg-ac-violet" } : { variant };
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(id);
  }, [copied]);
  const links = shareLinks().filter((l) => l.id !== "reddit");
  return (
    <>
      {links.map((l) => (
        <Button key={l.id} size="sm" {...look} onClick={() => openExternal(l.url)}>
          {l.label}
        </Button>
      ))}
      <Button
        size="sm"
        {...look}
        title="TikTok and Instagram have no share link — copy the text and paste it into your post"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(SHARE_CLIPBOARD_TEXT)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied — paste it into your post" : "TikTok / Instagram: copy text"}
      </Button>
    </>
  );
}

/** Reddit post + share links, below the banner's ask. */
export function ShareSection() {
  return (
    <div className="flex flex-col gap-3 border-t border-ac-violet-line pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MessageCircle className="size-4 shrink-0 text-ac-violet-text" />
        <p className="min-w-[200px] flex-1 text-xs text-ac-muted">
          We're on <span className="text-ac-text">r/ClaudeCode</span> — an upvote or a comment on our post helps others find Agent Switch.
        </p>
        <Button size="sm" variant="secondary" onClick={() => openExternal(REDDIT_POST_URL)} title={REDDIT_POST_URL}>
          Open the Reddit post
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ac-muted">Share on</span>
        <ShareButtons />
      </div>
    </div>
  );
}

/** The GitHub-star ask on Overview — violet, so it never reads as the orange
 *  agent-config promo. Cadence and stop conditions live in `star-ask.ts`. */
export function StarAskBanner() {
  const [due] = useState(() => {
    const now = Date.now();
    return starAskDue(readStarAsk(now), now);
  });
  const [visible, setVisible] = useState(due);
  const [starred, setStarred] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (due && !recordStarAskShown(Date.now())) setVisible(false);
  }, [due]);

  if (!visible) return null;
  return (
    <Card className="flex flex-col gap-3 border-ac-violet-line bg-ac-violet-tint px-4 py-3" aria-label="Support Agent Switch">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <StarTile />
        <div className="min-w-[220px] flex-1">
          <p className="text-[13px] font-medium text-ac-text">
            {starred ? "Thank you for the star!" : "Enjoying Agent Switch? Give it a star on GitHub"}
          </p>
          <p className="mt-0.5 text-xs text-ac-muted">
            {starred
              ? "Want to help a bit more? Tell others about it — every share brings new people in."
              : "It's free & open source — a star helps other developers find it and keeps us going."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!starred && (
            <>
              <Button size="sm" variant="ghost" aria-expanded={sharing} onClick={() => setSharing((v) => !v)}>
                <Share2 /> Share
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="bg-ac-violet"
                title={REPO_URL}
                onClick={() => {
                  openExternal(REPO_URL);
                  setStarAskStopped("starred");
                  setStarred(true);
                  setSharing(true);
                }}
              >
                <Star /> Star on GitHub
              </Button>
            </>
          )}
          <IconButton label={starred ? "Close" : "Not now — asks again in a month"} onClick={() => setVisible(false)}>
            <X />
          </IconButton>
        </div>
      </div>
      {sharing && <ShareSection />}
      {!starred && (
        <button
          type="button"
          className="self-start text-[11px] text-ac-faint underline-offset-2 hover:text-ac-text hover:underline"
          onClick={() => {
            setStarAskStopped("off");
            setVisible(false);
          }}
        >
          Don't ask again
        </button>
      )}
    </Card>
  );
}
