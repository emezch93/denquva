function posEl(id) { return document.getElementById(id); }
function posVisible(id) { const e = posEl(id); return !!e && !e.classList.contains("hidden"); }
function posErr(err) { return (err && err.message) || "Something went wrong"; }
function posNowClock(ms) {
  return new Date(ms || Date.now()).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function posMethodLabel(m) {
  return { cash: "Cash", card: "Card POS", transfer: "Transfer", credit: "Credit" }[m] || m;
}

let posAudio = null;
function posBeep(good) {
  try {
    posAudio = posAudio || new (window.AudioContext || window.webkitAudioContext)();
    const o = posAudio.createOscillator();
    const g = posAudio.createGain();
    o.type = "sine";
    o.frequency.value = good ? 1100 : 220;
    g.gain.value = 0.08;
    o.connect(g); g.connect(posAudio.destination);
    o.start();
    o.stop(posAudio.currentTime + (good ? 0.09 : 0.28));
  } catch { /* sound is a bonus */ }
  if (!good && navigator.vibrate) navigator.vibrate(120);
}

// ---------------- API ----------------

const PosApi = {
  async integration() { return apiJson(await authFetch(`${API_BASE}/api/pos/integration`)); },
  async saveIntegration(body) {
    return apiJson(await authFetch(`${API_BASE}/api/pos/integration`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  },
  async test() { return apiJson(await authFetch(`${API_BASE}/api/pos/test`, { method: "POST" })); },
  async events() { return apiJson(await authFetch(`${API_BASE}/api/pos/events`)); },
  async create(body) {
    return apiJson(await authFetch(`${API_BASE}/api/pos/pending`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  },
  async get(id) { return apiJson(await authFetch(`${API_BASE}/api/pos/pending/${encodeURIComponent(id)}`)); },
  async list(status) { return apiJson(await authFetch(`${API_BASE}/api/pos/pending${status ? `?status=${status}` : ""}`)); },
  async act(id, action, body) {
    return apiJson(await authFetch(`${API_BASE}/api/pos/pending/${encodeURIComponent(id)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
    }));
  },
};

let posCfg = null;          // saved POS settings for the active shop
let posServerReady = true;  // false when the Worker has no POS routes yet
async function posLoadCfg(force) {
  if (posCfg && !force) return posCfg;
  try {
    posCfg = await PosApi.integration();
    posServerReady = true;
  } catch (err) {
    posCfg = null;
    if (err.status === 404 || err.status === 503) posServerReady = false;
  }
  return posCfg;
}

// ---------------- finding products by barcode ----------------

function posFindByCode(list, code) {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return null;
  let p = list.find(x => String(x.sku || "").trim().toLowerCase() === c);
  if (!p && /^\d+$/.test(c)) { // UPC A and EAN 13 differ only by a leading zero
    const stripped = c.replace(/^0+/, "");
    p = list.find(x => /^\d+$/.test(String(x.sku || "").trim()) && String(x.sku).trim().replace(/^0+/, "") === stripped);
  }
  return p || null;
}

// ---------------- scanner (USB or Bluetooth, acts like a keyboard) ----------------

let posBurst = { chars: "", times: [], el: null, startValue: null };

function posScanTarget() {
  if (posVisible("camera-modal") || posVisible("pos-modal")) return null;
  if (posVisible("multisale-modal")) return "multisale";
  if (posVisible("creditsale-modal")) return "creditsale";
  return null;
}

function posLooksLikeScan(times) {
  if (times.length < 3) return false;
  return (times[times.length - 1] - times[0]) / (times.length - 1) < 60;
}

document.addEventListener("keydown", (e) => {
  const target = posScanTarget();
  if (!target || e.ctrlKey || e.metaKey || e.altKey) return;
  const now = performance.now();

  if (e.key === "Enter") {
    const b = posBurst;
    posBurst = { chars: "", times: [], el: null, startValue: null };
    if (b.chars.length >= 3 && posLooksLikeScan(b.times)) {
      e.preventDefault();
      e.stopPropagation();
      // Put the search box back the way it was before the scanner typed in it.
      if (b.el && b.startValue !== null) {
        if (b.el.id === "multisale-search") multiSaleSearchTerm = b.startValue;
        else if (b.el.id === "creditsale-search") creditSaleSearchTerm = b.startValue;
        else if (b.el.isConnected && "value" in b.el) b.el.value = b.startValue;
      }
      posHandleScan(b.chars, target);
    }
    return;
  }

  if (e.key.length !== 1) return;
  const b = posBurst;
  if (b.times.length && now - b.times[b.times.length - 1] > 100) {
    b.chars = ""; b.times = []; b.el = null; b.startValue = null;
  }
  if (!b.chars.length) {
    b.el = document.activeElement;
    b.startValue = b.el && "value" in b.el ? b.el.value : null;
  }
  b.chars += e.key;
  b.times.push(now);
  if (b.chars.length >= 4 && posLooksLikeScan(b.times)) e.preventDefault(); // keep scanner digits out of the box
}, true);

function posHandleScan(code, target) {
  const list = target === "multisale" ? multiSaleProducts : creditSaleProducts;
  const cart = target === "multisale" ? multiSaleCart : creditSaleCart;
  const p = posFindByCode(list, code);
  if (!p) { posBeep(false); posQuickAdd(code, target); return; }
  if (p.quantity <= 0) { posBeep(false); toast(`${p.name} is out of stock`); return; }
  const before = cart.get(p.id) || 0;
  if (target === "multisale") addToMultiSaleCart(p.id); else addToCreditSaleCart(p.id);
  const after = (target === "multisale" ? multiSaleCart : creditSaleCart).get(p.id) || 0;
  if (after > before) { posBeep(true); toast(`${p.name} added`); } else posBeep(false);
}

// ---------------- camera scanning ----------------

LIB_URLS.zxing = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
let posCam = null;

function posCloseCamera() {
  if (posCam) {
    posCam.stopped = true;
    clearInterval(posCam.timer);
    try { posCam.reader && posCam.reader.reset(); } catch { /* already stopped */ }
    posCam.stream && posCam.stream.getTracks().forEach(t => t.stop());
    posCam = null;
  }
  const m = posEl("camera-modal");
  if (m) { m.classList.add("hidden"); m.innerHTML = ""; }
}

async function posOpenCamera(onCode, continuous) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("This browser cannot use the camera"); return; }
  const modal = posEl("camera-modal");
  modal.innerHTML = `
    <video id="pos-cam-video" class="pos-cam-video" playsinline muted></video>
    <div class="pos-cam-frame"></div>
    <div class="pos-cam-bar">
      <div id="pos-cam-note" class="pos-cam-note">Point at a barcode</div>
      <button onclick="posCloseCamera()" class="pos-cam-close">${continuous ? "Done" : "Close"}</button>
    </div>`;
  modal.classList.remove("hidden");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch {
    posCloseCamera();
    toast("Camera permission was blocked");
    return;
  }
  const video = posEl("pos-cam-video");
  video.srcObject = stream;
  await video.play().catch(() => {});
  const state = { stream, stopped: false, last: "", lastAt: 0, timer: null, reader: null };
  posCam = state;

  const emit = (text) => {
    const now = Date.now();
    if (!text || state.stopped || (text === state.last && now - state.lastAt < 2000)) return;
    state.last = text; state.lastAt = now;
    const note = posEl("pos-cam-note");
    if (note) note.textContent = text;
    onCode(text);
    if (!continuous) posCloseCamera();
  };

  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector();
      state.timer = setInterval(async () => {
        if (state.stopped || video.readyState < 2) return;
        try { const found = await detector.detect(video); if (found.length) emit(found[0].rawValue); } catch { /* next frame */ }
      }, 220);
      return;
    } catch { /* fall back to the library below */ }
  }
  try {
    await loadLib("zxing");
    const reader = new ZXing.BrowserMultiFormatReader();
    state.reader = reader;
    reader.decodeFromStream(stream, video, (result) => { if (result) emit(result.getText()); });
  } catch {
    posCloseCamera();
    toast("Camera scanning could not start. Use a scanner or type the code.");
  }
}

function posScanWithCamera() {
  const target = posVisible("multisale-modal") ? "multisale" : "creditsale";
  posOpenCamera((code) => posHandleScan(code, target), true);
}

function posScanIntoSku() {
  posOpenCamera((code) => {
    const box = posEl("pf-sku");
    if (box) { box.value = code; box.dispatchEvent(new Event("input", { bubbles: true })); }
    posBeep(true);
  }, false);
}

// ---------------- the shared bottom sheet ----------------

function posOpenSheet(html) {
  posEl("pos-modal-body").innerHTML = html;
  posEl("pos-modal").classList.remove("hidden");
}
function posCloseSheet() {
  posStopPoll();
  clearInterval(posCountdown);
  posEl("pos-modal").classList.add("hidden");
  posEl("pos-modal-body").innerHTML = "";
}

// ---------------- unknown barcode: quick add ----------------

function posQuickAdd(code, target) {
  const safe = escapeHtml(code);
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">New product</h2>
    <p class="text-sm text-ink/50 mb-4">Barcode <b>${safe}</b> is not in your products yet. Add it now and it goes straight into the cart.</p>
    <div class="space-y-3">
      <div class="flex gap-2">
        <input id="qa-name" placeholder="Product name" class="flex-1 min-w-0 border border-black/10 rounded-xl px-3 py-2.5" />
        <button type="button" onclick="posLookupName('${safe}')" class="text-xs bg-primary-light text-primary-dark font-semibold px-3 rounded-xl whitespace-nowrap">Find name</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input id="qa-price" type="number" inputmode="decimal" placeholder="Selling price" class="border border-black/10 rounded-xl px-3 py-2.5" />
        <input id="qa-cost" type="number" inputmode="decimal" placeholder="Cost price" class="border border-black/10 rounded-xl px-3 py-2.5" />
      </div>
      <input id="qa-qty" type="number" inputmode="numeric" placeholder="How many do you have in stock" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
    </div>
    <div class="flex gap-2 mt-5">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button id="qa-save" onclick="posSaveQuickAdd('${safe}', '${target}')" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Save and add</button>
    </div>`);
  setTimeout(() => { const n = posEl("qa-name"); if (n) n.focus(); }, 60);
}

async function posLookupName(code) {
  const btn = document.querySelector('#pos-modal-body button[onclick^="posLookupName"]');
  if (btn) { btn.disabled = true; btn.textContent = "Searching"; }
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,quantity`);
    const data = await res.json();
    const p = data && data.product;
    const name = p && p.product_name ? [String(p.brands || "").split(",")[0].trim(), p.product_name, p.quantity || ""].filter(Boolean).join(" ") : "";
    if (name) { posEl("qa-name").value = name; toast("Name found, check the price"); }
    else toast("No name found, type it in");
  } catch {
    toast("Could not search, type the name in");
  }
  if (btn) { btn.disabled = false; btn.textContent = "Find name"; }
}

async function posSaveQuickAdd(code, target) {
  const name = posEl("qa-name").value.trim();
  const price = parseFloat(posEl("qa-price").value);
  const cost = parseFloat(posEl("qa-cost").value) || 0;
  const qty = parseInt(posEl("qa-qty").value, 10);
  if (!name) { toast("Enter the product name"); return; }
  if (!(price > 0)) { toast("Enter the selling price"); return; }
  if (!(qty >= 1)) { toast("Enter how many you have in stock"); return; }
  const btn = posEl("qa-save");
  btn.disabled = true;
  try {
    await Api.createProduct({
      name, description: "", category: "", sku: code, selling_price: price, cost_price: cost, quantity: qty,
      low_stock_threshold: (shopSettings && shopSettings.default_low_stock_threshold) || 5,
    });
    const products = await Api.getProducts("");
    if (target === "multisale") multiSaleProducts = products; else creditSaleProducts = products;
    posCloseSheet();
    const p = posFindByCode(products, code);
    if (p) { if (target === "multisale") addToMultiSaleCart(p.id); else addToCreditSaleCart(p.id); }
    posBeep(true);
    toast(`${name} saved and added`);
  } catch (err) {
    btn.disabled = false;
    toast(posErr(err));
  }
}

// ---------------- charge: pick how the customer pays ----------------

function posCartSnapshot() {
  const items = [];
  let total = 0;
  multiSaleCart.forEach((qty, id) => {
    const p = multiSaleProducts.find(x => x.id === id);
    if (!p) return;
    items.push({ product_id: p.id, name: p.name, quantity: qty, unit_price: p.selling_price });
    total += p.selling_price * qty;
  });
  return { items, total, count: items.reduce((n, i) => n + i.quantity, 0) };
}

async function posOpenCharge() {
  const snap = posCartSnapshot();
  if (!snap.items.length) return;
  const cfg = await posLoadCfg(false);
  const terminals = cfg && cfg.provider !== "none" ? cfg.terminals || [] : [];
  const methodBtn = (id, label, hint, icon, off) => `
    <button onclick="posChoose('${id}')" ${off ? "disabled" : ""} class="pos-method ${off ? "is-off" : ""}">
      <span class="pos-method-icon">${icon}</span>
      <span class="pos-method-label">${label}</span>
      <span class="pos-method-hint">${hint}</span>
    </button>`;
  const connected = cfg && cfg.provider !== "none" && terminals.length;
  const providerName = cfg ? { moniepoint: "Moniepoint", opay: "OPay" }[cfg.provider] || "" : "";
  const icons = {
    cash: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`,
    card: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>`,
    transfer: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>`,
    credit: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  };
  posOpenSheet(`
    <div class="text-center mb-4">
      <div class="text-xs text-ink/45 font-semibold">${snap.count} item${snap.count === 1 ? "" : "s"}</div>
      <div class="font-display text-3xl font-extrabold">${formatMoney(snap.total)}</div>
    </div>
    <div class="pos-methods">
      ${methodBtn("cash", "Cash", "Done at once", icons.cash, false)}
      ${methodBtn("card", "Card POS", connected ? `Sent to ${providerName} terminal` : "Confirm when paid", icons.card, !posServerReady)}
      ${methodBtn("transfer", "Transfer", connected ? `Sent to ${providerName} terminal` : "Confirm when alert comes", icons.transfer, !posServerReady)}
      ${methodBtn("credit", "Credit", "Pay later", icons.credit, false)}
    </div>
    ${terminals.length > 1 ? `
    <label class="text-xs text-ink/50 block mt-3 mb-1">Which terminal</label>
    <select id="pos-terminal" class="w-full border border-black/10 rounded-xl px-3 py-2.5 bg-white">
      ${terminals.map(t => `<option value="${escapeHtml(t)}" ${t === localStorage.getItem("denquva_pos_terminal") ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
    </select>` : ""}
    ${!posServerReady ? `<p class="text-xs text-danger mt-3">Card and Transfer need the server update. Cash and Credit work now.</p>` : ""}
    <button onclick="posCloseSheet()" class="w-full py-2.5 rounded-xl border border-black/10 font-semibold mt-4">Back to cart</button>`);
}

function posChoose(method) {
  if (method === "cash") { posCloseSheet(); confirmMultiSale(); return; }
  if (method === "credit") { posMoveCartToCredit(); return; }
  posCreatePending(method);
}

async function posMoveCartToCredit() {
  const items = new Map(multiSaleCart);
  const products = multiSaleProducts;
  posCloseSheet();
  closeModal("multisale-modal");
  creditSaleCart = items;
  creditSaleProducts = products;
  creditSaleSearchTerm = "";
  creditSaleCustomerName = "";
  creditSaleDiscount = 0;
  renderCreditSaleModal();
  posEl("creditsale-modal").classList.remove("hidden");
}

// ---------------- card and transfer: pending sale and waiting screen ----------------

let posActive = null;       // the pending sale on screen
let posPollTimer = null;
let posCountdown = null;
let posConfirmArmed = 0;
const posFinalizing = new Set();
let posPendingCount = 0;

function posStopPoll() { clearInterval(posPollTimer); posPollTimer = null; }

async function posCreatePending(method) {
  const snap = posCartSnapshot();
  const select = posEl("pos-terminal");
  const terminal = select ? select.value : "";
  if (terminal) localStorage.setItem("denquva_pos_terminal", terminal);
  try {
    const p = await PosApi.create({ method, total: snap.total, items: snap.items, terminal_serial: terminal });
    localStorage.setItem("denquva_pos_enabled", "1");
    multiSaleCart = new Map();     // the basket now lives in the pending sale
    closeModal("multisale-modal");
    posRefreshPendingCount();
    posWaiting(p);
  } catch (err) {
    toast(posErr(err));
  }
}

function posWaitingHint(p) {
  const name = { moniepoint: "Moniepoint", opay: "OPay" }[p.provider] || "";
  if (p.provider !== "none") {
    if (p.push_note) return { warn: true, text: p.push_note };
    if (p.method === "transfer") return { warn: false, text: `Sent to ${name} terminal ${p.terminal_serial}. The customer picks transfer on the terminal.` };
    return { warn: false, text: p.provider === "moniepoint" ? `Sent to ${name} terminal ${p.terminal_serial}. The customer taps or inserts the card.` : `Sent to ${name} terminal ${p.terminal_serial}. The customer pays on the terminal.` };
  }
  return { warn: false, text: p.method === "card"
    ? "Charge the customer on your POS terminal. Tap Payment received when it goes through."
    : "Give the customer your account number. Tap Payment received when the alert arrives, or set up bank alerts in Settings so it confirms by itself." };
}

function posWaiting(p) {
  posActive = p;
  posConfirmArmed = 0;
  posRenderWaiting();
  posStopPoll();
  posPollTimer = setInterval(posPoll, 2500);
  clearInterval(posCountdown);
  posCountdown = setInterval(posTick, 1000);
}

function posRenderWaiting() {
  const p = posActive;
  if (!p) return;
  const hint = posWaitingHint(p);
  const expired = p.status === "expired";
  const armed = posConfirmArmed && Date.now() - posConfirmArmed < 4000;
  posOpenSheet(`
    <div class="text-center">
      <div class="text-xs text-ink/45 font-semibold">${posMethodLabel(p.method)}${p.terminal_serial ? ` · ${escapeHtml(p.terminal_serial)}` : ""}</div>
      <div class="font-display text-3xl font-extrabold mt-1">${formatMoney(p.total)}</div>
      <div class="pos-wait ${expired ? "is-expired" : ""}"><span class="pos-wait-dot"></span><span id="pos-wait-text">${expired ? "Hold ended" : "Waiting for payment"}</span><span id="pos-wait-time" class="pos-wait-time"></span></div>
    </div>
    <p class="text-sm mt-3 ${hint.warn ? "text-danger" : "text-ink/70"}">${escapeHtml(hint.text)}</p>
    ${expired ? `<p class="text-xs text-ink/45 mt-2">If the customer did pay, tap Payment received.</p>` : ""}
    <div class="text-xs text-ink/40 mt-3">${p.items.reduce((n, i) => n + i.quantity, 0)} items · ref ${escapeHtml(p.id)}</div>
    <div class="space-y-2 mt-5">
      <button onclick="posManualPaid()" class="w-full py-2.5 rounded-xl bg-primary text-white font-semibold">${armed ? "Tap again to confirm" : "Payment received"}</button>
      ${p.provider !== "none" ? `<button onclick="posResend()" class="w-full py-2.5 rounded-xl bg-primary-light text-primary-dark font-semibold">Send to terminal again</button>` : ""}
      <div class="flex gap-2">
        <button onclick="posHoldAndServeNext()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Serve next customer</button>
        <button onclick="posCancelPending()" class="flex-1 py-2.5 rounded-xl bg-danger-light text-danger font-semibold">Cancel sale</button>
      </div>
    </div>`);
  posTick();
}

function posTick() {
  const p = posActive;
  const t = posEl("pos-wait-time");
  if (!p || !t) return;
  const left = Math.max(0, Math.round((p.expires_at - Date.now()) / 1000));
  t.textContent = p.status === "pending" ? ` ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "";
}

async function posPoll() {
  if (!posActive || document.hidden) return;
  const id = posActive.id;
  try {
    const p = await PosApi.get(id);
    if (!posActive || posActive.id !== id) return;
    const changed = p.status !== posActive.status || p.push_note !== posActive.push_note;
    posActive = p;
    if (p.status === "paid") { posStopPoll(); posFinalize(p, false); return; }
    if (p.status === "recorded") { posStopPoll(); posCloseSheet(); toast("This sale was already recorded"); return; }
    if (p.status === "cancelled") { posStopPoll(); posCloseSheet(); toast("Sale cancelled"); return; }
    if (changed) posRenderWaiting();
  } catch { /* keep trying, the connection may be slow */ }
}

function posManualPaid() {
  if (!posActive) return;
  if (!(posConfirmArmed && Date.now() - posConfirmArmed < 4000)) {
    posConfirmArmed = Date.now();
    posRenderWaiting();
    setTimeout(() => { if (posActive) posRenderWaiting(); }, 4100);
    return;
  }
  posConfirmArmed = 0;
  PosApi.act(posActive.id, "confirm").then(p => { posStopPoll(); posFinalize(p, false); }).catch(err => toast(posErr(err)));
}

async function posResend() {
  if (!posActive) return;
  try {
    posActive = await PosApi.act(posActive.id, "repush");
    toast("Sent to the terminal again");
    posRenderWaiting();
  } catch (err) { toast(posErr(err)); }
}

async function posCancelPending() {
  if (!posActive) return;
  try {
    await PosApi.act(posActive.id, "cancel");
    posActive = null;
    posCloseSheet();
    posRefreshPendingCount();
    toast("Sale cancelled");
  } catch (err) { toast(posErr(err)); }
}

function posHoldAndServeNext() {
  posActive = null;
  posCloseSheet();
  posRefreshPendingCount();
  openMultiSaleModal();
}

// Records a paid sale in stock and sales using the app's normal batch sale.
async function posFinalize(p, quiet) {
  if (posFinalizing.has(p.id)) return;
  posFinalizing.add(p.id);
  try {
    try {
      await PosApi.act(p.id, "claim");
    } catch (err) {
      if (err.status === 409) return; // another screen is recording it
      throw err;
    }
    let result;
    try {
      result = await Api.sellBatch(p.items.map(i => ({ product_id: i.product_id, quantity: i.quantity })));
    } catch (err) {
      await PosApi.act(p.id, "release").catch(() => {});
      throw err;
    }
    const failed = (result.failed || []);
    await PosApi.act(p.id, "recorded", { note: failed.length ? `${failed.length} item(s) not recorded` : "" }).catch(() => {});
    if (posActive && posActive.id === p.id) posActive = null;
    posStopPoll();
    clearInterval(posCountdown);
    posRefreshPendingCount();
    if (quiet) {
      toast(`Recorded a paid sale of ${formatMoney(p.total)}`);
    } else {
      const sales = (result.succeeded || []).filter(x => x.sale_id).map(x => ({ id: x.sale_id, product_name: x.product_name, quantity: x.quantity, total_amount: x.total_amount }));
      posShowReceipt({ items: p.items, total: p.total, method: p.method, reference: p.id, failed, time: p.paid_at || Date.now(), sales });
    }
    render();
  } catch (err) {
    if (!quiet) toast(`Payment received, but recording failed: ${posErr(err)}. It will retry.`);
  } finally {
    posFinalizing.delete(p.id);
  }
}

// ---------------- held sales and recovery ----------------

async function posRefreshPendingCount() {
  if (!posServerReady || !localStorage.getItem("denquva_pos_enabled")) return;
  try {
    const r = await PosApi.list("");
    posPendingCount = (r.sales || []).length;
    if (posVisible("multisale-modal")) renderMultiSaleModal();
  } catch { /* the count is a convenience */ }
}

async function posShowPendingList() {
  let sales = [];
  try { sales = (await PosApi.list("")).sales || []; } catch (err) { toast(posErr(err)); return; }
  window.posListCache = sales;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-3">Awaiting payment</h2>
    ${sales.length ? sales.map((s, i) => `
      <button onclick="posResumePending(${i})" class="pos-held">
        <span><b>${formatMoney(s.total)}</b> · ${posMethodLabel(s.method)}</span>
        <span class="text-xs text-ink/45">${s.status === "pending" ? "Waiting" : "Paid, recording"} · ${posNowClock(s.created_at).split(",").pop().trim()}</span>
      </button>`).join("") : `<p class="text-sm text-ink/45 py-4 text-center">Nothing is waiting.</p>`}
    <button onclick="posCloseSheet()" class="w-full py-2.5 rounded-xl border border-black/10 font-semibold mt-3">Close</button>`);
}

function posResumePending(i) {
  const s = (window.posListCache || [])[i];
  if (!s) return;
  if (s.status === "paid" || s.status === "recording") { posCloseSheet(); posFinalize(s, false); return; }
  closeModal("multisale-modal");
  posWaiting(s);
}

let posRecovering = false;
async function posRecoverPaid() {
  if (posRecovering || !authToken || !posServerReady || !localStorage.getItem("denquva_pos_enabled")) return;
  posRecovering = true;
  try {
    const r = await PosApi.list("paid");
    for (const s of r.sales || []) {
      if (posActive && posActive.id === s.id) continue;
      await posFinalize(s, true);
    }
  } catch { /* try again on the next tick */ } finally { posRecovering = false; }
}

function posOnMultiSaleOpen() {
  posRefreshPendingCount();
  posRecoverPaid();
}

setInterval(() => { if (!document.hidden) posRecoverPaid(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) posRecoverPaid(); });
setTimeout(posRecoverPaid, 4000);

// ---------------- receipts ----------------

function posReceiptText(r) {
  const shop = (shopSettings && shopSettings.business_name) || (currentShop && currentShop.shop_name) || "Receipt";
  const lines = r.items.map(i => `${i.quantity} x ${i.name}  ${formatMoney(i.unit_price * i.quantity)}`);
  return [shop, posNowClock(r.time), "", ...lines, "", `Total: ${formatMoney(r.total)}`, `Paid by: ${posMethodLabel(r.method)}`, r.reference ? `Ref: ${r.reference}` : "", "", "Thank you."].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

function posReceiptHtml(r) {
  const shop = escapeHtml((shopSettings && shopSettings.business_name) || (currentShop && currentShop.shop_name) || "");
  return `
    <div class="pos-receipt">
      <div class="pos-r-shop">${shop}</div>
      <div class="pos-r-meta">${posNowClock(r.time)}</div>
      <div class="pos-r-rows">
        ${r.items.map(i => `<div class="pos-r-row"><span>${i.quantity} × ${escapeHtml(i.name)}</span><span>${formatMoney(i.unit_price * i.quantity)}</span></div>`).join("")}
      </div>
      <div class="pos-r-row pos-r-total"><span>Total</span><span>${formatMoney(r.total)}</span></div>
      <div class="pos-r-meta">Paid by ${posMethodLabel(r.method)}${r.reference ? ` · ${escapeHtml(r.reference)}` : ""}</div>
    </div>`;
}

let posLastReceipt = null;

function posShowReceipt(r) {
  posLastReceipt = r;
  const failed = (r.failed || []);
  posOpenSheet(`
    <div class="text-center mb-3">
      <div class="pos-tick">✓</div>
      <div class="font-display text-xl font-extrabold mt-2">Sale recorded</div>
    </div>
    ${failed.length ? `<p class="text-sm text-danger mb-3">Payment was taken but ${failed.length} item${failed.length === 1 ? "" : "s"} could not be taken from stock. Check stock and record ${failed.length === 1 ? "it" : "them"} again.</p>` : ""}
    ${posReceiptHtml(r)}
    <div class="grid grid-cols-2 gap-2 mt-4">
      <button onclick="posPrintReceipt()" class="py-2.5 rounded-xl border border-black/10 font-semibold">Print</button>
      <button onclick="posShareReceipt()" class="py-2.5 rounded-xl border border-black/10 font-semibold">WhatsApp</button>
    </div>
    <button onclick="posCloseSheet()" class="w-full py-2.5 rounded-xl bg-primary text-white font-semibold mt-2">Done</button>
    ${r.sales && r.sales.length ? `<button onclick="posReverseFromReceipt()" class="w-full mt-2 py-2 text-sm font-semibold text-danger">Sold the wrong item? Reverse this sale</button>` : ""}`);
}

function posPrintHtml(html) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open(); d.write(html); d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2500); }, 250);
}

function posPrintReceipt() {
  if (!posLastReceipt) return;
  const r = posLastReceipt;
  const shop = escapeHtml((shopSettings && shopSettings.business_name) || (currentShop && currentShop.shop_name) || "");
  posPrintHtml(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;font-size:12px;width:58mm;margin:0 auto;padding:4mm;color:#000}
    h1{font-size:14px;text-align:center;margin:0 0 2px}.m{text-align:center;color:#444;font-size:10px;margin-bottom:6px}
    .row{display:flex;justify-content:space-between;gap:6px;margin:2px 0}.t{border-top:1px dashed #000;margin-top:6px;padding-top:6px;font-weight:700}
  </style></head><body>
    <h1>${shop}</h1><div class="m">${posNowClock(r.time)}</div>
    ${r.items.map(i => `<div class="row"><span>${i.quantity} x ${escapeHtml(i.name)}</span><span>${formatMoney(i.unit_price * i.quantity)}</span></div>`).join("")}
    <div class="row t"><span>Total</span><span>${formatMoney(r.total)}</span></div>
    <div class="m" style="margin-top:6px">Paid by ${posMethodLabel(r.method)}${r.reference ? ` · ${escapeHtml(r.reference)}` : ""}</div>
    <div class="m">Thank you</div>
  </body></html>`);
}

function posShareReceipt() {
  if (!posLastReceipt) return;
  window.open(`https://wa.me/?text=${encodeURIComponent(posReceiptText(posLastReceipt))}`, "_blank", "noopener");
}

// Called by the cash path in confirmMultiSale after a successful sale.
function posAfterCashSale(snapshot, result) {
  const sold = new Map((result.succeeded || []).map(s => [s.product_id, s]));
  const items = snapshot.items.filter(i => sold.has(i.product_id)).map(i => ({ ...i, quantity: sold.get(i.product_id).quantity }));
  const total = items.reduce((n, i) => n + i.unit_price * i.quantity, 0);
  const sales = (result.succeeded || []).filter(x => x.sale_id).map(x => ({ id: x.sale_id, product_name: x.product_name, quantity: x.quantity, total_amount: x.total_amount }));
  posShowReceipt({ items, total, method: "cash", failed: result.failed || [], time: Date.now(), sales });
}

// ---------------- barcode labels (Code 128) ----------------

const POS_C128 = ["212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112"];

function posCode128Modules(text) {
  const codes = [104]; // start B
  let sum = 104;
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32;
    if (v < 0 || v > 94) throw new Error("Unsupported character in barcode");
    codes.push(v);
    sum += v * (i + 1);
  }
  codes.push(sum % 103, 106);
  return codes.map(c => POS_C128[c]).join("");
}

function posCode128Svg(text, height) {
  const widths = posCode128Modules(text);
  const quiet = 10;
  let x = quiet, bar = true, rects = "";
  for (const ch of widths) {
    const w = parseInt(ch, 10);
    if (bar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w; bar = !bar;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + quiet} ${height}" preserveAspectRatio="none" fill="#000">${rects}</svg>`;
}

let posLabelPick = new Set();

function posOpenLabels() {
  const list = typeof cachedProducts !== "undefined" ? cachedProducts : [];
  if (!list.length) { toast("Add products first"); return; }
  posLabelPick = new Set(list.filter(p => String(p.sku || "").trim()).map(p => p.id));
  posRenderLabels();
}

function posRenderLabels() {
  const list = cachedProducts;
  const missing = list.filter(p => !String(p.sku || "").trim()).length;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">Barcode labels</h2>
    <p class="text-sm text-ink/50 mb-3">Prints a barcode for each product. Your scanner reads it and finds the product by SKU.</p>
    ${missing ? `<button onclick="posAssignBarcodes()" class="w-full py-2.5 rounded-xl bg-primary-light text-primary-dark font-semibold mb-3">Create barcodes for ${missing} product${missing === 1 ? "" : "s"} without one</button>` : ""}
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs font-semibold text-ink/45">${posLabelPick.size} selected</span>
      <span><button onclick="posLabelAll(true)" class="text-xs font-semibold text-primary" style="margin-right:0.75rem">All</button><button onclick="posLabelAll(false)" class="text-xs font-semibold text-ink/50">None</button></span>
    </div>
    <div class="pos-label-list">
      ${list.map(p => {
        const has = String(p.sku || "").trim();
        return `<label class="pos-label-row ${has ? "" : "is-off"}"><input type="checkbox" ${posLabelPick.has(p.id) ? "checked" : ""} ${has ? "" : "disabled"} onchange="posLabelToggle(${p.id}, this.checked)" />
          <span class="min-w-0 flex-1"><span class="pos-clip">${escapeHtml(p.name)}</span><span class="pos-sub">${has ? escapeHtml(p.sku) : "No barcode yet"}</span></span></label>`;
      }).join("")}
    </div>
    <label class="text-xs text-ink/50 block mt-3 mb-1">Copies of each label</label>
    <input id="pos-label-copies" type="number" min="1" max="50" value="1" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
    <div class="flex gap-2 mt-4">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Close</button>
      <button onclick="posPrintLabels()" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Print labels</button>
    </div>`);
}

function posLabelToggle(id, on) { if (on) posLabelPick.add(id); else posLabelPick.delete(id); posRenderLabelsKeepScroll(); }
function posLabelAll(on) { posLabelPick = new Set(on ? cachedProducts.filter(p => String(p.sku || "").trim()).map(p => p.id) : []); posRenderLabelsKeepScroll(); }
function posRenderLabelsKeepScroll() {
  const box = document.querySelector(".pos-label-list");
  const top = box ? box.scrollTop : 0;
  const copies = posEl("pos-label-copies") ? posEl("pos-label-copies").value : "1";
  posRenderLabels();
  const nb = document.querySelector(".pos-label-list");
  if (nb) nb.scrollTop = top;
  if (posEl("pos-label-copies")) posEl("pos-label-copies").value = copies;
}

async function posAssignBarcodes() {
  const missing = cachedProducts.filter(p => !String(p.sku || "").trim());
  let next = 1;
  cachedProducts.forEach(p => { const m = /^DQ(\d+)$/.exec(String(p.sku || "").trim()); if (m) next = Math.max(next, parseInt(m[1], 10) + 1); });
  let done = 0;
  try {
    for (const p of missing) {
      const sku = "DQ" + String(next++).padStart(6, "0");
      await Api.updateProduct(p.id, {
        name: p.name, description: p.description || "", category: p.category || "", sku,
        selling_price: p.selling_price, cost_price: p.cost_price, low_stock_threshold: p.low_stock_threshold,
      });
      done++;
      toast(`Barcodes created ${done} of ${missing.length}`);
    }
  } catch (err) {
    toast(`Stopped after ${done}: ${posErr(err)}`);
  }
  cachedProducts = await Api.getProducts("");
  posLabelPick = new Set(cachedProducts.filter(p => String(p.sku || "").trim()).map(p => p.id));
  posRenderLabels();
  render();
}

function posPrintLabels() {
  const copies = Math.max(1, Math.min(50, parseInt(posEl("pos-label-copies").value, 10) || 1));
  const picks = cachedProducts.filter(p => posLabelPick.has(p.id));
  if (!picks.length) { toast("Select at least one product"); return; }
  let cells = "";
  try {
    for (const p of picks) {
      const sku = String(p.sku).trim();
      const svg = posCode128Svg(sku, 60);
      for (let i = 0; i < copies; i++) {
        cells += `<div class="l"><div class="n">${escapeHtml(p.name)}</div><div class="p">${formatMoney(p.selling_price)}</div><div class="b">${svg}</div><div class="c">${escapeHtml(sku)}</div></div>`;
      }
    }
  } catch (err) {
    toast(`${posErr(err)}. Use letters, numbers and basic symbols in the SKU.`);
    return;
  }
  posPrintHtml(`<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:8mm}body{font-family:Arial,sans-serif;margin:0}
    .g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
    .l{border:1px dotted #bbb;padding:2mm 3mm;text-align:center;break-inside:avoid}
    .n{font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.p{font-size:10px}
    .b{height:11mm;margin:1mm 0}.b svg{width:100%;height:100%}.c{font-size:9px;letter-spacing:1px}
  </style></head><body><div class="g">${cells}</div></body></html>`);
}

// ---------------- settings card ----------------

function posSettingsCardHtml(cfg) {
  if (!cfg) {
    return `<div class="card p-4 mt-4"><h2 class="font-display font-bold mb-1">POS and payments</h2>
      <p class="text-sm text-ink/50">Card and transfer payments need the server update. Follow DEPLOY.md, then come back here.</p></div>`;
  }
  const hook = p => `${API_BASE}/webhooks/${p}/${cfg.webhook_token}`;
  const field = (id, label, value, extra = "") => `<div><label class="text-xs text-ink/50">${label}</label>
    <input id="${id}" value="${escapeHtml(value || "")}" ${extra} class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" /></div>`;
  const secret = (id, label, saved) => field(id, label, "", `type="password" autocomplete="off" placeholder="${saved ? "Saved. Leave empty to keep it" : ""}"`);
  return `
    <div class="card p-4 mt-4 space-y-3" id="pos-settings">
      <div>
        <h2 class="font-display font-bold">POS and payments</h2>
        <p class="text-sm text-ink/50">Connect your Moniepoint or OPay terminal so card and transfer sales confirm by themselves. Cash and Credit always work.</p>
      </div>
      <div><label class="text-xs text-ink/50">Terminal provider</label>
        <select id="pos-provider" onchange="posProviderChanged()" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1 bg-white">
          <option value="none" ${cfg.provider === "none" ? "selected" : ""}>None (confirm by hand)</option>
          <option value="moniepoint" ${cfg.provider === "moniepoint" ? "selected" : ""}>Moniepoint</option>
          <option value="opay" ${cfg.provider === "opay" ? "selected" : ""}>OPay</option>
        </select></div>
      <div id="pos-terminals-box"><label class="text-xs text-ink/50">Terminal serial numbers (one per line)</label>
        <textarea id="pos-terminals" rows="2" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1">${escapeHtml((cfg.terminals || []).join("\n"))}</textarea></div>
      <div id="pos-box-moniepoint" class="space-y-3">
        ${secret("pos-mp-key", "Moniepoint API key", cfg.has_mp_api_key)}
        ${field("pos-mp-base", "Moniepoint address (leave as is unless told otherwise)", cfg.mp_base, `placeholder="https://api.pos.moniepoint.com"`)}
      </div>
      <div id="pos-box-opay" class="space-y-3">
        ${field("pos-op-head", "OPay Business ID", cfg.opay_head_id)}
        ${field("pos-op-branch", "OPay Branch ID", cfg.opay_branch_id)}
        ${secret("pos-op-client", "OPay client auth key", cfg.has_opay_client_key)}
        ${field("pos-op-scene", "OPay sub scene (OPay gives you this)", cfg.opay_sub_scene)}
        <div><label class="text-xs text-ink/50">Your private key ${cfg.has_opay_private_key ? "(saved, paste again only to replace)" : ""}</label>
          <textarea id="pos-op-priv" rows="3" autocomplete="off" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
        <div><label class="text-xs text-ink/50">OPay public key</label>
          <textarea id="pos-op-pub" rows="3" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" placeholder="-----BEGIN PUBLIC KEY-----">${escapeHtml(cfg.opay_public_key || "")}</textarea></div>
      </div>
      <div id="pos-hook-box" class="pos-hook">
        <div class="text-xs text-ink/50 mb-1">Webhook address. Paste it in your provider dashboard so payments confirm faster.</div>
        <div id="pos-hook-url" class="pos-hook-url" data-moniepoint="${escapeHtml(hook("moniepoint"))}" data-opay="${escapeHtml(hook("opay"))}"></div>
        <button onclick="posCopy(posEl('pos-hook-url').textContent)" class="text-xs font-semibold text-primary mt-1">Copy</button>
      </div>
      <div class="pos-hook">
        <div class="text-xs font-semibold mb-1">Bank transfer alerts</div>
        <div class="text-xs text-ink/50 mb-1">Confirms plain bank transfers by itself, with any bank. On the phone that gets your bank alert SMS, install an SMS forwarder app (for example MacroDroid or Tasker on Android). Make it send each incoming SMS to this address as an HTTP POST, with the message text in the body.</div>
        <div class="pos-hook-url">${escapeHtml(`${API_BASE}/webhooks/alert/${cfg.webhook_token}`)}</div>
        <button onclick="posCopy('${escapeHtml(`${API_BASE}/webhooks/alert/${cfg.webhook_token}`)}')" class="text-xs font-semibold text-primary mt-1">Copy</button>
        <div class="text-xs text-ink/40 mt-1">It only confirms when one open transfer sale has exactly the credited amount. Otherwise tap Payment received.</div>
      </div>
      ${cfg.email_domain ? `<div class="pos-hook">
        <div class="text-xs text-ink/50 mb-1">Bank alert email address. Forward your bank's credit alerts here so transfers confirm by themselves.</div>
        <div class="pos-hook-url">pos-${escapeHtml(cfg.webhook_token)}@${escapeHtml(cfg.email_domain)}</div>
        <button onclick="posCopy('pos-${escapeHtml(cfg.webhook_token)}@${escapeHtml(cfg.email_domain)}')" class="text-xs font-semibold text-primary mt-1">Copy</button>
      </div>` : ""}
      <div class="flex gap-2">
        <button onclick="posTestConnection()" class="flex-1 bg-primary-light text-primary-dark font-semibold py-2.5 rounded-xl">Test connection</button>
        <button onclick="posSaveSettings()" class="flex-1 bg-primary text-white font-semibold py-2.5 rounded-xl">Save</button>
      </div>
      <div id="pos-test-result" class="text-sm"></div>
      <div class="border-t border-black/5 pt-3">
        <div class="flex items-center justify-between mb-2"><h3 class="font-display font-bold text-sm">Recent payment activity</h3>
          <button onclick="posLoadEvents()" class="text-xs font-semibold text-primary">Refresh</button></div>
        <div id="pos-events" class="pos-events text-xs text-ink/70">Loading</div>
      </div>
    </div>`;
}

function posProviderChanged() {
  const v = posEl("pos-provider").value;
  posEl("pos-box-moniepoint").style.display = v === "moniepoint" ? "" : "none";
  posEl("pos-box-opay").style.display = v === "opay" ? "" : "none";
  posEl("pos-terminals-box").style.display = v === "none" ? "none" : "";
  const hook = posEl("pos-hook-box");
  hook.style.display = v === "none" ? "none" : "";
  if (v !== "none") posEl("pos-hook-url").textContent = posEl("pos-hook-url").dataset[v];
}

async function posLoadEvents() {
  const box = posEl("pos-events");
  if (!box) return;
  try {
    const r = await PosApi.events();
    box.innerHTML = r.events.length
      ? r.events.map(e => `<div><span class="text-ink/30">${posNowClock(e.created_at)}</span><br>${escapeHtml(e.summary)}${e.detail && (e.kind === "email" || e.kind === "alert") ? `<br><span class="text-ink/40">${escapeHtml(e.detail)}</span>` : ""}</div>`).join("")
      : "Nothing yet.";
  } catch (err) { box.textContent = posErr(err); }
}

function posSettingsReady() {
  if (!posEl("pos-settings")) return;
  posProviderChanged();
  posLoadEvents();
}

async function posSaveSettings() {
  const v = id => (posEl(id) ? posEl(id).value : "");
  try {
    posCfg = await PosApi.saveIntegration({
      provider: v("pos-provider"),
      terminals: v("pos-terminals").split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
      mp_api_key: v("pos-mp-key"), mp_base: v("pos-mp-base"),
      opay_head_id: v("pos-op-head"), opay_branch_id: v("pos-op-branch"), opay_client_key: v("pos-op-client"),
      opay_sub_scene: v("pos-op-scene"), opay_private_key: v("pos-op-priv"), opay_public_key: v("pos-op-pub"),
    });
    if (posCfg.provider !== "none") localStorage.setItem("denquva_pos_enabled", "1");
    toast("POS settings saved");
    render();
  } catch (err) { toast(posErr(err)); }
}

async function posTestConnection() {
  const out = posEl("pos-test-result");
  out.textContent = "Testing";
  try {
    const r = await PosApi.test();
    out.innerHTML = `<span class="${r.ok ? "text-primary-dark" : "text-danger"}">${escapeHtml(r.detail)}</span>`;
  } catch (err) { out.innerHTML = `<span class="text-danger">${escapeHtml(posErr(err))}</span>`; }
}

function posCopy(text) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Copied")).catch(() => toast("Select the text and copy it"));
}

// Fill in the settings card once the Settings screen has been drawn.
new MutationObserver(() => {
  const card = posEl("pos-settings");
  if (card && !card.dataset.ready) { card.dataset.ready = "1"; posSettingsReady(); }
}).observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
