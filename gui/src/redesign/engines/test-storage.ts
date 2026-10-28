/** jsdom's localStorage is an unreliable stub here; tests install this
 *  in-memory Storage (same approach as settings-store.test.ts). */
export function installMemoryStorage(): void {
  const map = new Map<string, string>();
  const mem: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
}
