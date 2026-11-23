import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);
const text = async (path) => fs.readFile(new URL(path, root), "utf8");
const worker = await text("server/worker.js");
const migration = await text("migrations/hardware-pos.sql");
const terminalBlock = worker.slice(worker.indexOf("function cleanTerminalId"), worker.indexOf("async function performSale"));
const workerContext = vm.createContext({});
vm.runInContext(terminalBlock, workerContext);
assert.equal(vm.runInContext('cleanTerminalId("dq_0123456789abcdef")', workerContext), "dq_0123456789abcdef");
assert.equal(vm.runInContext('cleanTerminalId("bad id")', workerContext), null);
assert.equal(vm.runInContext('cleanTerminalId("x")', workerContext), null);

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE sales(id INTEGER PRIMARY KEY, shop_id INTEGER, product_id INTEGER, product_name TEXT, quantity REAL, unit_price REAL, unit_cost REAL, total_amount REAL, estimated_profit REAL, sold_at TEXT); CREATE TABLE sale_reversals(id INTEGER PRIMARY KEY, shop_id INTEGER, sale_id INTEGER, product_id INTEGER, product_name TEXT, quantity REAL, unit_price REAL, unit_cost REAL, total_amount REAL, estimated_profit REAL, sold_at TEXT, restocked INTEGER, reason TEXT, reversed_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE pending_sales(id TEXT PRIMARY KEY, shop_id INTEGER, method TEXT, total_kobo INTEGER, items TEXT, status TEXT, terminal_serial TEXT, provider TEXT, provider_ref TEXT, attempts INTEGER, push_note TEXT, source TEXT, created_at INTEGER, expires_at INTEGER, last_check INTEGER);");
db.exec(migration);
db.exec(await text("migrations/hardware-pos-discounts.sql"));
db.exec(await text("migrations/hardware-pos-shifts.sql"));
assert.ok(db.prepare("PRAGMA table_info(sales)").all().some((c) => c.name === "terminal_id"));
assert.ok(db.prepare("PRAGMA table_info(pending_sales)").all().some((c) => c.name === "device_terminal_id"));
assert.ok(db.prepare("PRAGMA table_info(sales)").all().some((c) => c.name === "discount_amount"));
assert.ok(db.prepare("PRAGMA table_info(pending_sales)").all().some((c) => c.name === "discount_percent"));
assert.ok(db.prepare("PRAGMA table_info(sales)").all().some((c) => c.name === "payment_method"));
assert.ok(db.prepare("PRAGMA table_info(sale_reversals)").all().some((c) => c.name === "reversed_at"));
assert.ok(db.prepare("PRAGMA table_info(pos_shifts)").all().some((c) => c.name === "expected_cash"));
const opened = "2026-11-20T10:00:00.000Z", closed = "2026-11-20T18:00:00.000Z";
db.prepare("INSERT INTO pos_shifts(id,shop_id,terminal_id,actor,role,opening_cash,status,opened_at) VALUES(?,?,?,?,?,?,?,?)").run("s1",12,"dq_0123456789abcdef","Owner","owner",100,"open",opened);
assert.throws(() => db.prepare("INSERT INTO pos_shifts(id,shop_id,terminal_id,actor,role,opening_cash,status,opened_at) VALUES(?,?,?,?,?,?,?,?)").run("s2",12,"dq_0123456789abcdef","Staff","staff",0,"open",opened), /UNIQUE/);
db.prepare("INSERT INTO sales(shop_id,product_id,product_name,quantity,unit_price,unit_cost,total_amount,estimated_profit,sold_at,terminal_id,payment_method) VALUES(12,1,'Cash',1,20,10,20,10,?,?,?)").run("2026-11-20 11:00:00", "dq_0123456789abcdef", "cash");
db.prepare("INSERT INTO sales(shop_id,product_id,product_name,quantity,unit_price,unit_cost,total_amount,estimated_profit,sold_at,terminal_id,payment_method) VALUES(12,2,'Card',1,50,25,50,25,?,?,?)").run("2026-11-20 11:00:00", "dq_0123456789abcdef", "card");
db.exec("CREATE TABLE x_sale_pay(id INTEGER PRIMARY KEY AUTOINCREMENT,shop_id INTEGER,sale_id INTEGER,method TEXT,amount REAL,actor TEXT,at TEXT,reversed_at TEXT)");
db.prepare("INSERT INTO sales(shop_id,product_id,product_name,quantity,unit_price,unit_cost,total_amount,estimated_profit,sold_at,terminal_id,payment_method) VALUES(12,3,'Mixed',1,60,30,60,30,?,?,?)").run("2026-11-20 11:30:00", "dq_0123456789abcdef", "mixed");
db.prepare("INSERT INTO x_sale_pay(shop_id,sale_id,method,amount,at) VALUES(12,3,'transfer',45,'2026-11-20 11:30:00'),(12,3,'cash',15,'2026-11-20 11:30:00')").run();
db.prepare("INSERT INTO sale_reversals(shop_id,sale_id,product_id,product_name,quantity,unit_price,unit_cost,total_amount,estimated_profit,sold_at,restocked,reason,reversed_at,terminal_id,payment_method) VALUES(12,1,1,'Cash',1,20,10,5,2.5,?,1,'partial cash refund',?,?,?)").run("2026-11-20 11:00:00", "2026-11-20 12:00:00", "dq_0123456789abcdef", "cash");
db.prepare("INSERT INTO sale_reversals(shop_id,sale_id,product_id,product_name,quantity,unit_price,unit_cost,total_amount,estimated_profit,sold_at,restocked,reason,reversed_at,terminal_id,payment_method) VALUES(12,3,3,'Mixed',1,60,30,60,30,?,1,'mixed refund',?,?,?)").run("2026-11-20 11:30:00", "2026-11-20 13:00:00", "dq_0123456789abcdef", "mixed");
db.prepare("UPDATE x_sale_pay SET reversed_at='2026-11-20 13:00:00' WHERE shop_id=12 AND sale_id=3").run();
const cashIn = db.prepare("SELECT COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM x_sale_pay p WHERE p.shop_id=s.shop_id AND p.sale_id=s.id) THEN (SELECT COALESCE(SUM(p.amount),0) FROM x_sale_pay p WHERE p.shop_id=s.shop_id AND p.sale_id=s.id AND p.method='cash') WHEN s.payment_method='cash' THEN s.total_amount ELSE 0 END),0) amount FROM sales s WHERE s.shop_id=? AND s.terminal_id=? AND julianday(s.sold_at)>=julianday(?) AND julianday(s.sold_at)<=julianday(?)").get(12,"dq_0123456789abcdef",opened,closed).amount;
const cashOut = db.prepare("SELECT COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM x_sale_pay p WHERE p.shop_id=r.shop_id AND p.sale_id=r.sale_id AND p.reversed_at IS NOT NULL) THEN (SELECT COALESCE(SUM(p.amount),0) FROM x_sale_pay p WHERE p.shop_id=r.shop_id AND p.sale_id=r.sale_id AND p.method='cash' AND p.reversed_at IS NOT NULL AND julianday(p.reversed_at)>=julianday(?) AND julianday(p.reversed_at)<=julianday(?)) WHEN r.payment_method='cash' THEN r.total_amount ELSE 0 END),0) amount FROM sale_reversals r WHERE r.shop_id=? AND r.terminal_id=? AND julianday(r.reversed_at)>=julianday(?) AND julianday(r.reversed_at)<=julianday(?)").get(opened,closed,12,"dq_0123456789abcdef",opened,closed).amount;
assert.equal(cashIn,35,"mixed checkout adds only its cash portion to the drawer");
assert.equal(cashOut,20,"mixed reversal removes only its cash portion; legacy cash fallback remains");
assert.equal(100+cashIn-cashOut,115,"shift expected cash uses cash tender portions only");
db.close();

const workerDb = new DatabaseSync(":memory:");
workerDb.exec("CREATE TABLE products(id INTEGER PRIMARY KEY, shop_id INTEGER, name TEXT, selling_price REAL, cost_price REAL, quantity REAL, reserved_quantity REAL DEFAULT 0, is_archived INTEGER DEFAULT 0, updated_at TEXT); CREATE TABLE sales(id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER, product_id INTEGER, product_name TEXT, quantity REAL, unit_price REAL, unit_cost REAL, total_amount REAL, estimated_profit REAL, sold_at TEXT DEFAULT CURRENT_TIMESTAMP, terminal_id TEXT, subtotal_amount REAL, discount_amount REAL DEFAULT 0, payment_method TEXT); CREATE TABLE stock_movements(id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER, product_id INTEGER, change_type TEXT, quantity_change REAL, resulting_quantity REAL, note TEXT); CREATE TABLE delivery_transaction_assertions(assertion_key TEXT PRIMARY KEY, ok INTEGER CHECK(ok=1)); INSERT INTO products(id,shop_id,name,selling_price,cost_price,quantity,reserved_quantity,is_archived) VALUES(7,12,'Tea',150,90,5,0,0);");
const d1 = {
  prepare(sql) { return { bind(...args) { return {
    async first() { return workerDb.prepare(sql).get(...args) || null; },
    async all() { return { results: workerDb.prepare(sql).all(...args) }; },
    async run() { const r=workerDb.prepare(sql).run(...args); return { meta:{ changes:r.changes, last_row_id:Number(r.lastInsertRowid||0) } }; },
    sql, args,
  }; }}; },
  async batch(statements) {
    workerDb.exec("BEGIN");
    try { const out=[]; for(const s of statements){const r=workerDb.prepare(s.sql).run(...s.args);out.push({meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid||0)}})} workerDb.exec("COMMIT"); return out; }
    catch(e){workerDb.exec("ROLLBACK");throw e;}
  },
};
const saleBlock = worker.slice(worker.indexOf("function cleanTerminalId"), worker.indexOf("async function recordSale"));
const saleContext = vm.createContext({ crypto:webcrypto, env:{DB:d1} });
vm.runInContext(saleBlock, saleContext);
const saleResult = await vm.runInContext('performSale(env,12,7,2,"dq_0123456789abcdef",10,"cash")', saleContext);
assert.equal(saleResult.total_amount,270);
assert.equal(saleResult.discount_amount,30);
assert.equal(saleResult.subtotal_amount,300);
assert.equal(saleResult.estimated_profit,90);
assert.equal(workerDb.prepare("SELECT quantity FROM products WHERE id=7").get().quantity,3,"stock decreases by quantity sold");
const recorded=workerDb.prepare("SELECT terminal_id, subtotal_amount, discount_amount, total_amount, payment_method FROM sales WHERE id=?").get(saleResult.sale_id);
assert.equal(recorded.terminal_id,"dq_0123456789abcdef","sale records its terminal");
assert.equal(recorded.discount_amount,30);
assert.equal(recorded.payment_method,"cash");
assert.equal(recorded.subtotal_amount,300);
await assert.rejects(vm.runInContext('performSale(env,99,7,1,"dq_0123456789abcdef")', saleContext), /Product not found/,"shop isolation is preserved");
const mixedStart = worker.indexOf("async function sellMixedBatch"), mixedEnd = worker.indexOf("// ==================== REVERSE A SALE", mixedStart);
const mixedRequest = { headers:{ get(name){ return name === "X-Denquva-Terminal-Id" ? "dq_0123456789abcdef" : null; } } };
const mixedContext = vm.createContext({ crypto:webcrypto, env:{DB:d1}, json:(body)=>body, mixedRequest, cleanTerminalId:(value)=>value });
vm.runInContext(worker.slice(mixedStart, mixedEnd), mixedContext);
const mixed = await vm.runInContext('sellMixedBatch(env,mixedRequest,12,[{product_id:7,quantity:1}],0,[{method:"card",amount:60},{method:"transfer",amount:50},{method:"cash",amount:40}])', mixedContext);
assert.equal(mixed.total_amount,150);
assert.equal(mixed.payment_allocations.reduce((n,p)=>n+p.amount,0),150,"allocated tenders equal sale total");
assert.deepEqual(Array.from(mixed.payment_allocations,p=>p.method).sort(),["card","cash","transfer"]);
assert.equal(workerDb.prepare("SELECT payment_method FROM sales WHERE id=?").get(mixed.succeeded[0].sale_id).payment_method,"mixed");
const beforeInvalid=workerDb.prepare("SELECT quantity FROM products WHERE id=7").get().quantity;
await assert.rejects(vm.runInContext('sellMixedBatch(env,mixedRequest,12,[{product_id:7,quantity:1}],0,[{method:"transfer",amount:149},{method:"cash",amount:2}])', mixedContext),/amounts must add up to the checkout total/);
await assert.rejects(vm.runInContext('sellMixedBatch(env,mixedRequest,12,[{product_id:7,quantity:1}],0,[{method:"cash",amount:75},{method:"cash",amount:75}])', mixedContext),/without duplicates/);
assert.equal(workerDb.prepare("SELECT quantity FROM products WHERE id=7").get().quantity,beforeInvalid,"invalid tender does not change stock");
await assert.rejects(vm.runInContext('sellMixedBatch(env,mixedRequest,12,[{product_id:7,quantity:999}],0,[{method:"transfer",amount:100},{method:"cash",amount:149900}])', mixedContext),/available/);
assert.equal(workerDb.prepare("SELECT quantity FROM products WHERE id=7").get().quantity,beforeInvalid,"unavailable stock does not create a partial split sale");
workerDb.close();
const posSource = await text("js/pos.js");
assert.match(posSource, /methodBtn\("mixed", "Mixed"/);
assert.match(posSource, /\[\["card","POS amount"\],\["transfer","Transfer amount"\],\["cash","Cash amount"\]\]/);
assert.match(posSource, /I confirmed the POS payment completed on the terminal/);
const mixedUiStart=posSource.indexOf("function posMixedUpdate()"),mixedUiEnd=posSource.indexOf("async function posConfirmMixedPayment()",mixedUiStart);
const uiFields=new Map([
  ["pos-mixed-card",{value:"60"}],["pos-mixed-transfer",{value:"50"}],["pos-mixed-cash",{value:"40"}],
  ["pos-mixed-card-confirmed",{checked:true}],["pos-mixed-transfer-verified",{checked:true}],
  ["pos-mixed-entered",{textContent:""}],["pos-mixed-remaining",{textContent:""}],
  ["pos-mixed-submit",{disabled:true,classList:{toggle(){}}}],
]);
const uiContext=vm.createContext({posEl:id=>uiFields.get(id),posCartSnapshot:()=>({total:150}),formatMoney:n=>String(n)});
vm.runInContext(posSource.slice(mixedUiStart,mixedUiEnd),uiContext);
vm.runInContext("posMixedUpdate()",uiContext);
assert.equal(uiFields.get("pos-mixed-submit").disabled,false,"UI enables a correctly confirmed three-tender total");
uiFields.get("pos-mixed-transfer-verified").checked=false;
vm.runInContext("posMixedUpdate()",uiContext);
assert.equal(uiFields.get("pos-mixed-submit").disabled,true,"UI requires bank verification for transfer tender");
uiFields.get("pos-mixed-transfer-verified").checked=true;
uiFields.get("pos-mixed-cash").value="39";
vm.runInContext("posMixedUpdate()",uiContext);
assert.equal(uiFields.get("pos-mixed-submit").disabled,true,"UI blocks tender amounts that do not equal the total");
const source = await text("js/hardware-pos.js");
const values = new Map();
const writes = [];
const apiCalls = [];
const context = vm.createContext({
  TextEncoder, Uint8Array, crypto: webcrypto,
  API_BASE: "https://denquva-api.test", USE_SAMPLE_DATA: false,
  authFetch: async (url, options = {}) => { apiCalls.push({url, options}); return { ok: true, json: async () => String(options.method || "GET").toUpperCase() === "PATCH" ? {success:true, expected_cash:30, closing_cash:30, variance:0} : String(options.method || "GET").toUpperCase() === "POST" ? {success:true,id:"sh_test"} : {current:null,shifts:[]} }; },
  prompt: () => "30",
  window: { isSecureContext: true }, navigator: {},
  document: { addEventListener() {}, getElementById() { return null; } },
  localStorage: { getItem(k) { return values.get(k) || null; }, setItem(k, v) { values.set(k, String(v)); } },
  activeShopId: 12, multiSaleCart: new Map(), multiSaleProducts: [], hardwareProducts: [],
  shopSettings: { business_name: "Test Shop", currency_code: "NGN" }, currentShop: null,
  formatMoney: (n) => "NGN " + Number(n).toFixed(2),
  escapeHtml: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  toast() {}, render() {}, confirm: () => true, isStaff: () => false, posMethodLabel: (m) => m,
  posBeep() {}, posNowClock: () => "2026-01-01 12:00",
  posFindByCode: (list, sku) => list.find((p) => p.sku === sku),
  posQuickAdd: (sku, target) => { context.quickAdd = [sku, target]; },
  posCartSnapshot() {
    const items = [];
    let total = 0;
    for (const [id, quantity] of context.multiSaleCart) {
      const product = context.multiSaleProducts.find((p) => p.id === id);
      items.push({ product_id: id, name: product.name, quantity, unit_price: product.selling_price });
      total += product.selling_price * quantity;
    }
    return { items, total, count: items.reduce((sum, item) => sum + item.quantity, 0) };
  },
});
vm.runInContext(source, context, { filename: "hardware-pos.js" });

const firstId = vm.runInContext("hardwareTerminalId()", context);
assert.equal(vm.runInContext("hardwareTerminalId()", context), firstId, "terminal id persists on one shop");
await vm.runInContext('hardwareLoadShift()', context);
assert.ok(apiCalls.at(-1).url.startsWith('https://denquva-api.test/api/x/pos-shifts?'), 'shift list uses Worker API base');
await vm.runInContext('hardwareOpenShift()', context);
assert.ok(apiCalls.some(c => c.options.method === 'POST' && c.url === 'https://denquva-api.test/api/x/pos-shifts'), 'open shift posts to Worker API base');
vm.runInContext('hardwareShift={id:"sh_test"}', context);
await vm.runInContext('hardwareCloseShift()', context);
assert.ok(apiCalls.some(c => c.options.method === 'PATCH' && c.url === 'https://denquva-api.test/api/x/pos-shifts/sh_test'), 'close shift patches Worker API base');
console.log('PASS: shift list/open/close use the separate Worker API origin');
vm.runInContext("activeShopId = 13", context);
assert.notEqual(vm.runInContext("hardwareTerminalId()", context), firstId, "terminal id differs by shop");
vm.runInContext('activeShopId=12; hardwareProducts=multiSaleProducts=[{id:7,name:"Tea",sku:"T001",quantity:4,selling_price:150}]; hardwareScan("T001"); hardwareScan("T001")', context);
assert.equal(vm.runInContext("multiSaleCart.get(7)", context), 2, "repeat scans increase quantity");
vm.runInContext('hardwareScan("UNKNOWN-77")', context);
assert.deepEqual(context.quickAdd, ["UNKNOWN-77", "hardware-pos"], "unknown barcode uses existing quick-add flow");
const cards = vm.runInContext('hardwareProductCards([{id:8,name:"<script>",sku:"S",quantity:1,selling_price:5}])', context);
assert.ok(cards.includes("&lt;script&gt;"), "product text is HTML-escaped");
const receipt = new TextDecoder().decode(vm.runInContext('hardwarePrintText({items:[{name:"Tea",quantity:2,unit_price:150}],total:300,method:"cash",reference:"DQ-123",time:Date.now()})', context));
for (const value of ["Test Shop", "Tea", "TOTAL", "DQ-123", "2026-01-01 12:00"]) assert.ok(receipt.includes(value), "receipt includes " + value);

vm.runInContext('hardwarePrinter={writable:{getWriter(){return {write(bytes){globalThis.lastPrint=Array.from(bytes);},releaseLock(){}}}}}; hardwarePrinterKind="serial"', context);
await vm.runInContext('hardwarePrintReceipt({items:[{name:"Tea",quantity:1,unit_price:150}],total:150,method:"cash"})', context);
assert.ok(context.lastPrint?.length > 10, "serial adapter transmits receipt bytes");
await vm.runInContext('hardwareDisconnectPrinter()', context);
assert.equal(vm.runInContext("hardwarePrinter", context), null);

console.log("PASS: terminal ID isolation and validation");
console.log("PASS: D1 migrations add terminal, discount, tender and shift metadata; shift cash math/uniqueness validated");
console.log("PASS: Worker sale applies owner-approved discount to revenue and profit while preserving stock and terminal attribution");
console.log("PASS: barcode quantity, unknown barcode quick-add, and escaped product rendering");
console.log("PASS: thermal receipt content and serial transmission mock");
console.log("PASS: printer disconnect cleanup");


