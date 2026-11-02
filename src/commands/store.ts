/**
 * `agent-switch store status|import|rebuild [--json]` — the v3 event store
 * (src/store/store.ts). `import` brings the hook event rings in; the rings stay
 * in place, because 2.x readers keep using them for one release. `rebuild`
 * replays the stored events into the projections.
 */

import { die, ROOT } from "../profiles.js";
import { Store, importEventRings, storeFile, STORE_SCHEMA_VERSION } from "../store/store.js";
import { StoreUnavailable } from "../store/driver.js";

export async function cmdStore(sub: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const action = sub ?? "status";
  if (!["status", "import", "rebuild"].includes(action)) die("usage: agent-switch store status|import|rebuild [--json]");
  const file = storeFile(ROOT);
  let store: Store;
  try {
    store = await Store.open(file);
  } catch (err) {
    if (!(err instanceof StoreUnavailable)) throw err;
    if (action !== "status") die(err.message);
    if (flags.json) console.log(JSON.stringify({ available: false, reason: err.message }));
    else console.log(`Event store unavailable: ${err.message}.`);
    return;
  }
  try {
    if (action === "import") {
      const r = importEventRings(store, ROOT);
      if (flags.json) console.log(JSON.stringify(r));
      else console.log(`Read ${r.read} events from ${r.files} files: ${r.stored} new, ${r.read - r.stored - r.rejected} already stored, ${r.rejected} unreadable.`);
      return;
    }
    if (action === "rebuild") store.rebuildProjections();
    const status = { available: true, file, driver: store.db.name, schema: STORE_SCHEMA_VERSION, events: store.eventCount(), sessions: store.sessions().length };
    if (flags.json) console.log(JSON.stringify(status));
    else console.log(`${action === "rebuild" ? "Rebuilt. " : ""}${status.events} events, ${status.sessions} sessions in ${file} (${status.driver}).`);
  } finally {
    store.close();
  }
}
