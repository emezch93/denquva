import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../js/extras.js", import.meta.url), "utf8");
const start = source.indexOf('const XQ_KEY = "denquva_offline_queue";');
const end = source.indexOf("// ---------------- stock adjustment", start);
assert.notEqual(start, -1, "offline queue implementation exists");
assert.notEqual(end, -1, "offline queue section ends before stock tools");

const local = new Map();
const idbSales = new Map();
const classes = new Set(["hidden"]);
const pill = {
  classList: {
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
    toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
  },
  textContent: "",
};
const transaction = (storeName) => {
  const tx = {
    objectStore() {
      return {
        put(entry) { idbSales.set(entry.ref, structuredClone(entry)); },
        delete(ref) { idbSales.delete(ref); },
        getAll() {
          const request = {};
          queueMicrotask(() => { request.result = [...idbSales.values()]; request.onsuccess?.(); });
          return request;
        },
      };
    },
  };
  queueMicrotask(() => tx.oncomplete?.());
  return tx;
};
const db = { objectStoreNames: { contains: () => true }, transaction };
const context = vm.createContext({
  window: { indexedDB: {}, addEventListener() {} },
  indexedDB: { open: () => { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; } },
  localStorage: {
    getItem(key) { return local.get(key) ?? null; },
    setItem(key, value) { local.set(key, value); },
  },
  document: { getElementById: () => pill, createElement: () => pill, body: { appendChild() {} } },
  structuredClone,
  setTimeout() {}, setInterval() {},
  activeShopId: 17, authToken: "test-token", USE_SAMPLE_DATA: false,
  Api: { sellBatch: async () => ({ failed: [] }) },
  xIsNetworkError: err => err?.network === true,
  toast() {}, render() {},
});
vm.runInContext(`${source.slice(start, end)}
this.testApi = { xQueueAdd, xQueueReadAll, xQueueRemove, xQueueMarkDone, xSyncQueue, xUpdatePill, xRead, XQ_ISSUES };`, context);

const api = context.testApi;
const sale = [{ product_id: 3, quantity: 1 }];

// Completed rows are removed from local storage and IndexedDB, and their
// tombstone hides stale IndexedDB copies if a browser deletion fails.
await api.xQueueAdd("sale-ok", sale);
assert.equal((await api.xQueueReadAll()).length, 1);
api.xQueueMarkDone("sale-ok");
assert.equal((await api.xQueueReadAll()).length, 0);
assert.equal(idbSales.has("sale-ok"), true, "tombstone hides stale IndexedDB copy");
await api.xQueueRemove("sale-ok");
assert.equal(idbSales.has("sale-ok"), false, "successful removal deletes IndexedDB copy");

// A successful server response clears the waiting queue completely.
await api.xQueueAdd("sale-sync", sale);
await api.xSyncQueue();
assert.equal((await api.xQueueReadAll()).length, 0);
assert.equal(idbSales.size, 0);
await api.xUpdatePill();
assert.equal(pill.textContent, "", "no stale waiting-to-sync badge remains");

// Temporary authorization/subscription/provider outages retain the sale for
// a later retry instead of moving it to the permanent-failure list.
let syncAttempts=0;
context.Api.sellBatch = async () => { syncAttempts++; const err = new Error("subscription inactive"); err.status = 402; throw err; };
await api.xQueueAdd("sale-retry", sale);
await api.xSyncQueue();
const pending=(await api.xQueueReadAll()).find(e=>e.ref==="sale-retry");
assert.ok(pending, "retryable failures stay queued");
assert.match(pending.lastError,/subscription is inactive/i,"queued sale shows actionable reason");
assert.ok(pending.nextRetryAt>Date.now(),"retryable failures use backoff");
assert.match(pill.textContent,/sync paused/i,"pill explains that sync is paused");
await api.xSyncQueue();
assert.equal(syncAttempts,1,"automatic retries respect backoff");
assert.equal(api.xRead(api.XQ_ISSUES).length, 0);

context.Api.sellBatch = async () => ({ failed: [{ reason: "Insufficient stock" }] });
await api.xSyncQueue(true);
assert.equal((await api.xQueueReadAll()).length, 0, "server-rejected sale leaves waiting queue");
assert.equal(api.xRead(api.XQ_ISSUES).length, 1, "permanent stock conflicts need attention");

console.log("Offline queue smoke checks passed: tombstones, successful cleanup, retryable failures, permanent issue handling.");

