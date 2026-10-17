// ============================================================================
// Denquva extras: staff logins, owner approval, stock adjustment and stocktake,
// archive and restore, expenses, End of Day, part payments on credit, offline
// selling queue, activity log, backup and support.
// Loads after app.js, pos.js and reverse.js. Needs the server add-on
// (worker-extras.js). If the add-on is missing, the screens say so.
// ============================================================================

const X_SUPPORT = { wa1: "2348185947780", wa2: "2348169142002", email: "denquva@gmail.com" };
const X_REASONS = ["Damaged", "Expired", "Stolen or missing", "Counting mistake", "Used in the shop", "Stocktake count", "Other"];
const X_EXP_CATS = ["Rent", "Transport", "Electricity", "Salary", "Packaging", "Airtime and data", "Maintenance", "Other"];
const X_METHODS = [["cash", "Cash"], ["transfer", "Transfer"], ["card", "Card POS"]];

// ---------------- small helpers ----------------
const XApi = {
  async call(path, { method = "GET", body, headers, signal } = {}) {
    const h = { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers || {}) };
    const res = await authFetch(`${API_BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
    return apiJson(res);
  },
  summary(range) { const [from, to] = xRangeBounds(range); return XApi.call(`/api/x/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); },
};
function xIsNetworkError(err) {
  return !!err && (err instanceof TypeError || err.name === "AbortError" || /Failed to fetch|NetworkError|Load failed|Connection is slow|network/i.test(err.message || "")) && !err.status;
}
function xRangeBounds(range) {
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "today") return [sod.toISOString(), new Date(sod.getTime() + 86400000).toISOString()];
  if (range === "week") return [new Date(now.getTime() - 7 * 86400000).toISOString(), new Date(now.getTime() + 60000).toISOString()];
  if (range === "month") return [new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()];
  return ["0000", "9999"];
}
function xInput(id, placeholder, extra = "") {
  return `<input id="${id}" placeholder="${placeholder}" ${extra} class="w-full border border-black/10 rounded-xl px-3 py-2.5" />`;
}
function xMethodSelect(id, def = "cash") {
  return `<select id="${id}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 bg-white">${X_METHODS.map(([k, l]) => `<option value="${k}" ${k === def ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}
function xNeedServer(err) {
  return err && err.status === 404 ? "This needs the server update. See DEPLOY.md, step 2." : (err && err.message) || "Something went wrong";
}
function xDigits(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 11) d = "234" + d.slice(1);
  return d;
}

// ---------------- show or hide PINs ----------------
function xPinField(id, placeholder, opts = {}) {
  const big = opts.center ? "text-center text-xl tracking-widest" : "";
  return `<div style="position:relative"><input id="${id}" type="password" inputmode="${opts.numeric === false ? "text" : "numeric"}" ${opts.numeric === false ? "" : 'maxlength="6"'} placeholder="${placeholder}" autocomplete="off" ${opts.extra || ""} class="w-full border border-black/10 rounded-xl px-3 py-2.5 ${big}" style="padding-right:4.2rem" /><button type="button" onclick="xTogglePin('${id}', this)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%)" class="text-xs font-semibold text-primary">Show</button></div>`;
}
function xTogglePin(id, btn) {
  const i = document.getElementById(id);
  if (!i) return;
  const show = i.type === "password";
  i.type = show ? "text" : "password";
  btn.textContent = show ? "Hide" : "Show";
}
let xSecretCb = null;
function xSecretSheet({ title, note, placeholder, numeric = true, cta = "Save", onSubmit }) {
  xSecretCb = onSubmit;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">${escapeHtml(title)}</h2>
    ${note ? `<p class="text-sm text-ink/50 mb-3">${escapeHtml(note)}</p>` : ""}
    ${xPinField("x-secret", placeholder, { center: numeric, numeric, extra: `onkeydown="if(event.key==='Enter') xSecretGo()"` })}
    <div class="flex gap-2 mt-4">
      <button onclick="xSecretCb = null; posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button id="x-secret-go" onclick="xSecretGo()" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">${escapeHtml(cta)}</button>
    </div>`);
  setTimeout(() => { const i = document.getElementById("x-secret"); if (i) i.focus(); }, 60);
}
async function xSecretGo() {
  const v = document.getElementById("x-secret").value.trim();
  if (!v || !xSecretCb) return;
  const btn = document.getElementById("x-secret-go"); btn.disabled = true;
  try { const ok = await xSecretCb(v); if (ok !== false) posCloseSheet(); else btn.disabled = false; }
  catch (e) { btn.disabled = false; toast(xNeedServer(e)); }
}

// ---------------- owner approval for staff ----------------
let xApprovalWaiter = null;
function xHandleApproval(message) {
  return new Promise(resolve => {
    const prev = posVisible("pos-modal") ? posEl("pos-modal-body").innerHTML : null;
    xApprovalWaiter = { resolve, prev };
    posOpenSheet(`
      <h2 class="font-display text-xl font-extrabold mb-1">Owner approval</h2>
      <p class="text-sm text-ink/50 mb-3">${escapeHtml(message || "The owner must approve this.")}</p>
      ${xPinField("x-appr-pin", "Owner PIN", { center: true, extra: `onkeydown="if(event.key==='Enter') xApprovalSubmit()"` })}
      <p id="x-appr-err" class="text-xs text-danger mt-2" style="min-height:1rem"></p>
      <div class="flex gap-2 mt-3">
        <button onclick="xApprovalDone(null)" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
        <button id="x-appr-go" onclick="xApprovalSubmit()" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Approve</button>
      </div>`);
    setTimeout(() => { const i = document.getElementById("x-appr-pin"); if (i) i.focus(); }, 60);
  });
}
async function xApprovalSubmit() {
  const pin = document.getElementById("x-appr-pin").value.trim();
  const err = document.getElementById("x-appr-err");
  if (!/^\d{4,6}$/.test(pin)) { err.textContent = "Enter the 4 to 6 digit PIN."; return; }
  const btn = document.getElementById("x-appr-go");
  btn.disabled = true;
  try {
    const r = await XApi.call("/api/x/approve", { method: "POST", body: { pin } });
    xApprovalDone(r.token);
  } catch (e) {
    btn.disabled = false;
    err.textContent = e.message || "Could not check the PIN";
  }
}
function xApprovalDone(token) {
  const w = xApprovalWaiter;
  if (!w) return;
  xApprovalWaiter = null;
  if (w.prev !== null) posOpenSheet(w.prev); else posCloseSheet();
  w.resolve(token);
}

// ---------------- staff login ----------------
function xViewStaffLogin() {
  return `
    <div class="max-w-sm mx-auto mt-10 md:mt-20">
      <div class="text-center mb-6">
        <h1 class="brand-row brand-row-center font-display text-3xl font-extrabold text-primary-dark"><img src="icons/icon-192.png" alt="" width="36" height="36" class="brand-logo brand-logo-lg" /><span>Denquva</span></h1>
        <p class="text-sm text-ink/50 mt-1">Staff log in</p>
      </div>
      <div class="card p-4 space-y-3">
        <input id="sl-email" type="email" inputmode="email" placeholder="Shop email (the owner's login email)" value="${escapeHtml(localStorage.getItem("denquva_staff_email") || "")}" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
        <input id="sl-name" placeholder="Your name" autocomplete="off" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
        ${xPinField("sl-pin", "Your PIN", { extra: `onkeydown="if(event.key==='Enter') xStaffLogin()"` })}
        <button id="sl-go" onclick="xStaffLogin()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Log in as staff</button>
        <button onclick="goAuth('login')" class="w-full text-xs text-primary underline text-center">Owner log in</button>
      </div>
      <p class="text-xs text-ink/40 text-center mt-4">Staff can sell and take credit payments. Prices, costs, profit and settings stay with the owner.</p>
    </div>`;
}
async function xStaffLogin() {
  const email = document.getElementById("sl-email").value.trim();
  const name = document.getElementById("sl-name").value.trim();
  const pin = document.getElementById("sl-pin").value.trim();
  if (!email || !name || !pin) { toast("Enter the shop email, your name and your PIN"); return; }
  const btn = document.getElementById("sl-go");
  btn.disabled = true; btn.textContent = "Logging in…";
  try {
    const res = await fetch(`${API_BASE}/auth/staff-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name, pin }) });
    const r = await apiJson(res);
    localStorage.setItem("denquva_staff_email", email);
    authToken = r.token;
    localStorage.setItem("denquva_token", authToken);
    activeShopId = String(r.shop_id);
    localStorage.setItem("denquva_active_shop_id", activeShopId);
    localStorage.setItem("denquva_returning", "1");
    currentShop = null; shopSettings = null; currentView = "dashboard"; authMode = "login";
    render();
  } catch (e) {
    toast(xIsNetworkError(e) ? "No connection. Try again." : (e.status === 404 ? "Staff login needs the server update." : e.message));
    btn.disabled = false; btn.textContent = "Log in as staff";
  }
}
function xStaffSettingsHtml() {
  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Settings</h1>
    <div class="card p-4 mb-4">
      <h2 class="font-display font-bold mb-1">Signed in as ${escapeHtml(staffName())}</h2>
      <p class="text-sm text-ink/50">Staff account. Prices, costs, profit, debts and settings are kept for the owner.</p>
    </div>
    ${xStaffShopsCardHtml()}
    ${xSupportCardHtml()}
    <button onclick="logout()" class="w-full bg-danger text-white font-semibold py-3 rounded-xl mt-4">Log out</button>`;
}
function xStaffShopsCardHtml() {
  const shops = (currentShop && currentShop.shops) || [];
  if (shops.length < 2) return "";
  return `
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Your shops</h2>
      <p class="text-sm text-ink/50 mb-3">The owner gave you access to these shops.</p>
      ${shops.map(s => `
        <div class="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
          <span class="font-medium">${escapeHtml(s.name)}</span>
          ${String(s.id) === String(activeShopId) ? `<span class="text-xs font-semibold text-primary">In use</span>` : `<button onclick="switchShop(${s.id})" class="text-xs bg-primary text-white font-semibold px-3 py-1.5 rounded-full">Use this shop</button>`}
        </div>`).join("")}
    </div>`;
}

// ---------------- support ----------------
function xSupportCardHtml() {
  return `
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Help and support</h2>
      <p class="text-sm text-ink/50 mb-3">Talk to a person. We reply on WhatsApp fastest.</p>
      <button onclick="xOpenSupport()" class="w-full bg-primary-light text-primary-dark font-semibold py-2.5 rounded-xl">Contact support</button>
    </div>`;
}
function xOpenSupport() {
  const shop = (currentShop && currentShop.shop_name) || "";
  const mail = (currentShop && currentShop.email) || "";
  const msg = encodeURIComponent(`Hello Denquva support. Shop: ${shop}. Login email: ${mail}. I need help with: `);
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-3">Contact support</h2>
    <div class="space-y-2">
      <a href="https://wa.me/${X_SUPPORT.wa1}?text=${msg}" target="_blank" rel="noopener" class="block text-center bg-primary text-white font-semibold py-2.5 rounded-xl">WhatsApp +${X_SUPPORT.wa1}</a>
      <a href="https://wa.me/${X_SUPPORT.wa2}?text=${msg}" target="_blank" rel="noopener" class="block text-center bg-primary-light text-primary-dark font-semibold py-2.5 rounded-xl">WhatsApp +${X_SUPPORT.wa2}</a>
      <a href="tel:+${X_SUPPORT.wa1}" class="block text-center border border-black/10 font-semibold py-2.5 rounded-xl">Call +${X_SUPPORT.wa1}</a>
      <a href="mailto:${X_SUPPORT.email}?subject=${encodeURIComponent("Denquva help: " + shop)}" class="block text-center border border-black/10 font-semibold py-2.5 rounded-xl">Email ${X_SUPPORT.email}</a>
    </div>
    <button onclick="posCloseSheet()" class="w-full py-2.5 rounded-xl border border-black/10 font-semibold mt-3">Close</button>`);
}

// ---------------- pay method picker ----------------
let xPayCb = null;
function xAskPayMethod(title, cb) {
  xPayCb = cb;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-3">${escapeHtml(title)}</h2>
    <div class="space-y-2">${X_METHODS.map(([k, l]) => `<button onclick="xPayPicked('${k}')" class="w-full py-3 rounded-xl border border-black/10 font-semibold">${l}</button>`).join("")}</div>
    <button onclick="posCloseSheet()" class="w-full py-2.5 rounded-xl text-ink/50 font-semibold mt-2">Cancel</button>`);
}
function xPayPicked(method) {
  const cb = xPayCb; xPayCb = null;
  posCloseSheet();
  if (cb) cb(method);
}

// ---------------- offline selling queue ----------------
const XQ_KEY = "denquva_offline_queue";
const XQ_ISSUES = "denquva_offline_issues";
function xRead(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } }
function xWrite(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} xUpdatePill(); }
function xNewRef() { return "o" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function xCacheProducts(list) { try { localStorage.setItem(`denquva_prod_${activeShopId}`, JSON.stringify(list)); } catch {} }
function xReadProductCache() { try { return JSON.parse(localStorage.getItem(`denquva_prod_${activeShopId}`) || "null"); } catch { return null; } }
function xQueueAdd(ref, items) {
  const q = xRead(XQ_KEY);
  q.push({ ref, shop: String(activeShopId), items, at: new Date().toISOString() });
  xWrite(XQ_KEY, q);
  const cache = xReadProductCache();   // keep the stock numbers honest while offline
  if (cache) {
    items.forEach(it => { const p = cache.find(x => x.id === it.product_id); if (p) p.quantity = Math.max(0, p.quantity - it.quantity); });
    xCacheProducts(cache);
  }
}
let xSyncing = false;
async function xSyncQueue() {
  if (xSyncing || !authToken || USE_SAMPLE_DATA) return;
  const all = xRead(XQ_KEY);
  const mine = all.filter(e => e.shop === String(activeShopId));
  if (!mine.length) { xUpdatePill(); return; }
  xSyncing = true;
  let synced = 0;
  try {
    for (const e of mine) {
      try {
        const r = await Api.sellBatch(e.items, { method: "cash", ref: e.ref, clientTime: e.at });
        xWrite(XQ_KEY, xRead(XQ_KEY).filter(x => x.ref !== e.ref));
        synced++;
        if (r.failed && r.failed.length) xWrite(XQ_ISSUES, [...xRead(XQ_ISSUES), { at: e.at, items: e.items, why: r.failed.map(f => f.reason || "Not recorded").join("; ") }]);
      } catch (err) {
        if (xIsNetworkError(err) || err.status === 401 || /read only/i.test(err.message || "")) break;
        xWrite(XQ_KEY, xRead(XQ_KEY).filter(x => x.ref !== e.ref));
        xWrite(XQ_ISSUES, [...xRead(XQ_ISSUES), { at: e.at, items: e.items, why: err.message || "Rejected by the server" }]);
      }
    }
  } finally { xSyncing = false; xUpdatePill(); }
  if (synced) { toast(`${synced} offline sale${synced === 1 ? "" : "s"} synced`); render(); }
}
function xUpdatePill() {
  let pill = document.getElementById("x-pill");
  if (!pill) {
    pill = document.createElement("button");
    pill.id = "x-pill"; pill.className = "x-pill hidden"; pill.onclick = xShowQueueSheet;
    document.body.appendChild(pill);
  }
  const n = xRead(XQ_KEY).filter(e => e.shop === String(activeShopId)).length;
  const bad = xRead(XQ_ISSUES).length;
  if (!authToken || (!n && !bad)) { pill.classList.add("hidden"); return; }
  pill.classList.remove("hidden");
  pill.classList.toggle("x-pill-bad", !!bad);
  pill.textContent = bad ? `${bad} sale${bad === 1 ? "" : "s"} need attention` : `${n} waiting to sync`;
}
function xShowQueueSheet() {
  const q = xRead(XQ_KEY).filter(e => e.shop === String(activeShopId));
  const issues = xRead(XQ_ISSUES);
  const line = e => `<div class="py-2 border-b border-black/5 last:border-0 text-sm"><div class="text-xs text-ink/45">${new Date(e.at).toLocaleString()}</div>${(e.items || []).map(i => `${i.quantity} x item ${i.product_id}`).join(", ")}${e.why ? `<div class="text-xs text-danger">${escapeHtml(e.why)}</div>` : ""}</div>`;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">Offline sales</h2>
    <p class="text-sm text-ink/50 mb-3">Sales made without network are kept on this phone and sent when you are back online.</p>
    ${q.length ? `<div class="text-xs font-semibold text-ink/45 mb-1">Waiting to sync</div>${q.map(line).join("")}` : ""}
    ${issues.length ? `<div class="text-xs font-semibold text-danger mt-3 mb-1">Could not be recorded (check your stock)</div>${issues.map(line).join("")}<button onclick="xWrite(XQ_ISSUES, []); posCloseSheet()" class="w-full py-2 rounded-xl bg-danger-light text-danger font-semibold mt-2 text-sm">Clear this list</button>` : ""}
    <div class="flex gap-2 mt-4">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Close</button>
      ${q.length ? `<button onclick="posCloseSheet(); xSyncQueue()" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Sync now</button>` : ""}
    </div>`);
}
// Called from confirmMultiSale when a cash sale cannot reach the server.
function xOfflineCashSale(ref, items, snapshot) {
  xQueueAdd(ref, items);
  closeModal("multisale-modal");
  multiSaleCart = new Map();
  toast("No network. Sale saved on this phone, it will sync later.");
  if (snapshot) posShowReceipt({ items: snapshot.items, total: snapshot.total, method: "cash", failed: [], time: Date.now(), sales: [], offline: true });
  render();
}
window.addEventListener("online", () => setTimeout(xSyncQueue, 800));
setInterval(xSyncQueue, 30000);
setTimeout(() => { xUpdatePill(); xSyncQueue(); }, 2500);

// ---------------- stock adjustment, stocktake, archive ----------------
function xOpenAdjust(id) {
  const p = cachedProducts.find(x => x.id === id);
  if (!p) return;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">Adjust stock</h2>
    <p class="text-sm text-ink/50 mb-3">${escapeHtml(p.name)}. The system says ${p.quantity}. Type what is really on the shelf.</p>
    <div class="space-y-3">
      <input id="xa-new" type="number" inputmode="numeric" min="0" value="${p.quantity}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 text-lg font-semibold" />
      <select id="xa-reason" class="w-full border border-black/10 rounded-xl px-3 py-2.5 bg-white">${X_REASONS.map(r => `<option>${r}</option>`).join("")}</select>
      ${xInput("xa-note", "Note (optional)")}
    </div>
    <div class="flex gap-2 mt-4">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button id="xa-go" onclick="xSubmitAdjust(${id})" class="flex-1 py-2.5 rounded-xl bg-amber text-white font-semibold">Save count</button>
    </div>`);
}
async function xSubmitAdjust(id) {
  const q = parseInt(document.getElementById("xa-new").value, 10);
  if (!Number.isFinite(q) || q < 0) { toast("Enter a count of 0 or more"); return; }
  const btn = document.getElementById("xa-go"); btn.disabled = true;
  try {
    const r = await XApi.call("/api/x/stock-adjust", { method: "POST", body: { items: [{ product_id: id, new_quantity: q }], reason: document.getElementById("xa-reason").value, note: document.getElementById("xa-note").value.trim() } });
    posCloseSheet();
    const x = (r.results || [])[0];
    toast(x && x.error ? x.error : x && x.delta ? `Stock now ${x.after} (${x.delta > 0 ? "+" : ""}${x.delta})` : "No change");
    render();
  } catch (e) { btn.disabled = false; toast(xNeedServer(e)); }
}
let xStocktakeList = [];
async function xOpenStocktake() {
  try { xStocktakeList = await Api.getProducts(""); } catch (e) { toast(e.message); return; }
  if (!xStocktakeList.length) { toast("Add products first"); return; }
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">Stocktake</h2>
    <p class="text-sm text-ink/50 mb-2">Count the shelf and type the real number. Leave a box empty to skip it.</p>
    <input id="xs-search" placeholder="Search" oninput="xStocktakeFilter()" class="w-full border border-black/10 rounded-xl px-3 py-2 mb-2" />
    <div id="xs-list" style="max-height:48vh;overflow-y:auto">
      ${xStocktakeList.map(p => `
        <div class="xs-row flex items-center justify-between gap-2 py-2 border-b border-black/5" data-name="${escapeHtml(p.name.toLowerCase())}">
          <div class="min-w-0 flex-1"><div class="text-sm font-medium truncate">${escapeHtml(p.name)}</div><div class="text-xs text-ink/45">System: ${p.quantity}</div></div>
          <input type="number" inputmode="numeric" min="0" data-id="${p.id}" data-sys="${p.quantity}" placeholder="Count" class="xs-in w-24 border border-black/10 rounded-lg px-2 py-1.5 text-right" />
        </div>`).join("")}
    </div>
    <div class="flex gap-2 mt-3">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button onclick="xStocktakeReview()" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Review</button>
    </div>`);
}
function xStocktakeFilter() {
  const t = document.getElementById("xs-search").value.trim().toLowerCase();
  document.querySelectorAll(".xs-row").forEach(r => { r.style.display = !t || r.dataset.name.includes(t) ? "" : "none"; });
}
let xStocktakeDiffs = [];
function xStocktakeReview() {
  xStocktakeDiffs = [];
  document.querySelectorAll(".xs-in").forEach(i => {
    if (i.value === "") return;
    const count = parseInt(i.value, 10), sys = parseInt(i.dataset.sys, 10);
    if (Number.isFinite(count) && count >= 0 && count !== sys) {
      const p = xStocktakeList.find(x => x.id === Number(i.dataset.id));
      xStocktakeDiffs.push({ product_id: Number(i.dataset.id), new_quantity: count, name: p ? p.name : "", sys });
    }
  });
  if (!xStocktakeDiffs.length) { posCloseSheet(); toast("Everything you counted matches the system"); return; }
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">${xStocktakeDiffs.length} difference${xStocktakeDiffs.length === 1 ? "" : "s"}</h2>
    <p class="text-sm text-ink/50 mb-2">These stock numbers will change.</p>
    <div style="max-height:40vh;overflow-y:auto">${xStocktakeDiffs.map(d => `<div class="flex justify-between py-1.5 border-b border-black/5 text-sm"><span class="truncate pr-2">${escapeHtml(d.name)}</span><span class="font-semibold flex-shrink-0">${d.sys} to ${d.new_quantity} <span class="${d.new_quantity < d.sys ? "text-danger" : "text-primary"}">(${d.new_quantity > d.sys ? "+" : ""}${d.new_quantity - d.sys})</span></span></div>`).join("")}</div>
    <select id="xs-reason" class="w-full border border-black/10 rounded-xl px-3 py-2.5 bg-white mt-3">${["Stocktake count", ...X_REASONS.filter(r => r !== "Stocktake count")].map(r => `<option>${r}</option>`).join("")}</select>
    <div class="flex gap-2 mt-3">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Back</button>
      <button id="xs-go" onclick="xStocktakeApply()" class="flex-1 py-2.5 rounded-xl bg-amber text-white font-semibold">Apply</button>
    </div>`);
}
async function xStocktakeApply() {
  const btn = document.getElementById("xs-go"); btn.disabled = true;
  try {
    const r = await XApi.call("/api/x/stock-adjust", { method: "POST", body: { items: xStocktakeDiffs.map(d => ({ product_id: d.product_id, new_quantity: d.new_quantity })), reason: document.getElementById("xs-reason").value, note: "Stocktake" } });
    posCloseSheet();
    toast(`Stock updated for ${(r.results || []).filter(x => x.delta).length} product(s)`);
    render();
  } catch (e) { btn.disabled = false; toast(xNeedServer(e)); }
}
function xToggleArchived() { productShowArchived = !productShowArchived; productSearchTerm = ""; render(); }
async function xRestoreProduct(id) {
  try { await XApi.call(`/api/x/restore/${id}`, { method: "POST", body: {} }); toast("Product restored"); render(); }
  catch (e) { toast(xNeedServer(e)); }
}

// ---------------- Expenses ----------------
let xExpRange = "month";
async function xViewExpenses() {
  const [from, to] = xRangeBounds(xExpRange);
  let rows = [], problem = "";
  try { rows = await XApi.call(`/api/x/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); } catch (e) { problem = xNeedServer(e); }
  const total = rows.reduce((n, r) => n + Number(r.amount || 0), 0);
  const byCat = {};
  rows.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + Number(r.amount || 0); });
  const chips = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["all", "All"]].map(([k, l]) => `<button onclick="xExpRange='${k}'; render()" class="px-3 py-1.5 rounded-full text-xs font-medium ${xExpRange === k ? "bg-primary-dark text-white" : "bg-surface border border-black/10"}">${l}</button>`).join("");
  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Sales</h1>
    <div class="flex gap-2 mb-4 flex-wrap">${salesTabsHtml()}</div>
    <div class="flex items-center justify-between gap-2 mb-3">
      <div class="flex gap-2 flex-wrap">${chips}</div>
      <button onclick="xOpenExpenseForm()" class="bg-primary text-white font-semibold px-4 py-2 rounded-full text-sm whitespace-nowrap">+ Expense</button>
    </div>
    <div class="stat-card mb-3"><div class="text-xs text-ink/50">Money spent running the shop</div><div class="font-display text-xl font-extrabold text-danger">${formatMoney(total)}</div>
      ${Object.keys(byCat).length ? `<div class="text-xs text-ink/45 mt-1">${Object.entries(byCat).map(([k, v]) => `${escapeHtml(k)} ${formatMoney(v)}`).join(" · ")}</div>` : ""}</div>
    <p class="text-xs text-ink/45 mb-3">Expenses are taken off your estimated profit to show net profit on the Sales page.</p>
    <div class="card p-4">${problem ? `<div class="text-center py-10 text-danger">${escapeHtml(problem)}</div>` : rows.length ? rows.map(r => `
      <div class="flex items-start justify-between gap-3 py-2.5 border-b border-black/5 last:border-0">
        <div class="min-w-0"><div class="font-medium">${escapeHtml(r.category)}</div>
          <div class="text-xs text-ink/45">${new Date(r.spent_at).toLocaleDateString()} · ${escapeHtml(r.method)}${r.note ? " · " + escapeHtml(r.note) : ""}</div></div>
        <div class="text-right flex-shrink-0"><div class="font-semibold">${formatMoney(r.amount)}</div><button onclick="xDeleteExpense(${r.id})" class="text-xs text-danger underline">Delete</button></div>
      </div>`).join("") : `<div class="text-center py-10 text-ink/40">No expenses in this period.</div>`}</div>`;
}
function xOpenExpenseForm() {
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-3">Add expense</h2>
    <div class="space-y-3">
      <select id="xe-cat" class="w-full border border-black/10 rounded-xl px-3 py-2.5 bg-white">${X_EXP_CATS.map(c => `<option>${c}</option>`).join("")}</select>
      <input id="xe-amount" type="number" inputmode="decimal" min="0" placeholder="Amount" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
      <div><label class="text-xs text-ink/50">Paid from</label>${xMethodSelect("xe-method")}</div>
      ${xInput("xe-note", "Note (optional)")}
      <input id="xe-date" type="date" value="${localDateStr()}" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
    </div>
    <div class="flex gap-2 mt-4">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button id="xe-go" onclick="xSaveExpense()" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Save</button>
    </div>`);
}
async function xSaveExpense() {
  const amount = Number(document.getElementById("xe-amount").value);
  if (!(amount > 0)) { toast("Enter the amount"); return; }
  const d = document.getElementById("xe-date").value || localDateStr();
  const btn = document.getElementById("xe-go"); btn.disabled = true;
  try {
    await XApi.call("/api/x/expenses", { method: "POST", body: { category: document.getElementById("xe-cat").value, amount, method: document.getElementById("xe-method").value, note: document.getElementById("xe-note").value.trim(), spent_at: new Date(d + "T12:00:00").toISOString() } });
    posCloseSheet(); toast("Expense saved"); render();
  } catch (e) { btn.disabled = false; toast(xNeedServer(e)); }
}
async function xDeleteExpense(id) {
  if (!confirm("Delete this expense?")) return;
  try { await XApi.call(`/api/x/expenses/${id}`, { method: "DELETE" }); toast("Deleted"); render(); } catch (e) { toast(xNeedServer(e)); }
}

// ---------------- End of Day ----------------
let xEodDate = null;
let xEodData = null;
async function xViewEod() {
  xEodDate = xEodDate || localDateStr();
  let d = null, problem = "";
  try { d = await XApi.call(`/api/x/eod?date=${xEodDate}&tz=${new Date().getTimezoneOffset()}`); } catch (e) { problem = xNeedServer(e); }
  xEodData = d;
  const head = `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Sales</h1>
    <div class="flex gap-2 mb-4 flex-wrap">${salesTabsHtml()}</div>
    <input type="date" value="${xEodDate}" max="${localDateStr()}" onchange="xEodDate=this.value; render()" class="border border-black/10 rounded-xl px-3 py-2 mb-3 bg-white" />`;
  if (problem) return head + `<div class="card p-4 text-center text-danger">${escapeHtml(problem)}</div>`;
  const row = (label, v) => `<div class="flex justify-between py-1.5 text-sm"><span class="text-ink/60">${label}</span><span class="font-semibold">${formatMoney(v)}</span></div>`;
  const block = (title, o) => `<div class="card p-4 mb-3"><div class="text-xs font-semibold text-ink/45 mb-1">${title}</div>${row("Cash", o.cash)}${row("Transfer", o.transfer)}${row("Card POS", o.card)}</div>`;
  const e = d.expected;
  const closed = d.closed;
  return head + `
    ${block(`Sales (${d.sales_count} recorded)`, d.sales)}
    ${block("Part and full payments received on credit", d.credit_payments)}
    ${(d.refunds.cash + d.refunds.transfer + d.refunds.card) ? block("Sales reversed, money to give back", d.refunds) : ""}
    ${(d.expenses.cash + d.expenses.transfer + d.expenses.card) ? block("Expenses paid", d.expenses) : ""}
    <div class="card p-4 mb-3" style="border-color:rgba(15,107,76,0.35)">
      <div class="text-xs font-semibold text-ink/45 mb-1">What should be there</div>
      <div class="flex justify-between items-baseline"><span class="font-display font-bold">Cash in the till</span><span class="font-display text-2xl font-extrabold text-primary-dark">${formatMoney(e.cash)}</span></div>
      ${row("In your bank, from transfers", e.transfer)}${row("On your card machine", e.card)}
      ${d.manual.count ? `<div class="mt-2 text-xs bg-amber-light text-amber-dark rounded-lg px-3 py-2"><b>${d.manual.count}</b> payment${d.manual.count === 1 ? " was" : "s were"} confirmed by hand (${formatMoney(d.manual.amount)}). Check them against your bank or machine.</div>` : ""}
    </div>
    <div class="card p-4">
      <div class="text-xs font-semibold text-ink/45 mb-2">Count your cash</div>
      <input id="eod-count" type="number" inputmode="decimal" placeholder="Cash you counted" value="${closed ? closed.counted_cash : ""}" oninput="xEodDiff()" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mb-2" />
      <div id="eod-diff" class="text-sm font-semibold mb-2" style="min-height:1.25rem"></div>
      ${xInput("eod-note", "Note (optional)", `value="${closed ? escapeHtml(closed.note || "") : ""}"`)}
      <button onclick="xCloseDay()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mt-3">${closed ? "Update the count" : "Close the day"}</button>
      ${closed ? `<p class="text-xs text-ink/45 mt-2">Closed by ${escapeHtml(closed.actor || "")}. Difference was ${formatMoney(closed.diff)}.</p>` : ""}
    </div>
    <p class="text-xs text-ink/40 mt-3">Only sales made after this update carry a payment method. Older sales are not in this page.</p>`;
}
function xEodDiff() {
  if (!xEodData) return;
  const el = document.getElementById("eod-diff");
  const v = document.getElementById("eod-count").value;
  if (v === "") { el.textContent = ""; return; }
  const diff = Number(v) - xEodData.expected.cash;
  el.className = "text-sm font-semibold mb-2 " + (diff === 0 ? "text-primary" : "text-danger");
  el.textContent = diff === 0 ? "Matches" : diff > 0 ? `${formatMoney(diff)} more than expected` : `${formatMoney(-diff)} short`;
}
async function xCloseDay() {
  const v = document.getElementById("eod-count").value;
  if (v === "") { toast("Enter the cash you counted"); return; }
  try {
    const r = await XApi.call("/api/x/eod", { method: "POST", body: { date: xEodDate, counted_cash: Number(v), expected_cash: xEodData.expected.cash, note: document.getElementById("eod-note").value.trim() } });
    toast(r.diff === 0 ? "Day closed. Cash matches." : `Day closed. Difference ${formatMoney(r.diff)}.`);
    render();
  } catch (e) { toast(xNeedServer(e)); }
}

// ---------------- credit: part payments, reminders, cancel ----------------
let xCustomers = [];
async function xLoadCustomers() { try { xCustomers = await XApi.call("/api/x/customers"); } catch { xCustomers = []; } }
function xCustomerListHtml() { return `<datalist id="x-cust-list">${xCustomers.map(c => `<option value="${escapeHtml(c.name)}"></option>`).join("")}</datalist>`; }
function xFillPhone() {
  const c = xCustomers.find(x => x.name.trim().toLowerCase() === String(creditSaleCustomerName).trim().toLowerCase());
  const el = document.getElementById("creditsale-phone");
  if (c && el && !el.value) { el.value = c.phone || ""; creditSalePhone = el.value; }
}
function xOpenCreditDetail(creditSaleId) {
  const s = lastRenderedCreditSales.find(x => x.id === creditSaleId);
  if (!s) return;
  const pending = s.status === "pending";
  const itemsHtml = (s.items || []).map(i => `
    <div class="flex justify-between py-1.5 border-b border-black/5 last:border-0 text-sm"><span>${escapeHtml(i.product_name)} <span class="text-ink/40">x${i.quantity}</span></span><span class="font-medium">${formatMoney(i.line_total)}</span></div>`).join("");
  const subtotal = s.total_price + s.discount;
  const pays = (s.payments || []).map(p => `<div class="flex justify-between text-xs py-1"><span class="text-ink/50">${new Date(p.at).toLocaleDateString()} · ${escapeHtml(p.method)}${p.note ? " · " + escapeHtml(p.note) : ""}</span><span class="font-semibold ${p.amount < 0 ? "text-danger" : "text-primary"}">${formatMoney(p.amount)}</span></div>`).join("");
  document.getElementById("credit-detail-modal-body").innerHTML = `
    <div class="flex items-center justify-between mb-1">
      <h2 class="font-display text-xl font-extrabold">${escapeHtml(s.customer_name)}</h2>
      <button onclick="closeModal('credit-detail-modal')" class="text-ink/40 text-xl leading-none">✕</button>
    </div>
    <span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-4 ${s.status === "paid" ? "bg-primary-light text-primary-dark" : "bg-amber-light text-amber-dark"}">${s.status === "paid" ? "Paid" : "Pending"}</span>
    <div class="mb-4"><div class="text-xs font-semibold text-ink/45 mb-1">Items</div>${itemsHtml || `<div class="text-sm text-ink/40">No items on record</div>`}</div>
    <div class="space-y-2 text-sm border-t border-black/10 pt-3">
      <div class="flex justify-between"><span class="text-ink/50">Subtotal</span><span class="font-semibold">${formatMoney(subtotal)}</span></div>
      ${s.discount > 0 ? `<div class="flex justify-between"><span class="text-ink/50">Discount</span><span class="font-semibold text-danger">−${formatMoney(s.discount)}</span></div>` : ""}
      <div class="flex justify-between"><span class="text-ink/50">Total price</span><span class="font-bold">${formatMoney(s.total_price)}</span></div>
      ${(s.paid_so_far || 0) > 0 ? `<div class="flex justify-between"><span class="text-ink/50">Paid so far</span><span class="font-semibold text-primary">${formatMoney(s.paid_so_far)}</span></div>` : ""}
      <div class="flex justify-between"><span class="text-ink/50">Outstanding</span><span class="font-semibold ${pending ? "text-danger" : "text-primary"}">${pending ? formatMoney(s.outstanding_amount) : "Settled"}</span></div>
      <div class="flex justify-between border-t border-black/10 pt-3"><span class="text-ink/50">Purchase date</span><span class="font-semibold text-right">${new Date(s.purchase_date).toLocaleString()}</span></div>
      ${s.paid_at ? `<div class="flex justify-between"><span class="text-ink/50">Paid on</span><span class="font-semibold text-right">${new Date(s.paid_at).toLocaleString()}</span></div>` : ""}
    </div>
    ${pays ? `<div class="mt-3"><div class="text-xs font-semibold text-ink/45 mb-1">Payments</div>${pays}</div>` : ""}
    ${pending ? `
    <div class="border-t border-black/10 mt-4 pt-3">
      <div class="text-xs font-semibold text-ink/45 mb-2">Record a payment</div>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input id="cp-amount" type="number" inputmode="decimal" min="0" value="${s.outstanding_amount}" class="border border-black/10 rounded-xl px-3 py-2.5" />
        ${xMethodSelect("cp-method")}
      </div>
      ${xInput("cp-note", "Note (optional)")}
      <button id="cp-go" onclick="xRecordCreditPayment(${s.id})" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mt-2">Record payment</button>
      <div class="grid grid-cols-2 gap-2 mt-2">
        <button onclick="xRemindCredit(${s.id})" class="py-2.5 rounded-xl bg-primary-light text-primary-dark font-semibold text-sm">Remind on WhatsApp</button>
        <button onclick="xCancelCredit(${s.id})" class="py-2.5 rounded-xl bg-danger-light text-danger font-semibold text-sm">Cancel this sale</button>
      </div>
    </div>` : ""}
    <button onclick="closeModal('credit-detail-modal')" class="w-full mt-4 py-2.5 rounded-xl border border-black/10 font-semibold">Close</button>`;
  document.getElementById("credit-detail-modal").classList.remove("hidden");
}
async function xRecordCreditPayment(id) {
  const amount = Number(document.getElementById("cp-amount").value);
  if (!(amount > 0)) { toast("Enter the amount received"); return; }
  const btn = document.getElementById("cp-go"); btn.disabled = true;
  try {
    const r = await XApi.call("/api/x/credit-payment", { method: "POST", body: { credit_id: id, amount, method: document.getElementById("cp-method").value, note: document.getElementById("cp-note").value.trim() } });
    closeModal("credit-detail-modal");
    toast(r.settled ? "Fully paid. It now counts in your sales." : `Payment saved. ${formatMoney(r.outstanding)} still owed.`);
    render();
  } catch (e) { btn.disabled = false; toast(xNeedServer(e)); }
}
function xRemindCredit(id) {
  const s = lastRenderedCreditSales.find(x => x.id === id);
  if (!s) return;
  let phone = xDigits(s.customer_phone);
  if (!phone) {
    const typed = prompt(`Phone number for ${s.customer_name} (with country code or starting 0)`);
    if (!typed) return;
    phone = xDigits(typed);
    XApi.call("/api/x/customers", { method: "PUT", body: { name: s.customer_name, phone: typed } }).catch(() => {});
  }
  const shop = (shopSettings && shopSettings.business_name) || (currentShop && currentShop.shop_name) || "our shop";
  const text = `Hello ${s.customer_name}, this is ${shop}. A friendly reminder that you have ${formatMoney(s.outstanding_amount)} outstanding with us. Thank you.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}
async function xCancelCredit(id) {
  if (!confirm("Cancel this credit sale? The items go back to stock and any part payment must be given back to the customer.")) return;
  try {
    const r = await XApi.call("/api/x/credit-cancel", { method: "POST", body: { credit_id: id, restock: true } });
    closeModal("credit-detail-modal");
    toast(r.refunded > 0 ? `Cancelled. Give ${formatMoney(r.refunded)} back to the customer.` : "Credit sale cancelled. Stock is back.");
    render();
  } catch (e) { toast(xNeedServer(e)); }
}

// ---------------- owner settings cards ----------------
let xOwnerShops = [];
let xStaffList = [];
async function xLoadOwnerData() {
  try {
    const [roster, cfg, recovery] = await Promise.all([XApi.call("/api/x/staff"), XApi.call("/api/x/config"), xRecoveryCardHtml()]);
    const staff = Array.isArray(roster && roster.staff) ? roster.staff : null;
    const shops = Array.isArray(roster && roster.shops) ? roster.shops : null;
    if (!staff || !shops || !cfg || typeof cfg !== "object") {
      return { ready: false, error: "The server returned incomplete staff data. Deploy the latest Worker to enable staff and approvals." };
    }
    xOwnerShops = shops; xStaffList = staff;
    if (staff.length) XApi.call("/api/x/config", { method: "PUT", body: { avg_cost: cfg.avg_cost } }).catch(() => {});
    return { ready: true, staff, shops, cfg, recovery };
  } catch (e) { return { ready: false, error: xNeedServer(e) }; }
}
function xShopNames(ids) {
  return ids.map(id => (xOwnerShops.find(s => s.id === id) || {}).name).filter(Boolean).join(", ") || "No shop";
}
function xOwnerCardsHtml(d) {
  if (!d || !d.ready) {
    return `<div class="card p-4 mt-4"><h2 class="font-display font-bold mb-1">Staff and approvals</h2><p class="text-sm text-ink/50">${escapeHtml((d && d.error) || "Not available")}</p></div>${xSupportCardHtml()}`;
  }
  const many = d.shops.length > 1;
  return `
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Staff and approvals</h2>
      <p class="text-sm text-ink/50 mb-3">Add as many staff as you need, each with their own PIN. Staff can sell and take credit payments. They cannot see costs or profit, edit prices, delete, or change settings. Reversing a sale, adjusting stock and confirming a payment by hand need your owner PIN.</p>
      ${d.staff.length ? d.staff.map(s => `
        <div class="py-2.5 border-b border-black/5 last:border-0">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><div class="font-medium">${escapeHtml(s.name)}</div>
              <div class="text-xs ${s.active ? "text-primary" : "text-ink/40"}">${s.active ? "Active" : "Paused"}${many ? " · " + escapeHtml(xShopNames(s.shops)) : ""}</div></div>
          </div>
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${many ? `<button onclick="xStaffShops(${s.id})" class="text-xs bg-primary-light text-primary-dark font-semibold px-3 py-1.5 rounded-full">Shops</button>` : ""}
            <button onclick="xStaffReset(${s.id}, '${escapeHtml(s.name).replace(/'/g, "\\'")}')" class="text-xs bg-black/5 font-semibold px-3 py-1.5 rounded-full">New PIN</button>
            <button onclick="xStaffToggle(${s.id}, ${s.active ? 0 : 1})" class="text-xs bg-black/5 font-semibold px-3 py-1.5 rounded-full">${s.active ? "Pause" : "Resume"}</button>
            <button onclick="xStaffRemove(${s.id}, '${escapeHtml(s.name).replace(/'/g, "\\'")}')" class="text-xs bg-danger-light text-danger font-semibold px-3 py-1.5 rounded-full">Remove</button>
          </div>
        </div>`).join("") : `<p class="text-sm text-ink/40 mb-2">No staff yet.</p>`}
      <div class="space-y-2 mt-3">
        <input id="st-name" placeholder="Staff name" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
        ${xPinField("st-pin", "PIN, 4 to 6 digits")}
        ${many ? `<div class="text-xs font-semibold text-ink/45 pt-1">Which shops can this person work in?</div>${d.shops.map(s => `<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="st-shop" value="${s.id}" ${String(s.id) === String(activeShopId) ? "checked" : ""} style="width:18px;height:18px;accent-color:#0F6B4C" /><span>${escapeHtml(s.name)}</span></label>`).join("")}` : ""}
      </div>
      <button onclick="xStaffAdd()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mt-3">Add staff</button>
      <div class="border-t border-black/5 mt-4 pt-3">
        <div class="text-sm font-medium mb-1">Owner PIN ${d.cfg.has_owner_pin ? `<span class="text-xs text-primary">(set)</span>` : `<span class="text-xs text-danger">(not set)</span>`}</div>
        <p class="text-xs text-ink/45 mb-2">One PIN for all your shops. You type it on a staff phone to approve a reversal, a stock change or a payment confirmed by hand.</p>
        <button onclick="xSetOwnerPin()" class="w-full bg-black/5 font-semibold py-2.5 rounded-xl text-sm">${d.cfg.has_owner_pin ? "Change owner PIN" : "Set owner PIN"}</button>
      </div>
      <p class="text-xs text-ink/45 mt-3">Staff log in from the login page: tap Staff login, then enter your login email, their name and PIN.</p>
    </div>
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Profit and costs</h2>
      <label class="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" ${d.cfg.avg_cost ? "checked" : ""} onchange="xSetAvgCost(this.checked)" style="width:18px;height:18px;flex:none;margin-top:2px;accent-color:#0F6B4C" />
        <span>Work out the cost price automatically when I add stock (average cost). Turn this off if you want to type cost prices yourself.</span>
      </label>
      <p class="text-xs text-ink/45 mt-2">Add expenses under Sales, Expenses so your profit is after rent, transport and power.</p>
    </div>
    ${d.recovery || ""}
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Activity and backup</h2>
      <p class="text-sm text-ink/50 mb-3">See who did what, and keep a full copy of your data.</p>
      <div class="grid grid-cols-2 gap-2">
        <button onclick="xShowActivity()" class="bg-primary-light text-primary-dark font-semibold py-2.5 rounded-xl text-sm">Activity log</button>
        <button onclick="xDownloadBackup()" class="bg-primary text-white font-semibold py-2.5 rounded-xl text-sm">Full backup</button>
      </div>
      <button onclick="xRunDiagnostics()" class="w-full bg-black/5 font-semibold py-2.5 rounded-xl text-sm">Check app setup</button>
    </div>
    ${xSupportCardHtml()}`;
}
async function xStaffAdd() {
  const name = document.getElementById("st-name").value.trim(), pin = document.getElementById("st-pin").value.trim();
  if (!name) { toast("Enter the staff name"); return; }
  if (!/^\d{4,6}$/.test(pin)) { toast("The PIN must be 4 to 6 digits"); return; }
  const boxes = [...document.querySelectorAll(".st-shop")];
  const shops = boxes.length ? boxes.filter(b => b.checked).map(b => Number(b.value)) : [Number(activeShopId)];
  if (!shops.length) { toast("Pick at least one shop for this person"); return; }
  try { await XApi.call("/api/x/staff", { method: "POST", body: { name, pin, shops } }); toast(`${name} added`); render(); } catch (e) { toast(xNeedServer(e)); }
}
function xStaffShops(id) {
  const s = xStaffList.find(x => x.id === id);
  if (!s) return;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">Shops for ${escapeHtml(s.name)}</h2>
    <p class="text-sm text-ink/50 mb-3">Tick the shops this person can work in. Untick to withdraw them. It takes effect at once.</p>
    ${xOwnerShops.map(sh => `<label class="flex items-center gap-2 py-2 border-b border-black/5 cursor-pointer"><input type="checkbox" class="xs-shop" value="${sh.id}" ${s.shops.includes(sh.id) ? "checked" : ""} style="width:18px;height:18px;accent-color:#0F6B4C" /><span class="font-medium">${escapeHtml(sh.name)}</span></label>`).join("")}
    <div class="flex gap-2 mt-4">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button onclick="xStaffShopsSave(${id})" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Save</button>
    </div>`);
}
async function xStaffShopsSave(id) {
  const shops = [...document.querySelectorAll(".xs-shop")].filter(b => b.checked).map(b => Number(b.value));
  if (!shops.length) { toast("Pick at least one shop, or pause or remove this person"); return; }
  try { await XApi.call(`/api/x/staff/${id}`, { method: "PATCH", body: { shops } }); posCloseSheet(); toast("Shops updated"); render(); } catch (e) { toast(xNeedServer(e)); }
}
function xStaffReset(id, name) {
  xSecretSheet({ title: `New PIN for ${name}`, note: "4 to 6 digits.", placeholder: "New PIN", cta: "Change PIN", onSubmit: async pin => {
    if (!/^\d{4,6}$/.test(pin)) { toast("The PIN must be 4 to 6 digits"); return false; }
    await XApi.call(`/api/x/staff/${id}`, { method: "PATCH", body: { pin } }); toast("PIN changed");
  } });
}
async function xStaffToggle(id, active) {
  try { await XApi.call(`/api/x/staff/${id}`, { method: "PATCH", body: { active: !!active } }); render(); } catch (e) { toast(xNeedServer(e)); }
}
async function xStaffRemove(id, name) {
  if (!confirm(`Remove ${name}? They will not be able to log in, and anyone logged in as them is cut off at once.`)) return;
  try { await XApi.call(`/api/x/staff/${id}`, { method: "DELETE" }); toast("Removed"); render(); } catch (e) { toast(xNeedServer(e)); }
}
function xSetOwnerPin() {
  xSecretSheet({ title: "Owner PIN", note: "4 to 6 digits. One PIN for all your shops. Keep it private.", placeholder: "Owner PIN", cta: "Save PIN", onSubmit: async pin => {
    if (!/^\d{4,6}$/.test(pin)) { toast("The PIN must be 4 to 6 digits"); return false; }
    await XApi.call("/api/x/owner-pin", { method: "POST", body: { pin } }); toast("Owner PIN saved"); render();
  } });
}
async function xSetAvgCost(on) {
  try { await XApi.call("/api/x/config", { method: "PUT", body: { avg_cost: !!on } }); toast(on ? "Average cost is on" : "Average cost is off"); } catch (e) { toast(xNeedServer(e)); }
}
async function xShowActivity() {
  let rows = [];
  try { rows = await XApi.call("/api/x/audit"); } catch (e) { toast(xNeedServer(e)); return; }
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-2">Activity log</h2>
    <div style="max-height:55vh;overflow-y:auto">${rows.length ? rows.map(r => `
      <div class="py-2 border-b border-black/5 last:border-0 text-sm">
        <div class="flex justify-between gap-2"><span class="font-medium">${escapeHtml(r.action)}</span><span class="text-xs text-ink/45 flex-shrink-0">${new Date(r.at).toLocaleString()}</span></div>
        <div class="text-xs text-ink/50">${escapeHtml(r.actor || "")}${r.detail ? " · " + escapeHtml(r.detail) : ""}</div>
      </div>`).join("") : `<div class="text-center py-8 text-ink/40">Nothing yet.</div>`}</div>
    <button onclick="posCloseSheet()" class="w-full py-2.5 rounded-xl border border-black/10 font-semibold mt-3">Close</button>`);
}
async function xRunDiagnostics() {
  try {
    const result = await XApi.call("/api/x/health");
    const checks = result.external_readiness || {};
    const rows = [
      ["Core database", result.ok],
      ["Account signup and verification", checks.signup?.ready],
      ["Subscription billing keys", checks.subscription?.ready],
      ["AI service key", checks.ai?.ready],
      ["POS database", checks.point_of_sale?.database_ready],
      ["Delivery database", checks.delivery?.database_ready],
      ["Owner-driver delivery", checks.delivery?.owner_driver_available],
      ["Courier encryption key (courier only)", checks.delivery?.encryption_key_ready],
    ];
    const pos = checks.point_of_sale || {}, delivery = checks.delivery || {};
    pos.terminal_credentials_saved && rows.splice(5, 0, [`${pos.provider} terminal credentials`, true]);
    delivery.customer_requests_enabled && rows.splice(7, 0, ["Customer delivery requests enabled", true]);
    if (delivery.courier_credentials_saved) rows.push(["EasyPost credentials saved", delivery.courier_webhook_ready && delivery.courier_sender_address_ready]);
    posOpenSheet(`
      <h2 class="font-display text-xl font-extrabold mb-2">App setup check</h2>
      <p class="text-sm text-ink/50 mb-3">This checks configured keys and database setup. It does not make live provider charges or guarantee credentials are accepted by the provider.</p>
      <div style="max-height:55vh;overflow-y:auto">${rows.map(([label, ready]) => `<div class="py-2 border-b border-black/5 last:border-0 text-sm flex justify-between gap-3"><span>${escapeHtml(label)}</span><span class="font-semibold ${ready ? "text-primary" : "text-danger"}">${ready ? "Ready" : "Needs setup"}</span></div>`).join("")}${(result.missing_tables || []).map(table => `<div class="text-xs text-danger py-1">Missing database table: ${escapeHtml(table)}</div>`).join("")}</div>
      <button onclick="posCloseSheet()" class="w-full py-2.5 rounded-xl border border-black/10 font-semibold mt-3">Close</button>`);
  } catch (err) { toast(xNeedServer(err)); }
}
async function xDownloadBackup() {
  toast("Preparing your backup…");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    const res = await authFetch(`${API_BASE}/api/x/backup`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(res.status === 404 ? "Backup needs the server update. See DEPLOY.md, step 2." : e.error || `Backup failed (${res.status})`); }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `denquva-backup-${localDateStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Backup downloaded. Keep it somewhere safe.");
  } catch (e) { toast(xIsNetworkError(e) ? "No connection. Try again." : e.message); }
}

// ---------------- recovery codes ----------------
function xViewRecover() {
  return `
    <div class="max-w-sm mx-auto mt-10 md:mt-20">
      <div class="text-center mb-6">
        <h1 class="brand-row brand-row-center font-display text-3xl font-extrabold text-primary-dark"><img src="icons/icon-192.png" alt="" width="36" height="36" class="brand-logo brand-logo-lg" /><span>Denquva</span></h1>
        <p class="text-sm text-ink/50 mt-1">Reset your password with a recovery code</p>
      </div>
      <div class="card p-4 space-y-3">
        <input id="rc-email" type="email" inputmode="email" placeholder="Email" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
        <input id="rc-code" placeholder="Recovery code, like ABCDE-FGHJK" autocapitalize="characters" autocomplete="off" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
        ${passwordFieldHtml("rc-new", "New password")}
        ${passwordFieldHtml("rc-confirm", "Confirm new password")}
        <button id="rc-go" onclick="xSubmitRecover()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Update password</button>
        <button onclick="goAuth('forgot')" class="w-full text-xs text-ink/50 underline text-center">Use my security question instead</button>
        <button onclick="goAuth('login')" class="w-full text-xs text-ink/50 underline text-center">Back to log in</button>
      </div>
      <p class="text-xs text-ink/40 text-center mt-4">Each code works once. You make codes in Settings while logged in.</p>
    </div>`;
}
async function xSubmitRecover() {
  const email = document.getElementById("rc-email").value.trim();
  const code = document.getElementById("rc-code").value.trim();
  const next = document.getElementById("rc-new").value;
  const again = document.getElementById("rc-confirm").value;
  if (!email || !code || !next) { toast("Enter your email, a recovery code and a new password"); return; }
  if (next.length < 6) { toast("Password must be at least 6 characters"); return; }
  if (next !== again) { toast("The two passwords do not match"); return; }
  const btn = document.getElementById("rc-go"); btn.disabled = true; btn.textContent = "Updating…";
  try {
    const res = await fetch(`${API_BASE}/auth/reset-with-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, new_password: next }) });
    await apiJson(res);
    authMode = "login"; toast("Password updated, log in with your new password."); render();
  } catch (e) {
    toast(xIsNetworkError(e) ? "No connection. Try again." : (e.status === 404 ? "Recovery codes need the server update." : e.message));
    btn.disabled = false; btn.textContent = "Update password";
  }
}
async function xRecoveryCardHtml() {
  let remaining = null;
  try { remaining = (await XApi.call("/api/x/recovery-codes")).remaining; } catch {}
  return `
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Recovery codes</h2>
      <p class="text-sm text-ink/50 mb-3">Eight one time codes that let you reset your password if you forget it, even if you forget your security answer. Write them down and keep them away from your staff.${remaining !== null ? ` You have <b>${remaining}</b> unused.` : ""}</p>
      <button onclick="xMakeRecoveryCodes()" class="w-full bg-black/5 font-semibold py-2.5 rounded-xl text-sm">${remaining ? "Make new codes" : "Make recovery codes"}</button>
    </div>`;
}
function xMakeRecoveryCodes() {
  xSecretSheet({ title: "Make recovery codes", note: "Type your password. Old codes stop working.", placeholder: "Your password", numeric: false, cta: "Make codes", onSubmit: async pw => {
    const r = await XApi.call("/api/x/recovery-codes", { method: "POST", body: { current_password: pw } });
    setTimeout(() => posOpenSheet(`
      <h2 class="font-display text-xl font-extrabold mb-1">Your recovery codes</h2>
      <p class="text-sm text-danger mb-3">Write these down now. They are shown only once.</p>
      <div class="grid grid-cols-2 gap-2 font-mono text-center">${r.codes.map(c => `<div class="bg-black/5 rounded-lg py-2 text-sm font-semibold">${c}</div>`).join("")}</div>
      <button onclick="navigator.clipboard && navigator.clipboard.writeText('${r.codes.join(" ")}').then(() => toast('Copied'))" class="w-full py-2.5 rounded-xl bg-primary-light text-primary-dark font-semibold mt-3">Copy all</button>
      <button onclick="posCloseSheet(); render()" class="w-full py-2.5 rounded-xl border border-black/10 font-semibold mt-2">I wrote them down</button>`), 80);
  } });
}

// ---------------- reversed sales: search, date filter, show more and less ----------------
const XRV_STEP = 10;
let xRvRows = [];
let xRvQuery = "";
let xRvDate = "";
let xRvLimit = XRV_STEP;
function xRvDateText(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return [d.toLocaleDateString(), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
    d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }), d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), d.toLocaleDateString(undefined, { month: "long" })].join(" ").toLowerCase();
}
function xRvLocalDay(iso) {
  const d = new Date(iso); const p = n => String(n).padStart(2, "0");
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function xRvFiltered() {
  const tokens = xRvQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return xRvRows.filter(r => {
    if (xRvDate && xRvLocalDay(r.sold_at) !== xRvDate && xRvLocalDay(r.reversed_at) !== xRvDate) return false;
    if (!tokens.length) return true;
    const hay = `${r.product_name || ""} ${r.reason || ""} ${r.quantity} ${r.total_amount} ${xRvDateText(r.sold_at)} ${xRvDateText(r.reversed_at)}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
}
function xRvListHtml() {
  const rows = xRvFiltered();
  const shown = rows.slice(0, xRvLimit);
  const removed = rows.reduce((a, r) => a + Number(r.total_amount || 0), 0);
  const body = shown.length ? shown.map(r => `
    <div class="py-3 border-b border-black/5 last:border-0">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-medium">${escapeHtml(r.product_name || "Item")}</div>
          <div class="text-xs text-ink/45">${r.quantity} units · sold ${new Date(r.sold_at).toLocaleString()}</div>
          <div class="text-xs text-ink/45">Reversed ${new Date(r.reversed_at).toLocaleString()}${r.reason ? ` · ${escapeHtml(r.reason)}` : ""}</div>
        </div>
        <div class="text-right" style="flex-shrink:0">
          <div class="font-semibold text-danger">${formatMoney(r.total_amount)}</div>
          <div class="text-xs text-ink/45">${r.restocked ? "Stock put back" : "Stock not changed"}</div>
        </div>
      </div>
    </div>`).join("") : `<div class="text-center py-12 text-ink/40">${xRvRows.length ? "No reversed sale matches your search." : "No sales have been reversed."}</div>`;
  const left = rows.length - shown.length;
  const more = (left > 0 || xRvLimit > XRV_STEP) && rows.length > XRV_STEP ? `
    <div class="flex gap-2 pt-3">
      ${left > 0 ? `<button onclick="xRvMore()" class="flex-1 py-2.5 rounded-xl bg-primary-light text-primary-dark font-semibold text-sm">Show more (${Math.min(left, XRV_STEP)} of ${left} left)</button>` : ""}
      ${xRvLimit > XRV_STEP ? `<button onclick="xRvLess()" class="flex-1 py-2.5 rounded-xl bg-black/5 font-semibold text-sm">Show less</button>` : ""}
    </div>` : "";
  return `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div class="stat-card"><div class="text-xs text-ink/50">Sales reversed${xRvQuery || xRvDate ? " (matching)" : ""}</div><div class="font-display text-xl font-extrabold">${rows.length}</div></div>
      <div class="stat-card"><div class="text-xs text-ink/50">Money removed</div><div class="font-display text-xl font-extrabold">${formatMoney(removed)}</div></div>
    </div>
    <div class="card p-4">${body}${more}${rows.length > XRV_STEP ? `<div class="text-xs text-ink/40 text-center pt-3">Showing ${shown.length} of ${rows.length}</div>` : ""}</div>`;
}
function xRvRefresh() { const el = document.getElementById("xrv-list"); if (el) el.innerHTML = xRvListHtml(); }
function xRvSearch(v) { xRvQuery = v; xRvLimit = XRV_STEP; xRvRefresh(); }
function xRvDatePick(v) { xRvDate = v; xRvLimit = XRV_STEP; xRvRefresh(); const c = document.getElementById("xrv-clear"); if (c) c.style.display = v ? "" : "none"; }
function xRvClearDate() { xRvDate = ""; const i = document.getElementById("xrv-date"); if (i) i.value = ""; xRvDatePick(""); }
function xRvMore() { xRvLimit += XRV_STEP; xRvRefresh(); }
function xRvLess() { xRvLimit = XRV_STEP; xRvRefresh(); const el = document.getElementById("xrv-top"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }
async function xViewReversed() {
  let problem = "";
  try { xRvRows = await Api.getReversals("all"); } catch (err) { problem = err.message || "Could not load reversed sales"; xRvRows = []; }
  xRvLimit = XRV_STEP;
  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Sales</h1>
    <div class="flex gap-2 mb-4 flex-wrap">${salesTabsHtml()}</div>
    <div id="xrv-top"></div>
    ${problem ? `<div class="text-center py-12 text-danger">${escapeHtml(problem)}</div>` : `
    <div class="flex gap-2 mb-2">
      <input id="xrv-search" type="search" placeholder="Search product, reason, or date like 14 Oct" value="${escapeHtml(xRvQuery)}" oninput="xRvSearch(this.value)" class="flex-1 min-w-0 border border-black/10 rounded-xl px-3 py-2.5 bg-white" />
    </div>
    <div class="flex items-center gap-2 mb-3">
      <label class="text-xs text-ink/50">Day</label>
      <input id="xrv-date" type="date" value="${xRvDate}" onchange="xRvDatePick(this.value)" class="border border-black/10 rounded-xl px-3 py-2 bg-white" />
      <button id="xrv-clear" onclick="xRvClearDate()" style="${xRvDate ? "" : "display:none"}" class="text-xs text-primary underline">Clear day</button>
    </div>
    <p class="text-xs text-ink/45 mb-3">These sales are not counted in your revenue, profit or reports.</p>
    <div id="xrv-list">${xRvListHtml()}</div>`}`;
}

