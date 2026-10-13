const POS_DB_BINDING = "DB";
const POS_HOLD_MS = 10 * 60 * 1000;          // how long a pending sale is held
const POS_LATE_PAY_MS = 30 * 60 * 1000;      // late payments still accepted this long
const POS_CHECK_GAP_MS = 3000;               // never ask a provider more often than this
const POS_MONIEPOINT_BASE = "https://api.pos.moniepoint.com";
const POS_OPAY_BASE = "https://payapi.opayweb.com";
// Moniepoint takes amounts as whole numbers with a minimum of 100. That
// reads as kobo. Test once in sandbox: if the terminal shows 100 times
// too much, change this to false.
const POS_MONIEPOINT_AMOUNT_IN_KOBO = true;

// ---------- small helpers ----------

function posDb(env) { return env[POS_DB_BINDING]; }

function posJson(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Shop-Id",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    },
  });
}

function posBytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function posB64ToBytes(b64) {
  const s = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function posRandomHex(bytes) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

function posNewReference() {
  return ("DQ" + Date.now().toString(36) + posRandomHex(3)).toUpperCase();
}

// ---------- encrypting saved provider keys (AES GCM, key from JWT_SECRET) ----------

async function posAesKey(env) {
  const raw = new TextEncoder().encode("denquva-pos-keys:" + env.JWT_SECRET);
  const hash = await crypto.subtle.digest("SHA-256", raw);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function posEncrypt(env, text) {
  if (!text) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await posAesKey(env), new TextEncoder().encode(text)));
  return posBytesToB64(iv) + "." + posBytesToB64(ct);
}

async function posDecrypt(env, token) {
  if (!token) return "";
  const [iv, ct] = token.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: posB64ToBytes(iv) }, await posAesKey(env), posB64ToBytes(ct));
  return new TextDecoder().decode(plain);
}

// ---------- RSA (OPay needs RSA with PKCS1 v1.5, which WebCrypto cannot do) ----------

function posPemToDer(pem) {
  return posB64ToBytes(String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
}

function posDerRead(buf, pos) {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let off = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + i];
    off += n;
  }
  return { tag, start: off, end: off + len };
}

function posDerChildren(buf, start, end) {
  const out = [];
  let p = start;
  while (p < end) { const n = posDerRead(buf, p); out.push(n); p = n.end; }
  return out;
}

function posDerBig(buf, node) {
  let h = "";
  for (let i = node.start; i < node.end; i++) h += buf[i].toString(16).padStart(2, "0");
  return BigInt("0x" + (h || "0"));
}

function posParsePublicKey(pem) {
  const d = posPemToDer(pem);
  const top = posDerRead(d, 0);
  let kids = posDerChildren(d, top.start, top.end);
  if (kids[0].tag === 0x30) { // SubjectPublicKeyInfo wraps the real key in a BIT STRING
    const inner = posDerRead(d, kids[1].start + 1);
    kids = posDerChildren(d, inner.start, inner.end);
  }
  return { n: posDerBig(d, kids[0]), e: posDerBig(d, kids[1]) };
}

function posParsePrivateKey(pem) {
  const d = posPemToDer(pem);
  const top = posDerRead(d, 0);
  let kids = posDerChildren(d, top.start, top.end);
  if (kids.length >= 3 && kids[1].tag === 0x30 && kids[2].tag === 0x04) { // PKCS8 wraps PKCS1
    const inner = posDerRead(d, kids[2].start);
    kids = posDerChildren(d, inner.start, inner.end);
  }
  const g = i => posDerBig(d, kids[i]);
  return { n: g(1), e: g(2), d: g(3), p: g(4), q: g(5), dp: g(6), dq: g(7), qi: g(8) };
}

function posModPow(base, exp, mod) {
  let r = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return r;
}

function posBytesToBig(bytes) {
  let h = "";
  for (const b of bytes) h += b.toString(16).padStart(2, "0");
  return BigInt("0x" + (h || "0"));
}

function posBigToBytes(x, len) {
  let h = x.toString(16);
  if (h.length % 2) h = "0" + h;
  while (h.length < len * 2) h = "0" + h;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function posKeyBytes(n) { return (n.toString(16).length + 1) >> 1; }

function posRsaPrivateOp(key, c) { // uses the CRT shortcut so it stays fast
  const m1 = posModPow(c % key.p, key.dp, key.p);
  const m2 = posModPow(c % key.q, key.dq, key.q);
  let h = ((m1 - m2) * key.qi) % key.p;
  if (h < 0n) h += key.p;
  return m2 + h * key.q;
}

function posRsaEncrypt(pub, data) { // PKCS1 v1.5, split into blocks when long
  const k = posKeyBytes(pub.n);
  const max = k - 11;
  const out = [];
  for (let i = 0; i < data.length || i === 0; i += max) {
    const chunk = data.slice(i, i + max);
    const em = new Uint8Array(k);
    em[1] = 2;
    const padLen = k - chunk.length - 3;
    const pad = crypto.getRandomValues(new Uint8Array(padLen));
    for (let j = 0; j < padLen; j++) { while (pad[j] === 0) pad[j] = crypto.getRandomValues(new Uint8Array(1))[0]; em[2 + j] = pad[j]; }
    em[2 + padLen] = 0;
    em.set(chunk, 3 + padLen);
    out.push(posBigToBytes(posModPow(posBytesToBig(em), pub.e, pub.n), k));
  }
  const all = new Uint8Array(out.length * k);
  out.forEach((b, i) => all.set(b, i * k));
  return all;
}

function posRsaDecrypt(priv, data) {
  const k = posKeyBytes(priv.n);
  const parts = [];
  for (let i = 0; i < data.length; i += k) {
    const em = posBigToBytes(posRsaPrivateOp(priv, posBytesToBig(data.slice(i, i + k))), k);
    if (em[0] !== 0 || em[1] !== 2) throw new Error("RSA decrypt failed");
    let sep = 2;
    while (sep < em.length && em[sep] !== 0) sep++;
    parts.push(em.slice(sep + 1));
  }
  let total = 0;
  parts.forEach(p => { total += p.length; });
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach(p => { out.set(p, off); off += p.length; });
  return out;
}

const POS_SHA256_PREFIX = Uint8Array.from([0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20]);

async function posSignatureBlock(k, text) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const t = new Uint8Array(POS_SHA256_PREFIX.length + hash.length);
  t.set(POS_SHA256_PREFIX, 0);
  t.set(hash, POS_SHA256_PREFIX.length);
  const em = new Uint8Array(k);
  em[1] = 1;
  em.fill(0xff, 2, k - t.length - 1);
  em[k - t.length - 1] = 0;
  em.set(t, k - t.length);
  return em;
}

async function posRsaSign(priv, text) { // SHA256 with RSA, base64 out
  const k = posKeyBytes(priv.n);
  const em = await posSignatureBlock(k, text);
  return posBytesToB64(posBigToBytes(posRsaPrivateOp(priv, posBytesToBig(em)), k));
}

async function posRsaVerify(pub, text, sigB64) {
  const k = posKeyBytes(pub.n);
  const em = posBigToBytes(posModPow(posBytesToBig(posB64ToBytes(sigB64)), pub.e, pub.n), k);
  const want = await posSignatureBlock(k, text);
  if (em.length !== want.length) return false;
  for (let i = 0; i < em.length; i++) if (em[i] !== want[i]) return false;
  return true;
}

function posSortKeys(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = {};
    Object.keys(v).sort().forEach(k => { o[k] = posSortKeys(v[k]); });
    return o;
  }
  return v;
}

// ---------- integration settings ----------

async function posLoadCfg(env, shopId) {
  return posDb(env).prepare("SELECT * FROM pos_integrations WHERE shop_id = ?").bind(shopId).first();
}

async function posEnsureCfg(env, shopId) {
  let cfg = await posLoadCfg(env, shopId);
  if (!cfg) {
    await posDb(env).prepare("INSERT OR IGNORE INTO pos_integrations (shop_id, webhook_token, updated_at) VALUES (?, ?, ?)")
      .bind(shopId, posRandomHex(12), Date.now()).run();
    cfg = await posLoadCfg(env, shopId);
  }
  return cfg;
}

function posTerminals(cfg) {
  try { return JSON.parse(cfg.terminals || "[]"); } catch { return []; }
}

function posPublicCfg(env, cfg) {
  return {
    provider: cfg.provider,
    terminals: posTerminals(cfg),
    webhook_token: cfg.webhook_token,
    email_domain: env.POS_EMAIL_DOMAIN || "",
    mp_base: cfg.mp_base || "",
    has_mp_api_key: !!cfg.mp_api_key,
    opay_head_id: cfg.opay_head_id,
    opay_branch_id: cfg.opay_branch_id,
    opay_sub_scene: cfg.opay_sub_scene,
    has_opay_client_key: !!cfg.opay_client_key,
    has_opay_private_key: !!cfg.opay_private_key,
    opay_public_key: cfg.opay_public_key,
  };
}

async function posSaveCfg(env, shopId, body) {
  const cfg = await posEnsureCfg(env, shopId);
  const provider = ["none", "moniepoint", "opay"].includes(body.provider) ? body.provider : cfg.provider;
  const terminals = Array.isArray(body.terminals)
    ? [...new Set(body.terminals.map(t => String(t).trim()).filter(Boolean))].slice(0, 10)
    : posTerminals(cfg);
  const keep = (incoming, stored) => (typeof incoming === "string" && incoming.trim() ? incoming.trim() : stored);
  const mpKey = typeof body.mp_api_key === "string" && body.mp_api_key.trim() ? await posEncrypt(env, body.mp_api_key.trim()) : cfg.mp_api_key;
  const opayClient = typeof body.opay_client_key === "string" && body.opay_client_key.trim() ? await posEncrypt(env, body.opay_client_key.trim()) : cfg.opay_client_key;
  const opayPriv = typeof body.opay_private_key === "string" && body.opay_private_key.trim() ? await posEncrypt(env, body.opay_private_key.trim()) : cfg.opay_private_key;
  const base = typeof body.mp_base === "string" ? body.mp_base.trim().replace(/\/+$/, "") : cfg.mp_base;
  if (base && !/^https:\/\//.test(base)) throw new Error("The Moniepoint address must start with https://");
  if (typeof body.opay_public_key === "string" && body.opay_public_key.trim()) posParsePublicKey(body.opay_public_key);
  if (typeof body.opay_private_key === "string" && body.opay_private_key.trim()) posParsePrivateKey(body.opay_private_key);
  await posDb(env).prepare(
    `UPDATE pos_integrations SET provider=?, terminals=?, mp_api_key=?, mp_base=?, opay_head_id=?, opay_branch_id=?,
     opay_client_key=?, opay_sub_scene=?, opay_private_key=?, opay_public_key=?, updated_at=? WHERE shop_id=?`
  ).bind(
    provider, JSON.stringify(terminals), mpKey, base,
    keep(body.opay_head_id, cfg.opay_head_id), keep(body.opay_branch_id, cfg.opay_branch_id),
    opayClient, keep(body.opay_sub_scene, cfg.opay_sub_scene), opayPriv,
    keep(body.opay_public_key, cfg.opay_public_key), Date.now(), shopId
  ).run();
  return posLoadCfg(env, shopId);
}

// ---------- activity log ----------

async function posLogEvent(env, shopId, kind, summary, detail = "") {
  const db = posDb(env);
  await db.prepare("INSERT INTO payment_events (shop_id, kind, summary, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(shopId, kind, String(summary).slice(0, 300), String(detail).slice(0, 1500), Date.now()).run();
  await db.prepare("DELETE FROM payment_events WHERE shop_id = ? AND id NOT IN (SELECT id FROM payment_events WHERE shop_id = ? ORDER BY id DESC LIMIT 100)")
    .bind(shopId, shopId).run();
}

// ---------- Moniepoint ----------

async function posMpCall(env, cfg, path, options = {}) {
  const key = await posDecrypt(env, cfg.mp_api_key);
  if (!key) throw new Error("Moniepoint API key is not saved");
  const res = await fetch((cfg.mp_base || POS_MONIEPOINT_BASE) + path, {
    ...options,
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* some replies are empty */ }
  return { ok: res.ok, status: res.status, data };
}

async function posMpPush(env, cfg, pending, ref) {
  const amount = POS_MONIEPOINT_AMOUNT_IN_KOBO ? pending.total_kobo : Math.round(pending.total_kobo / 100);
  const r = await posMpCall(env, cfg, "/v1/transactions", {
    method: "POST",
    body: JSON.stringify({
      terminalSerial: pending.terminal_serial,
      amount,
      merchantReference: ref,
      transactionType: "PURCHASE",
      paymentMethod: pending.method === "card" ? "CARD_PURCHASE" : "POS_TRANSFER",
    }),
  });
  if (!r.ok) throw new Error("Moniepoint refused the request" + (r.data && r.data.message ? ": " + r.data.message : " (" + r.status + ")"));
}

async function posMpStatus(env, cfg, pending) {
  const r = await posMpCall(env, cfg, "/v1/transactions/merchants/" + encodeURIComponent(pending.provider_ref));
  if (r.status === 404) return { state: "pending" };
  if (!r.ok || !r.data) return { state: "pending", note: "Could not read Moniepoint status (" + r.status + ")" };
  const st = String(r.data.processingStatus || "").toUpperCase();
  if (["SUCCESSFUL", "COMPLETED"].includes(st)) {
    const paid = r.data.actualAmount != null ? Number(r.data.actualAmount) : Number(r.data.requestAmount);
    const paidKobo = POS_MONIEPOINT_AMOUNT_IN_KOBO ? paid : paid * 100;
    if (Number.isFinite(paidKobo) && paidKobo < pending.total_kobo) return { state: "mismatch", paidKobo };
    return { state: "paid" };
  }
  if (["FAILED", "REJECTED", "CANCELLED", "EXPIRED"].includes(st)) return { state: "failed", note: "Terminal says " + st };
  return { state: "pending" };
}

// ---------- OPay ----------

async function posOpayCall(env, cfg, path, params) {
  const priv = posParsePrivateKey(await posDecrypt(env, cfg.opay_private_key));
  const pub = posParsePublicKey(cfg.opay_public_key);
  const clientKey = await posDecrypt(env, cfg.opay_client_key);
  const ts = String(Date.now());
  const enc = posBytesToB64(posRsaEncrypt(pub, new TextEncoder().encode(JSON.stringify(posSortKeys(params)))));
  const sign = await posRsaSign(priv, enc + ts);
  const res = await fetch(POS_OPAY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", version: "V1.0.1", bodyFormat: "JSON", clientAuthKey: clientKey, timestamp: ts },
    body: JSON.stringify({ paramContent: enc, sign }),
  });
  const json = await res.json();
  if (json.code !== "00000") throw new Error("OPay: " + (json.message || json.code || res.status));
  let data = json.data;
  if (typeof data === "string") data = JSON.parse(new TextDecoder().decode(posRsaDecrypt(priv, posB64ToBytes(data))));
  return data;
}

async function posOpayPush(env, cfg, pending, ref) {
  await posOpayCall(env, cfg, "/openApi/order/checkout/createOrder", {
    headMerchantId: cfg.opay_head_id,
    merchantId: cfg.opay_branch_id,
    outOrderNo: ref,
    amount: (pending.total_kobo / 100).toFixed(2),
    currency: "NGN",
    orderExpireTime: Math.round(POS_HOLD_MS / 1000),
    sceneEnum: "CASH_API",
    subSceneEnum: cfg.opay_sub_scene,
    sn: pending.terminal_serial,
    isSplit: "N",
    remark: "Denquva " + ref,
  });
}

async function posOpayStatus(env, cfg, pending) {
  const d = await posOpayCall(env, cfg, "/openApi/order/checkout/qryOrderDetail", {
    headMerchantId: cfg.opay_head_id,
    merchantId: cfg.opay_branch_id,
    outOrderNo: pending.provider_ref,
  });
  const st = String(d.status || "").toUpperCase();
  if (st === "SUCCESS") {
    const paidKobo = Math.round(parseFloat(d.amount) * 100);
    if (Number.isFinite(paidKobo) && paidKobo < pending.total_kobo) return { state: "mismatch", paidKobo };
    return { state: "paid" };
  }
  if (["FAIL", "CLOSE"].includes(st)) return { state: "failed", note: "Terminal says " + st };
  return { state: "pending" };
}

// ---------- pending sales ----------

function posPendingOut(p) {
  let items = [];
  try { items = JSON.parse(p.items); } catch { /* keep empty */ }
  return {
    id: p.id, method: p.method, total: p.total_kobo / 100, items, status: p.status,
    terminal_serial: p.terminal_serial, provider: p.provider, push_note: p.push_note,
    source: p.source, created_at: p.created_at, expires_at: p.expires_at, paid_at: p.paid_at,
  };
}

async function posGetPending(env, shopId, id) {
  return posDb(env).prepare("SELECT * FROM pending_sales WHERE id = ? AND shop_id = ?").bind(id, shopId).first();
}

async function posMarkPaid(env, shopId, pending, source) {
  const r = await posDb(env).prepare(
    "UPDATE pending_sales SET status='paid', paid_at=?, source=? WHERE id=? AND shop_id=? AND status IN ('pending','expired')"
  ).bind(Date.now(), source, pending.id, shopId).run();
  const changed = r && r.meta ? r.meta.changes : 0;
  if (changed) await posLogEvent(env, shopId, "paid", "Payment confirmed (" + source + ") for " + (pending.total_kobo / 100).toFixed(2), pending.id);
  return !!changed;
}

// Asks the provider about one pending sale and moves it forward if paid.
async function posCheckPending(env, shopId, pending, cfg, force = false) {
  const now = Date.now();
  if (pending.status === "pending" && now > pending.expires_at) {
    await posDb(env).prepare("UPDATE pending_sales SET status='expired' WHERE id=? AND status='pending'").bind(pending.id).run();
    pending.status = "expired";
  }
  if (!["pending", "expired"].includes(pending.status)) return pending;
  if (pending.status === "expired" && now - pending.created_at > POS_LATE_PAY_MS) return pending;
  if (!cfg || pending.provider === "none" || cfg.provider !== pending.provider) return pending;
  if (!force && now - pending.last_check < POS_CHECK_GAP_MS) return pending;

  await posDb(env).prepare("UPDATE pending_sales SET last_check=? WHERE id=?").bind(now, pending.id).run();
  try {
    const result = pending.provider === "moniepoint" ? await posMpStatus(env, cfg, pending) : await posOpayStatus(env, cfg, pending);
    if (result.state === "paid") {
      await posMarkPaid(env, shopId, pending, pending.provider);
    } else if (result.state === "mismatch") {
      const note = "Terminal got " + (result.paidKobo / 100).toFixed(2) + " but the sale is " + (pending.total_kobo / 100).toFixed(2) + ". Not confirmed.";
      await posDb(env).prepare("UPDATE pending_sales SET push_note=? WHERE id=?").bind(note, pending.id).run();
      await posLogEvent(env, shopId, "mismatch", note, pending.id);
    } else if (result.state === "failed") {
      await posDb(env).prepare("UPDATE pending_sales SET push_note=? WHERE id=?").bind(result.note || "Payment failed", pending.id).run();
    }
  } catch (err) {
    await posDb(env).prepare("UPDATE pending_sales SET push_note=? WHERE id=?").bind(String(err.message || err).slice(0, 200), pending.id).run();
  }
  return posGetPending(env, shopId, pending.id);
}

async function posPushToTerminal(env, shopId, pending, cfg, ref) {
  if (pending.provider === "moniepoint") await posMpPush(env, cfg, pending, ref);
  else await posOpayPush(env, cfg, pending, ref);
  await posLogEvent(env, shopId, "push", "Sent " + (pending.total_kobo / 100).toFixed(2) + " to terminal " + pending.terminal_serial, ref);
}

async function posCreatePending(env, shopId, body) {
  const method = body.method === "transfer" ? "transfer" : body.method === "card" ? "card" : null;
  if (!method) throw new Error("Payment method must be card or transfer");
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 100) throw new Error("The cart is empty or too large");
  let sum = 0;
  const clean = items.map(i => {
    const quantity = parseInt(i.quantity, 10);
    const unit = Number(i.unit_price);
    if (!Number.isFinite(quantity) || quantity < 1 || !Number.isFinite(unit) || unit < 0) throw new Error("A cart item is not valid");
    sum += Math.round(unit * 100) * quantity;
    return { product_id: i.product_id, name: String(i.name || "").slice(0, 120), quantity, unit_price: unit };
  });
  if (Math.abs(sum - Math.round(Number(body.total) * 100)) > 1) throw new Error("The total does not match the items");
  if (sum < 100) throw new Error("The total is too small to charge");

  const cfg = await posEnsureCfg(env, shopId);
  const terminals = posTerminals(cfg);
  const wantsTerminal = cfg.provider !== "none" && terminals.length > 0;
  const serial = wantsTerminal ? (terminals.includes(body.terminal_serial) ? body.terminal_serial : terminals[0]) : "";
  const now = Date.now();
  const id = posNewReference();
  const pending = {
    id, shop_id: shopId, method, total_kobo: sum, items: JSON.stringify(clean), status: "pending",
    terminal_serial: serial, provider: wantsTerminal ? cfg.provider : "none", provider_ref: id, attempts: 1,
    push_note: "", source: "", created_at: now, expires_at: now + POS_HOLD_MS, last_check: 0,
  };
  await posDb(env).prepare(
    `INSERT INTO pending_sales (id, shop_id, method, total_kobo, items, status, terminal_serial, provider, provider_ref, attempts, push_note, source, created_at, expires_at, last_check)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, '', '', ?, ?, 0)`
  ).bind(id, shopId, method, sum, pending.items, serial, pending.provider, id, now, pending.expires_at).run();

  if (wantsTerminal) {
    try {
      await posPushToTerminal(env, shopId, pending, cfg, id);
    } catch (err) {
      const note = "Could not reach the terminal: " + String(err.message || err).slice(0, 160);
      await posDb(env).prepare("UPDATE pending_sales SET push_note=? WHERE id=?").bind(note, id).run();
      await posLogEvent(env, shopId, "error", note, id);
    }
  }
  return posGetPending(env, shopId, id);
}

async function posRepush(env, shopId, pending) {
  const cfg = await posLoadCfg(env, shopId);
  if (!cfg || pending.provider === "none" || cfg.provider !== pending.provider) throw new Error("No terminal is connected");
  const attempts = pending.attempts + 1;
  const ref = pending.id + "R" + attempts;
  await posPushToTerminal(env, shopId, pending, cfg, ref);
  await posDb(env).prepare("UPDATE pending_sales SET provider_ref=?, attempts=?, push_note='', expires_at=? WHERE id=?")
    .bind(ref, attempts, Date.now() + POS_HOLD_MS, pending.id).run();
}

// Checks every open card or transfer sale of one shop (used by webhooks).
async function posRecheckShop(env, shopId) {
  const cfg = await posLoadCfg(env, shopId);
  if (!cfg) return;
  const rows = await posDb(env).prepare(
    "SELECT * FROM pending_sales WHERE shop_id=? AND status IN ('pending','expired') AND created_at > ? AND provider != 'none' ORDER BY created_at DESC LIMIT 10"
  ).bind(shopId, Date.now() - POS_LATE_PAY_MS).all();
  for (const p of rows.results || []) await posCheckPending(env, shopId, p, cfg, true);
}

// ---------- API for the app (call with the logged in shop's id) ----------

async function posApi(request, env, ctx, url, shopId) {
  if (request.method === "OPTIONS") return posJson({}, 204);
  const parts = url.pathname.replace(/^\/api\/pos\/?/, "").split("/").filter(Boolean);
  const db = posDb(env);
  let body = {};
  if (request.method === "POST" || request.method === "PUT") {
    try { body = await request.json(); } catch { body = {}; }
  }

  try {
    if (parts[0] === "integration") {
      if (request.method === "PUT") return posJson(posPublicCfg(env, await posSaveCfg(env, shopId, body)));
      return posJson(posPublicCfg(env, await posEnsureCfg(env, shopId)));
    }

    if (parts[0] === "test" && request.method === "POST") {
      const cfg = await posEnsureCfg(env, shopId);
      if (cfg.provider === "moniepoint") {
        const r = await posMpCall(env, cfg, "/v1/introspect");
        if (!r.ok) return posJson({ ok: false, detail: "Moniepoint said no (" + r.status + "). Check the API key." });
        const names = (r.data.businesses || []).map(b => b.businessName).join(", ");
        return posJson({ ok: true, detail: "Connected" + (names ? " to " + names : "") + (r.data.environment ? " (" + r.data.environment + ")" : "") });
      }
      if (cfg.provider === "opay") {
        const priv = posParsePrivateKey(await posDecrypt(env, cfg.opay_private_key));
        const pub = posParsePublicKey(cfg.opay_public_key);
        const probe = new TextEncoder().encode("denquva");
        const back = posRsaDecrypt(priv, posRsaEncrypt({ n: priv.n, e: priv.e }, probe));
        if (new TextDecoder().decode(back) !== "denquva") throw new Error("Your private key did not pass the check");
        return posJson({ ok: true, detail: "Both keys read correctly (" + posKeyBytes(pub.n) * 8 + " bit OPay key). OPay itself is only contacted when you charge." });
      }
      return posJson({ ok: false, detail: "Choose Moniepoint or OPay first, then save." });
    }

    if (parts[0] === "events") {
      const rows = await db.prepare("SELECT kind, summary, detail, created_at FROM payment_events WHERE shop_id=? ORDER BY id DESC LIMIT 30").bind(shopId).all();
      return posJson({ events: rows.results || [] });
    }

    if (parts[0] === "pending") {
      const id = parts[1];
      const action = parts[2];

      if (!id && request.method === "POST") {
        const p = await posCreatePending(env, shopId, body);
        return posJson(posPendingOut(p), 201);
      }

      if (!id && request.method === "GET") {
        const filter = url.searchParams.get("status");
        const now = Date.now();
        await db.prepare("UPDATE pending_sales SET status='expired' WHERE shop_id=? AND status='pending' AND expires_at < ?").bind(shopId, now).run();
        let rows;
        if (filter === "paid") {
          rows = await db.prepare("SELECT * FROM pending_sales WHERE shop_id=? AND (status='paid' OR (status='recording' AND claimed_at < ?)) ORDER BY created_at LIMIT 20")
            .bind(shopId, now - 120000).all();
        } else {
          rows = await db.prepare("SELECT * FROM pending_sales WHERE shop_id=? AND status IN ('pending','paid','recording') ORDER BY created_at DESC LIMIT 30").bind(shopId).all();
        }
        return posJson({ sales: (rows.results || []).map(posPendingOut) });
      }

      const pending = await posGetPending(env, shopId, id);
      if (!pending) return posJson({ error: "Pending sale not found" }, 404);

      if (!action && request.method === "GET") {
        const cfg = await posLoadCfg(env, shopId);
        return posJson(posPendingOut(await posCheckPending(env, shopId, pending, cfg)));
      }

      if (action === "confirm" && request.method === "POST") {
        const ok = await posMarkPaid(env, shopId, pending, "manual");
        const fresh = await posGetPending(env, shopId, id);
        if (!ok && fresh.status === "cancelled") return posJson({ error: "This sale was cancelled" }, 409);
        return posJson(posPendingOut(fresh));
      }

      if (action === "cancel" && request.method === "POST") {
        const r = await db.prepare("UPDATE pending_sales SET status='cancelled' WHERE id=? AND shop_id=? AND status IN ('pending','expired')").bind(id, shopId).run();
        const fresh = await posGetPending(env, shopId, id);
        if (!(r.meta && r.meta.changes)) return posJson({ error: "This sale is already " + fresh.status }, 409);
        return posJson(posPendingOut(fresh));
      }

      if (action === "repush" && request.method === "POST") {
        if (!["pending", "expired"].includes(pending.status)) return posJson({ error: "This sale is already " + pending.status }, 409);
        await posRepush(env, shopId, pending);
        return posJson(posPendingOut(await posGetPending(env, shopId, id)));
      }

      if (action === "claim" && request.method === "POST") {
        const r = await db.prepare(
          "UPDATE pending_sales SET status='recording', claimed_at=? WHERE id=? AND shop_id=? AND (status='paid' OR (status='recording' AND claimed_at < ?))"
        ).bind(Date.now(), id, shopId, Date.now() - 120000).run();
        if (!(r.meta && r.meta.changes)) return posJson({ error: "Already being recorded" }, 409);
        return posJson(posPendingOut(await posGetPending(env, shopId, id)));
      }

      if (action === "release" && request.method === "POST") {
        await db.prepare("UPDATE pending_sales SET status='paid' WHERE id=? AND shop_id=? AND status='recording'").bind(id, shopId).run();
        return posJson({ ok: true });
      }

      if (action === "recorded" && request.method === "POST") {
        await db.prepare("UPDATE pending_sales SET status='recorded', recorded_at=?, push_note=? WHERE id=? AND shop_id=? AND status='recording'")
          .bind(Date.now(), body.note ? String(body.note).slice(0, 200) : "", id, shopId).run();
        return posJson({ ok: true });
      }
    }

    return posJson({ error: "Not found" }, 404);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/no such (table|column)/i.test(msg)) {
      console.error("POS tables are missing:", msg);
      return posJson({ error: "Payments are not set up on the server yet. Run migrations/pos.sql in D1." }, 503);
    }
    return posJson({ error: msg }, 400);
  }
}

// ---------- webhooks from Moniepoint and OPay (public, no login) ----------
// The webhook is only a nudge. We never trust what it says. We find the
// shop from the secret token in the URL, then ask the provider directly
// about that shop's open sales.

async function posPublic(request, env, ctx, url) {
  if (request.method === "OPTIONS") return posJson({}, 204);
  const parts = url.pathname.split("/").filter(Boolean); // webhooks, provider, token
  const token = parts[2] || "";
  if (!/^[a-f0-9]{24}$/.test(token)) return posJson({ error: "Not found" }, 404);
  let cfg;
  try {
    cfg = await posDb(env).prepare("SELECT shop_id FROM pos_integrations WHERE webhook_token = ?").bind(token).first();
  } catch (err) {
    console.error("POS webhook lookup failed:", err && err.message);
    return posJson({ error: "Not available" }, 503);
  }
  if (!cfg) return posJson({ error: "Not found" }, 404);
  const work = posRecheckShop(env, cfg.shop_id).catch((err) => console.error("POS recheck failed:", err && err.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  return posJson({ code: "00000", message: "SUCCESSFUL", received: true });
}

// ---------- bank alert emails (optional, needs Cloudflare Email Routing) ----------

function posQpDecode(text) {
  const joined = text.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.substr(i + 1, 2))) { bytes.push(parseInt(joined.substr(i + 1, 2), 16)); i += 2; }
    else bytes.push(joined.charCodeAt(i) & 0xff);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
}

function posEmailText(raw) {
  let text = raw;
  const b64 = /Content-Transfer-Encoding:\s*base64\s*\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/gi;
  let m;
  const decoded = [];
  while ((m = b64.exec(raw))) {
    try { decoded.push(new TextDecoder().decode(posB64ToBytes(m[1]))); } catch { /* skip bad part */ }
  }
  text = posQpDecode(raw) + "\n" + decoded.join("\n");
  return text.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

function posExtractAmounts(text) {
  const found = new Set();
  const money = /(?:NGN|NAIRA|₦|\bN)\s?([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
  const labelled = /amount[^0-9]{0,25}([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
  for (const re of [money, labelled]) {
    let m;
    while ((m = re.exec(text))) {
      // Skip account balances. Only the credited amount should count.
      const before = text.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
      if (/\b(bal|balance|avail|available|avl)\b/.test(before)) continue;
      const kobo = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
      if (Number.isFinite(kobo) && kobo >= 100) found.add(kobo);
    }
  }
  return [...found];
}

async function posHandleBankEmail(message, env, ctx) {
  const m = String(message.to || "").toLowerCase().match(/^pos-([a-f0-9]{24})@/);
  if (!m) return;
  const cfg = await posDb(env).prepare("SELECT shop_id FROM pos_integrations WHERE webhook_token = ?").bind(m[1]).first();
  if (!cfg) return;
  const shopId = cfg.shop_id;
  if (message.rawSize && message.rawSize > 600000) return;
  const raw = await new Response(message.raw).text();
  const subject = (message.headers && message.headers.get("subject")) || "";
  const text = posEmailText(raw);
  const looksLikeCredit = /\b(credit|credited|received|deposit|cr)\b/i.test(subject + " " + text) && !/\bdebit(ed)?\b/i.test(subject);
  const amounts = looksLikeCredit ? posExtractAmounts(text) : [];

  if (amounts.length) {
    const rows = await posDb(env).prepare(
      "SELECT * FROM pending_sales WHERE shop_id=? AND method='transfer' AND status IN ('pending','expired') AND created_at > ?"
    ).bind(shopId, Date.now() - POS_LATE_PAY_MS).all();
    // An old alert must never confirm a newer sale, so the alert has to be
    // sent after the sale was created (one minute of clock slack).
    const sentAt = Date.parse((message.headers && message.headers.get("date")) || "");
    const hits = (rows.results || []).filter(p =>
      amounts.includes(p.total_kobo) && (!Number.isFinite(sentAt) || sentAt >= p.created_at - 60000));
    if (hits.length === 1) {
      await posMarkPaid(env, shopId, hits[0], "email");
      return;
    }
    if (hits.length > 1) {
      await posLogEvent(env, shopId, "ambiguous", "Alert for " + (hits[0].total_kobo / 100).toFixed(2) + " matches " + hits.length + " open sales. Confirm one in the app.", subject);
      return;
    }
  }
  const snippet = text.replace(/\s+/g, " ").slice(0, 700);
  await posLogEvent(env, shopId, "email", looksLikeCredit ? "Alert received, no open transfer sale matched" : "Email received (not a credit alert)", subject + " | " + snippet);
}

// Call this from your delete account and delete shop code so the data goes too.
async function posDeleteShopData(env, shopId) {
  const db = posDb(env);
  await db.prepare("DELETE FROM pending_sales WHERE shop_id=?").bind(shopId).run();
  await db.prepare("DELETE FROM payment_events WHERE shop_id=?").bind(shopId).run();
  await db.prepare("DELETE FROM pos_integrations WHERE shop_id=?").bind(shopId).run();
}
