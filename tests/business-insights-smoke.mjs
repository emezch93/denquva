import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);
const worker = await fs.readFile(new URL("server/worker.js", root), "utf8");
const app = await fs.readFile(new URL("js/app.js", root), "utf8");
const serviceWorker = await fs.readFile(new URL("service-worker.js", root), "utf8");

assert.match(worker, /path === "\/api\/insights" && request\.method === "GET"/);
assert.match(worker, /WHERE p\.shop_id = \? AND p\.is_archived = 0/);
assert.match(worker, /LIMIT 2000/);
assert.match(app, /async getInsights\(\)/);
assert.match(app, /Nothing changes automatically/);
assert.match(serviceWorker, /denquva-shell-v42/);

const start = worker.indexOf("function buildBusinessInsights(");
const end = worker.indexOf("async function getBusinessInsights(", start);
assert.notEqual(start, -1, "pure insights algorithm exists");
assert.notEqual(end, -1, "algorithm terminates before database handler");
const context = vm.createContext({});
vm.runInContext(`${worker.slice(start, end)}; this.buildBusinessInsights = buildBusinessInsights;`, context);

const result = context.buildBusinessInsights([
  { id: 1, name: "Fast mover", quantity: 4, reserved_quantity: 1, low_stock_threshold: 3, units_7: 10, units_previous_7: 4, units_30: 30, selling_price: 10, cost_price: 5 },
  { id: 2, name: "Slow stock", quantity: 8, reserved_quantity: 0, low_stock_threshold: 2, units_7: 0, units_previous_7: 0, units_30: 0, selling_price: 10, cost_price: 5 },
  { id: 3, name: "No margin", quantity: 2, reserved_quantity: 0, low_stock_threshold: 1, units_7: 0, units_previous_7: 0, units_30: 0, selling_price: 5, cost_price: 5 },
  { id: 4, name: "At threshold", quantity: 2, reserved_quantity: 0, low_stock_threshold: 2, units_7: 0, units_previous_7: 0, units_30: 0, selling_price: 10, cost_price: 5 },
], { current_revenue: 150, previous_revenue: 100 }, "2026-11-20T00:00:00.000Z");

assert.equal(result.sales_change_percent, 50);
assert.ok(result.recommendations.some(x => x.type === "reorder" && x.product_id === 1 && x.suggested_reorder_quantity > 0));
assert.ok(result.recommendations.some(x => x.type === "sales_momentum" && x.product_id === 1));
assert.ok(result.recommendations.some(x => x.type === "slow_moving" && x.product_id === 2));
assert.ok(result.recommendations.some(x => x.type === "margin_check" && x.product_id === 3));
assert.ok(result.recommendations.some(x => x.type === "reorder" && x.product_id === 4 && x.suggested_reorder_quantity === 1));
assert.ok(result.assumptions.length >= 3);
assert.ok(result.recommendations.length <= 30);

// Execute the Worker SQL against a temporary SQLite database using the exact
// statements from getBusinessInsights, with no production data or writes.
const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE products (
    id INTEGER PRIMARY KEY, shop_id INTEGER, name TEXT, quantity INTEGER,
    reserved_quantity INTEGER, low_stock_threshold INTEGER, selling_price REAL,
    cost_price REAL, is_archived INTEGER
  );
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, shop_id INTEGER, product_id INTEGER, sold_at TEXT,
    quantity INTEGER, total_amount REAL
  );
  INSERT INTO products VALUES (1, 7, 'Moving', 6, 1, 3, 20, 10, 0);
  INSERT INTO products VALUES (2, 7, 'Archived', 20, 0, 3, 20, 10, 1);
  INSERT INTO sales VALUES (1, 7, 1, date('now'), 3, 60);
  INSERT INTO sales VALUES (2, 7, 1, date('now', '-8 days'), 2, 40);
  INSERT INTO sales VALUES (3, 99, 1, date('now'), 100, 2000);
`);
const insightsSource = worker.slice(start, worker.indexOf("async function getSettings(", end));
const statements = [...insightsSource.matchAll(/env\.DB\.prepare\(\s*`([\s\S]*?)`\s*\)\.bind\(shopId\)\.(?:all|first)\(\)/g)];
assert.equal(statements.length, 2, "both insights SQL statements are present");
const products = database.prepare(statements[0][1]).all(7);
const totals = database.prepare(statements[1][1]).get(7);
assert.equal(products.length, 1, "archived and other-shop products are excluded");
assert.equal(products[0].units_7, 3);
assert.equal(products[0].units_previous_7, 2);
assert.equal(products[0].units_30, 5);
assert.equal(totals.current_revenue, 60);
assert.equal(totals.previous_revenue, 40);
database.close();
console.log("Business insights smoke checks passed.");

