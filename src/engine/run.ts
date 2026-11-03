/**
 * Start the engine side of the daemon: open the store, bring the hook rings in,
 * listen on the protocol socket. Every failure is reported and leaves the
 * daemon's 2.x work running — a missing SQLite (Node 20) or a second engine is
 * not a reason to stop polling usage.
 */

import type * as net from "node:net";

import { engineAddress } from "../protocol/messages.js";
import { Store, importEventRings, storeFile } from "../store/store.js";
import { startEngineServer, storeHandler } from "./server.js";

export interface RunningEngine {
  address: string;
  stop(): Promise<void>;
}

export async function startEngine(root: string, log: (l: string) => void): Promise<RunningEngine | null> {
  let store: Store;
  try {
    store = await Store.open(storeFile(root));
  } catch (err: any) {
    log(`engine off: ${err?.message ?? err}`);
    return null;
  }
  const imported = importEventRings(store, root);
  if (imported.stored > 0) log(`engine: imported ${imported.stored} hook events`);
  const address = engineAddress(root);
  let server: net.Server;
  try {
    server = await startEngineServer(address, storeHandler(store));
  } catch (err: any) {
    store.close();
    log(`engine off: ${err?.message ?? err}`);
    return null;
  }
  log(`engine listening on ${address} (${store.db.name})`);
  return {
    address,
    stop: () =>
      new Promise((resolve) =>
        server.close(() => {
          store.close();
          resolve();
        }),
      ),
  };
}
