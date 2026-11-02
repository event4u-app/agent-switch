/**
 * The v3 event store (road-to-agent-switch-v3-central, Phase 1, M1).
 *
 * One SQLite file in WAL mode. `events` is append-only: each record is checked
 * against an allowlist, keyed by `(producer, seq)` so a replay or a second
 * import is a no-op, and kept in arrival order per producer. Everything else —
 * `sessions`, `lineage` — is a projection that `rebuildProjections` can drop and
 * replay from `events` at any time. `library`, `vault`, `git_facts`, `pr_cache`
 * and `attention` are created here and filled by later phases.
 *
 * Identities follow ADR-007: a session key is `provider/account/sessionId`,
 * a subagent `provider/account/sessionId#agentId`. Privacy floor: no prompt or
 * answer text is ever stored; the allowlist below has no field that could hold
 * it.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { openDriver, type Driver } from "./driver.js";

export const STORE_SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY,
  producer  TEXT NOT NULL,
  seq       TEXT NOT NULL,
  kind      TEXT NOT NULL,
  provider  TEXT NOT NULL,
  account   TEXT NOT NULL,
  session   TEXT,
  at        TEXT NOT NULL,
  data      TEXT NOT NULL,
  UNIQUE (producer, seq)
);
CREATE INDEX IF NOT EXISTS events_session ON events (provider, account, session, id);
CREATE TABLE IF NOT EXISTS sessions (
  key        TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  account    TEXT NOT NULL,
  session_id TEXT NOT NULL,
  first_at   TEXT NOT NULL,
  last_at    TEXT NOT NULL,
  last_event TEXT NOT NULL,
  ended      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lineage (
  child       TEXT PRIMARY KEY,
  parent      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  source      TEXT NOT NULL,
  confidence  TEXT NOT NULL,
  first_seen  TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  agent_type  TEXT,
  label       TEXT,
  cwd         TEXT,
  state       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lineage_parent ON lineage (parent);
CREATE TABLE IF NOT EXISTS library (
  key TEXT PRIMARY KEY, name TEXT, tags TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, auto_kept INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_auto_archived (key TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vault (
  key TEXT PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, copied_at TEXT NOT NULL,
  source_mtime REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS git_facts (
  key TEXT PRIMARY KEY, toplevel TEXT, branch TEXT, head_sha TEXT, dirty INTEGER, ahead INTEGER, behind INTEGER,
  remote TEXT, source TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pr_cache (
  repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT, lifecycle TEXT, mergeable TEXT, review TEXT, ci TEXT,
  etag TEXT, observed_at TEXT NOT NULL, PRIMARY KEY (repo, number)
);
CREATE TABLE IF NOT EXISTS attention (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, created_at TEXT NOT NULL,
  snoozed_until_change TEXT, done_at TEXT
);
`;

/** The fields a stored event may carry. Anything else is dropped at ingest. */
const ALLOWED: Record<string, "string" | "resume" | "lineage"> = {
  lineage: "lineage",
  source: "string",
  error: "string",
  notificationType: "string",
  agentId: "string",
  agentType: "string",
  cwd: "string",
  resume: "resume",
};
const MAX_STRING = 512;

export interface IngestInput {
  producer: string;
  seq: string | number;
  provider: string;
  account: string;
  /** A HookEventRecord-shaped object: `event`, `at`, optional `sessionId`, plus allowlisted fields. */
  record: Record<string, unknown>;
}

export class IngestRejected extends Error {}

/** Check and reduce one record to what the store may hold. Pure. */
export function checkRecord(input: IngestInput): { kind: string; session: string | null; at: string; data: Record<string, unknown> } {
  const r = input.record;
  if (!input.producer || input.seq === "" || input.seq === undefined) throw new IngestRejected("producer and seq are required");
  if (!/^[a-z][a-z0-9-]*$/i.test(input.provider) || !input.account || input.account.includes("/")) throw new IngestRejected("bad provider or account");
  if (typeof r?.event !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(r.event)) throw new IngestRejected("event must be a name");
  if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) throw new IngestRejected("at must be a timestamp");
  const session = typeof r.sessionId === "string" && r.sessionId ? r.sessionId : null;
  const data: Record<string, unknown> = {};
  for (const [k, kind] of Object.entries(ALLOWED)) {
    const v = r[k];
    if (v === undefined) continue;
    if (kind === "string" && typeof v === "string") data[k] = v.slice(0, MAX_STRING);
    if (kind === "lineage" && v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.parent === "string" && typeof o.kind === "string" && (o.source === "lineage" || o.source === "host" || o.source === "hook")) {
        data.lineage = { parent: o.parent.slice(0, 200), kind: o.kind.slice(0, 20), source: o.source, ...(typeof o.label === "string" ? { label: o.label.slice(0, 80) } : {}) };
      }
    }
    if (kind === "resume" && v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
      data.resume = { secondsSinceLastResponse: num(o.secondsSinceLastResponse), contextTokens: num(o.contextTokens), cacheLikelyExpired: typeof o.cacheLikelyExpired === "boolean" ? o.cacheLikelyExpired : undefined };
    }
  }
  return { kind: r.event, session, at: new Date(r.at).toISOString(), data };
}

export const sessionKey = (provider: string, account: string, sessionId: string) => `${provider}/${account}/${sessionId}`;

export interface StoredSession {
  key: string;
  provider: string;
  account: string;
  sessionId: string;
  firstAt: string;
  lastAt: string;
  lastEvent: string;
  ended: boolean;
}

export interface StoredEdge {
  child: string;
  parent: string;
  kind: string;
  source: string;
  confidence: string;
  observedAt: string;
  agentType?: string;
  label?: string;
  cwd?: string;
  state: "running" | "done";
}

export class Store {
  private constructor(readonly db: Driver, readonly file: string) {}

  static async open(file: string): Promise<Store> {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = await openDriver(file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // not fatal: the dir is the user's own
    }
    // The timeout first: switching to WAL needs a lock another opener may hold for a moment.
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    // WAL's recommended pairing: a commit no longer waits on fsync (durable across a
    // crash of the process; the last commits can go only with the machine's power).
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(SCHEMA);
    const { user_version } = db.get<{ user_version: number }>("PRAGMA user_version")!;
    if (user_version > STORE_SCHEMA_VERSION) {
      db.close();
      throw new Error(`store ${file} has schema ${user_version}; this agent-switch knows ${STORE_SCHEMA_VERSION}`);
    }
    if (user_version < STORE_SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION}`);
    return new Store(db, file);
  }

  close(): void {
    this.db.close();
  }

  /** Append one event. Returns false when `(producer, seq)` was already stored. */
  ingest(input: IngestInput): boolean {
    const c = checkRecord(input);
    // One write transaction for the event and its projection: both land or neither,
    // and IMMEDIATE takes the write lock up front through busy_timeout instead of
    // upgrading a read lock mid-way, which SQLite answers with "database is locked".
    this.beginWrite();
    try {
      const stored = this.ingestInTx(input, c);
      this.db.exec("COMMIT");
      return stored;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * BEGIN IMMEDIATE, retried while another writer holds the lock. busy_timeout
   * should cover this, but on Windows SQLite answered BUSY early in an 8-writer
   * CI run, and a writer backing off long kept losing to the others. So the wait
   * is ours: short jittered sleeps, bounded at 15 s.
   */
  private beginWrite(): void {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const delay = 1 + Math.floor(Math.random() * 10);
      try {
        this.db.exec("BEGIN IMMEDIATE");
        return;
      } catch (err) {
        const busy = (err as { errcode?: number }).errcode === 5 || /database is locked/.test(String((err as Error).message));
        if (!busy || Date.now() > deadline) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      }
    }
  }

  private ingestInTx(input: IngestInput, c: ReturnType<typeof checkRecord>): boolean {
    const res = this.db.run(
      "INSERT INTO events (producer, seq, kind, provider, account, session, at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (producer, seq) DO NOTHING",
      input.producer,
      String(input.seq),
      c.kind,
      input.provider,
      input.account,
      c.session,
      c.at,
      JSON.stringify(c.data),
    );
    if (res.changes === 0) return false;
    this.project({ kind: c.kind, provider: input.provider, account: input.account, session: c.session, at: c.at, data: c.data });
    return true;
  }

  eventCount(): number {
    return Number(this.db.get<{ n: number }>("SELECT count(*) AS n FROM events")!.n);
  }

  /** Drop every projection and replay `events` in arrival order. */
  rebuildProjections(): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM sessions; DELETE FROM lineage;");
      for (const e of this.db.all<{ kind: string; provider: string; account: string; session: string | null; at: string; data: string }>(
        "SELECT kind, provider, account, session, at, data FROM events ORDER BY id",
      )) {
        this.project({ ...e, data: JSON.parse(e.data) });
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private project(e: { kind: string; provider: string; account: string; session: string | null; at: string; data: Record<string, any> }): void {
    if (!e.session) return;
    const key = sessionKey(e.provider, e.account, e.session);
    this.db.run(
      `INSERT INTO sessions (key, provider, account, session_id, first_at, last_at, last_event, ended) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET last_at = excluded.last_at, last_event = excluded.last_event, ended = excluded.ended`,
      key,
      e.provider,
      e.account,
      e.session,
      e.at,
      e.at,
      e.kind,
      e.kind === "SessionEnd" ? 1 : 0,
    );
    if (e.kind === "SessionEnd") this.db.run("UPDATE lineage SET state = 'done' WHERE parent = ? OR child = ?", key, key);
    if (e.kind === "SessionStart" && e.data.lineage) {
      // Reported by the session itself through the env it inherited (ADR-007 source
      // `lineage` or `host`); a bare parent id is matched by id at read time.
      const l = e.data.lineage as { parent: string; kind: string; label?: string; source: string };
      this.db.run(
        `INSERT INTO lineage (child, parent, kind, source, confidence, first_seen, observed_at, label, state) VALUES (?, ?, ?, ?, 'reported', ?, ?, ?, 'running')
         ON CONFLICT (child) DO UPDATE SET parent = excluded.parent, kind = excluded.kind, source = excluded.source, observed_at = excluded.observed_at, label = excluded.label, state = 'running'`,
        key,
        l.parent,
        l.kind,
        l.source,
        e.at,
        e.at,
        l.label ?? null,
      );
    }
    if ((e.kind === "SubagentStart" || e.kind === "SubagentStop") && typeof e.data.agentId === "string") {
      this.db.run(
        `INSERT INTO lineage (child, parent, kind, source, confidence, first_seen, observed_at, agent_type, cwd, state) VALUES (?, ?, 'subagent', 'hook', 'proven', ?, ?, ?, ?, ?)
         ON CONFLICT (child) DO UPDATE SET state = excluded.state, observed_at = excluded.observed_at,
           agent_type = coalesce(excluded.agent_type, lineage.agent_type), cwd = coalesce(excluded.cwd, lineage.cwd)`,
        `${key}#${e.data.agentId}`,
        key,
        e.at,
        e.at,
        e.data.agentType ?? null,
        e.data.cwd ?? null,
        e.kind === "SubagentStart" ? "running" : "done",
      );
    }
  }

  sessions(): StoredSession[] {
    return this.db
      .all<any>("SELECT * FROM sessions ORDER BY last_at DESC")
      .map((r) => ({ key: r.key, provider: r.provider, account: r.account, sessionId: r.session_id, firstAt: r.first_at, lastAt: r.last_at, lastEvent: r.last_event, ended: !!r.ended }));
  }

  children(parentKey: string): StoredEdge[] {
    const bareId = parentKey.split("/").pop() ?? parentKey;
    return this.db.all<any>("SELECT * FROM lineage WHERE parent = ? OR parent = ? ORDER BY first_seen, child", parentKey, bareId).map((r) => {
      const edge: StoredEdge = { child: r.child, parent: r.parent, kind: r.kind, source: r.source, confidence: r.confidence, observedAt: r.observed_at, state: r.state };
      if (r.agent_type) edge.agentType = r.agent_type;
      if (r.label) edge.label = r.label;
      if (r.cwd) edge.cwd = r.cwd;
      return edge;
    });
  }
}

/**
 * Bring the hook event rings (`<root>/events/<provider>-<account>.jsonl` and
 * their `.1` / `.pin` generations) into the store. The producer is the ring, the
 * sequence a hash of the line, so importing twice stores nothing new and a line
 * that is in both `.pin` and `.1` is stored once. The rings stay as they are:
 * the 2.x readers keep using them for one release.
 */
export function importEventRings(store: Store, root: string): { files: number; read: number; stored: number; rejected: number } {
  const dir = path.join(root, "events");
  const out = { files: 0, read: 0, stored: 0, rejected: 0 };
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  const rings = names.filter((n) => /^[a-z][a-z0-9-]*-.+\.jsonl(\.1|\.pin)?$/i.test(n)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  for (const name of rings) {
    const base = name.replace(/\.jsonl(\.1|\.pin)?$/, "");
    const dash = base.indexOf("-");
    const provider = base.slice(0, dash);
    const account = base.slice(dash + 1);
    out.files++;
    for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!line) continue;
      out.read++;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        out.rejected++;
        continue;
      }
      const seq = crypto.createHash("sha256").update(line).digest("hex").slice(0, 32);
      try {
        if (store.ingest({ producer: `ring:${provider}-${account}`, seq, provider, account, record })) out.stored++;
      } catch {
        out.rejected++;
      }
    }
  }
  return out;
}

// Oldest generation first, so arrival order in the store matches the ring.
function order(name: string): number {
  return name.endsWith(".pin") ? 0 : name.endsWith(".1") ? 1 : 2;
}

export function storeFile(root: string): string {
  return path.join(root, "store", "agent-switch.db");
}
