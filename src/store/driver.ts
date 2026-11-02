/**
 * SQLite behind one small interface, so the event store runs on either engine
 * runtime (Decision E1 is the owner's): Node's built-in `node:sqlite`
 * (Node ≥ 22.13) or Bun's `bun:sqlite`. Both were measured equal for this load
 * (agents/evidence/v3-phase0-spikes-2026-11.md § S4). On a runtime with
 * neither, `openDriver` reports why and the engine keeps its JSON files.
 */

export interface Driver {
  readonly name: string;
  exec(sql: string): void;
  run(sql: string, ...params: SqlValue[]): { changes: number };
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined;
  close(): void;
}

export type SqlValue = string | number | null;

export class StoreUnavailable extends Error {}

type Stmt = { run(...p: SqlValue[]): { changes: number | bigint }; all(...p: SqlValue[]): unknown[]; get(...p: SqlValue[]): unknown };
type RawDb = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };

function wrap(name: string, db: RawDb): Driver {
  const cache = new Map<string, Stmt>();
  const prep = (sql: string) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = db.prepare(sql)));
    return s;
  };
  return {
    name,
    exec: (sql) => db.exec(sql),
    run: (sql, ...p) => ({ changes: Number(prep(sql).run(...p).changes) }),
    all: <T>(sql: string, ...p: SqlValue[]) => prep(sql).all(...p) as T[],
    // bun:sqlite returns null for no row, node:sqlite undefined.
    get: <T>(sql: string, ...p: SqlValue[]) => (prep(sql).get(...p) ?? undefined) as T | undefined,
    close: () => db.close(),
  };
}

/** Open `file` with whichever SQLite the running engine has. */
export async function openDriver(file: string): Promise<Driver> {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    const mod: any = await import("bun:sqlite" as string);
    return wrap(`bun:sqlite`, new mod.Database(file));
  }
  // Node 22 flags node:sqlite as experimental and prints that on stderr of every
  // command that opens the store; that one notice is not the user's business.
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (!String(typeof w === "string" ? w : w.message).startsWith("SQLite is an experimental feature")) (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    let mod: any;
    try {
      mod = await import("node:sqlite" as string);
    } catch {
      throw new StoreUnavailable(`node:sqlite is not available in Node ${process.versions.node}; the event store needs Node 22.13 or later (or Bun)`);
    }
    return wrap("node:sqlite", new mod.DatabaseSync(file));
  } finally {
    process.emitWarning = emit;
  }
}
