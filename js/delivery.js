const DeliveryApi = {
  call(path, options = {}) {
    return XApi.call(path, options);
  },
  settings() { return this.call("/api/delivery/settings"); },
  saveSettings(body) { return this.call("/api/delivery/settings", { method: "PUT", body }); },
  orders() { return this.call("/api/delivery/orders"); },
  accept(orderId, deliveryMethod, driverStaffId) { return this.call("/api/delivery/orders/accept", { method: "POST", body: { order_id: orderId, delivery_method: deliveryMethod, driver_staff_id: driverStaffId || null } }); },
  status(orderId, status, paymentStatus = "unpaid", paymentMethod = "", detail = "") { return this.call("/api/delivery/orders/status", { method: "POST", body: { order_id: orderId, status, payment_status: paymentStatus, payment_method: paymentMethod, detail } }); },
  payment(orderId, paymentMethod) { return this.call("/api/delivery/orders/payment", { method: "POST", body: { order_id: orderId, payment_method: paymentMethod } }); },
  location(orderId, position) { return this.call(`/api/delivery/orders/${encodeURIComponent(orderId)}/location`, { method: "POST", body: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: position.coords.accuracy, captured_at: new Date(position.timestamp).toISOString() } }); },
  rates(orderId, body) { return this.call(`/api/delivery/orders/${encodeURIComponent(orderId)}/easypost/rates`, { method: "POST", body }); },
  buy(orderId, rateId) { return this.call(`/api/delivery/orders/${encodeURIComponent(orderId)}/easypost/buy`, { method: "POST", body: { rate_id: rateId, confirm_purchase: true } }); },
  connectEasyPost(apiKey) { return this.call("/api/delivery/easypost/connect", { method: "POST", body: { api_key: apiKey } }); },
};

const deliveryLocationWatches = new Map();
let deliveryState = { orders: [], settings: null, staff: [], error: "", rates: {} };
const deliveryStatusLabels = {
  requested: "New request", accepted: "Accepted", ready: "Ready for pickup", in_transit: "On the way",
  delivered: "Delivered", rejected: "Rejected", cancelled: "Cancelled", failed: "Delivery failed", returned: "Returned",
};
function deliveryEscape(value) { return escapeHtml(value == null ? "" : String(value)); }
function deliveryWhen(value) { const d = new Date(value); return isNaN(d.getTime()) ? "" : d.toLocaleString(); }
function deliveryActive(status) { return ["accepted", "ready", "in_transit"].includes(status); }
function deliveryMoney(value) { return formatMoney(Number(value) || 0); }
function deliveryCustomerUrl(settings) {
  const slug = String(settings?.public_slug || "").trim();
  if (!slug) return "";
  const url = new URL("delivery.html", window.location.href);
  url.search = "";
  url.searchParams.set("shop", slug);
  return url.href;
}

async function ViewDelivery() {
  deliveryState.error = "";
  try {
    const [orders, settings] = await Promise.all([DeliveryApi.orders(), DeliveryApi.settings()]);
    deliveryState.orders = Array.isArray(orders) ? orders : [];
    deliveryState.settings = settings;
    if (!isStaff()) {
      try { deliveryState.staff = (await XApi.call("/api/x/staff")).staff || []; } catch { deliveryState.staff = []; }
    }
  } catch (err) {
    deliveryState.error = err.message || "Could not load delivery requests.";
    return `<h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Deliveries</h1><div class="card p-5 text-danger">${deliveryEscape(deliveryState.error)}</div>`;
  }
  const s = deliveryState.settings;
  const customerUrl = deliveryCustomerUrl(s);
  const config = isStaff() ? "" : `
    <div class="card p-4 mb-4 space-y-3">
      <div><h2 class="font-display font-bold">Customer ordering link</h2><p class="text-sm text-ink/50">Share this link so customers can request delivery from this shop.</p></div>
      <div class="flex gap-2"><input id="delivery-public-link" readonly value="${deliveryEscape(customerUrl)}" placeholder="Refresh to generate a customer link" class="min-w-0 flex-1 border border-black/10 rounded-xl px-3 py-2.5 bg-black/5 text-sm" /><button onclick="deliveryCopyLink()" ${customerUrl ? "" : "disabled"} class="px-4 rounded-xl bg-primary text-white font-semibold">Copy</button></div>
      <label class="flex items-center gap-2 text-sm font-medium"><input id="delivery-enabled" type="checkbox" ${s.enabled ? "checked" : ""} /> Accept customer requests</label>
      <label class="block text-xs text-ink/50">Flat delivery fee (${deliveryEscape(shopSettings?.currency_code || "NGN")})<input id="delivery-fee" type="number" min="0" step="0.01" value="${Number(s.flat_delivery_fee || 0)}" class="mt-1 w-full border border-black/10 rounded-xl px-3 py-2.5 text-sm text-ink" /></label>
      <div class="border-t border-black/5 pt-3"><h3 class="font-semibold text-sm">Shop sender address (used for courier rates)</h3><p class="text-xs text-ink/50 mb-2">Use the country’s two-letter ISO code, such as NG, GB, or US.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input id="delivery-origin-name" placeholder="Contact name" value="${deliveryEscape(s.origin_address?.name || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm" />
          <input id="delivery-origin-phone" placeholder="Contact phone" value="${deliveryEscape(s.origin_address?.phone || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm" />
          <input id="delivery-origin-street" placeholder="Street address" value="${deliveryEscape(s.origin_address?.street1 || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm sm:col-span-2" />
          <input id="delivery-origin-street2" placeholder="Apartment, suite (optional)" value="${deliveryEscape(s.origin_address?.street2 || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm sm:col-span-2" />
          <input id="delivery-origin-city" placeholder="City / locality" value="${deliveryEscape(s.origin_address?.city || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm" />
          <input id="delivery-origin-state" placeholder="State / region (if used)" value="${deliveryEscape(s.origin_address?.state || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm" />
          <input id="delivery-origin-postal" placeholder="Postal code (if used)" value="${deliveryEscape(s.origin_address?.zip || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm" />
          <input id="delivery-origin-country" maxlength="2" placeholder="Country code, e.g. NG" value="${deliveryEscape(s.origin_address?.country || "")}" class="border border-black/10 rounded-xl px-3 py-2.5 text-sm uppercase" />
        </div>
      </div>
      <button onclick="deliverySaveSettings()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Save delivery settings</button>
    </div>
    <div class="card p-4 mb-4 space-y-3">
      <h2 class="font-display font-bold">Courier tracking and shipping</h2>
      <p class="text-sm text-ink/50">Connect your EasyPost account to get rates, purchase a shipping label, and receive verified tracking updates. Carrier availability depends on your EasyPost account and shipment countries.</p>
      ${s.easypost_connected ? `<p class="text-sm font-semibold text-primary">EasyPost connected${s.easypost_webhook_ready ? " · automatic tracking updates enabled" : " · webhook needs setup"}</p>` : `<input id="delivery-easypost-key" type="password" autocomplete="off" placeholder="EasyPost test or production API key" class="w-full border border-black/10 rounded-xl px-3 py-2.5" /><button onclick="deliveryConnectEasyPost()" class="w-full bg-black/5 font-semibold py-2.5 rounded-xl">Connect and verify EasyPost</button><p class="text-xs text-ink/40">The key is sent over HTTPS and stored encrypted by the Worker. Configure DELIVERY_ENCRYPTION_KEY before connecting.</p>`}
    </div>`;
  const error = deliveryState.error ? `<div class="rounded-xl bg-danger-light text-danger p-3 mb-3 text-sm">${deliveryEscape(deliveryState.error)}</div>` : "";
  const cards = deliveryState.orders.length ? deliveryState.orders.map(deliveryOrderCard).join("") : `<div class="text-center py-12 text-ink/40">No delivery requests yet.</div>`;
  return `<h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Deliveries</h1>${error}${config}<div class="flex items-center justify-between mb-3"><h2 class="font-display font-bold">Delivery requests</h2><button onclick="render()" class="text-sm text-primary underline">Refresh</button></div><div class="space-y-3">${cards}</div>`;
}

function deliveryOrderCard(order) {
  const address = [order.address_line1, order.address_line2, order.area, order.locality, order.region, order.postal_code, order.country_code].filter(Boolean).map(deliveryEscape).join(", ");
  const items = (order.items || []).map(item => `<div class="flex justify-between gap-3 text-sm"><span>${deliveryEscape(item.product_name)} × ${item.quantity}</span><span>${deliveryMoney(item.line_total)}</span></div>`).join("");
  const methods = !isStaff() && order.status === "requested" ? `
    <div class="grid sm:grid-cols-2 gap-2 mt-3"><select id="delivery-driver-${order.id}" class="border border-black/10 rounded-xl px-3 py-2.5 bg-white text-sm"><option value="">Owner will deliver</option>${deliveryState.staff.filter(s => s.active && (s.shops || []).map(String).includes(String(activeShopId))).map(s => `<option value="${s.id}">${deliveryEscape(s.name)}</option>`).join("")}</select>
    <button onclick="deliveryAccept('${order.id}','owner_driver')" class="rounded-xl bg-primary text-white font-semibold py-2.5">Accept · Own driver</button></div>
    <button onclick="deliveryAccept('${order.id}','courier')" class="w-full mt-2 rounded-xl bg-black/5 font-semibold py-2.5">Accept · Courier</button>
    <button onclick="deliveryChangeStatus('${order.id}','rejected')" class="w-full mt-2 text-sm text-danger underline">Reject request</button>` : "";
  const driverControls = order.delivery_method === "owner_driver" && deliveryActive(order.status) ? `
    ${order.status !== "in_transit" ? `<button onclick="deliveryStartSharing('${order.id}')" class="flex-1 rounded-xl bg-primary text-white font-semibold py-2.5">Start delivery & share location</button>` : `<button onclick="deliveryStartSharing('${order.id}')" class="flex-1 rounded-xl bg-primary-light text-primary-dark font-semibold py-2.5">Resume location sharing</button>`}
    <button onclick="deliveryStopSharing('${order.id}')" class="rounded-xl bg-black/5 px-4 font-semibold">Stop sharing</button>` : "";
  const courierControls = order.delivery_method === "courier" && deliveryActive(order.status) && !order.courier_tracking_code && !isStaff() ? `
    <div class="mt-3 border-t border-black/5 pt-3"><h3 class="font-semibold text-sm mb-2">Get carrier rates</h3><div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <input id="delivery-weight-${order.id}" type="number" min="0.01" step="0.01" placeholder="Weight kg" class="border border-black/10 rounded-lg px-2 py-2 text-sm" />
      <input id="delivery-length-${order.id}" type="number" min="0.01" step="0.01" placeholder="Length cm" class="border border-black/10 rounded-lg px-2 py-2 text-sm" />
      <input id="delivery-width-${order.id}" type="number" min="0.01" step="0.01" placeholder="Width cm" class="border border-black/10 rounded-lg px-2 py-2 text-sm" />
      <input id="delivery-height-${order.id}" type="number" min="0.01" step="0.01" placeholder="Height cm" class="border border-black/10 rounded-lg px-2 py-2 text-sm" /></div>
      <details class="mt-2"><summary class="text-xs text-primary cursor-pointer">International customs details (if required by carrier)</summary><textarea id="delivery-customs-${order.id}" rows="5" placeholder='Paste the EasyPost customs_info JSON required for this shipment. Do not certify customs details unless you have checked them.' class="mt-2 w-full border border-black/10 rounded-lg px-3 py-2 text-xs font-mono"></textarea></details>
      <button onclick="deliveryGetRates('${order.id}')" class="w-full mt-2 rounded-xl bg-primary text-white font-semibold py-2.5">Request live rates</button>
      ${deliveryRateList(order)}</div>` : "";
  const tracking = order.courier_tracking_code ? `<div class="rounded-lg bg-primary-light p-3 mt-3 text-sm"><div class="font-semibold">${deliveryEscape(order.courier_provider)} · ${deliveryEscape(order.courier_tracking_code)}</div>${order.courier_label_url ? `<a href="${deliveryEscape(order.courier_label_url)}" target="_blank" rel="noopener noreferrer" class="text-primary underline">Open shipping label</a>` : ""}</div>` : "";
  const deliveredControls = deliveryActive(order.status) ? `<div class="flex flex-wrap gap-2 mt-3">${driverControls}${order.status !== "in_transit" && order.delivery_method === "courier" ? `<button onclick="deliveryChangeStatus('${order.id}','in_transit')" class="flex-1 rounded-xl bg-black/5 font-semibold py-2.5">Mark picked up / in transit</button>` : ""}${order.status === "in_transit" ? `<select id="delivery-payment-${order.id}" class="border border-black/10 rounded-xl px-3 py-2 bg-white text-sm"><option value="unpaid">Payment not confirmed</option><option value="cash">Cash collected</option><option value="transfer">Transfer confirmed</option><option value="card">Card payment confirmed</option></select><button onclick="deliveryMarkDelivered('${order.id}')" class="w-full rounded-xl bg-primary-dark text-white font-semibold py-2.5">Confirm successful delivery</button>` : ""}${!isStaff() ? `<button onclick="deliveryChangeStatus('${order.id}','cancelled')" class="w-full text-sm text-danger underline">Cancel and release reserved stock</button>` : ""}</div>` : order.status === "delivered" && order.payment_status !== "paid" ? `<div class="flex gap-2 mt-3"><select id="delivery-payment-${order.id}" class="flex-1 border border-black/10 rounded-xl px-3 py-2 bg-white text-sm"><option value="">Payment not confirmed</option><option value="cash">Cash collected</option><option value="transfer">Transfer confirmed</option><option value="card">Card payment confirmed</option></select><button onclick="deliveryConfirmPayment('${order.id}')" class="rounded-xl bg-primary text-white font-semibold px-4 py-2">Record payment</button></div>` : "";
  const location = order.location ? `<div class="text-xs text-ink/50 mt-2">Driver location updated ${deliveryEscape(deliveryWhen(order.location.captured_at))} · ${Number(order.location.accuracy_m || 0).toFixed(0)}m accuracy</div>` : "";
  const events = (order.events || []).slice(0, 5).map(event => `<div class="text-xs text-ink/50">${deliveryEscape(deliveryWhen(event.created_at))} · ${deliveryEscape(deliveryStatusLabels[event.status] || event.status)}${event.detail ? ` — ${deliveryEscape(event.detail)}` : ""}</div>`).join("");
  return `<article class="card p-4"><div class="flex flex-wrap items-start justify-between gap-2"><div><div class="font-display font-bold">${deliveryEscape(order.customer_name)} · ${deliveryEscape(order.customer_phone)}</div><div class="text-xs text-ink/50 mt-1">${deliveryEscape(order.id.slice(0, 8).toUpperCase())} · ${deliveryEscape(deliveryWhen(order.created_at))}</div></div><span class="rounded-full bg-primary-light text-primary-dark px-3 py-1 text-xs font-semibold">${deliveryEscape(deliveryStatusLabels[order.status] || order.status)}</span></div><div class="text-sm text-ink/60 mt-2">${address}</div>${order.delivery_instructions ? `<div class="text-xs text-ink/50 mt-1">Instructions: ${deliveryEscape(order.delivery_instructions)}</div>` : ""}<div class="border-t border-black/5 mt-3 pt-3 space-y-1">${items}<div class="flex justify-between border-t border-black/5 pt-2 mt-2 font-semibold"><span>Order total</span><span>${deliveryEscape(order.currency_code)} ${deliveryMoney(order.total_amount)} · payment ${deliveryEscape(order.payment_status)}</span></div></div>${methods}${tracking}${courierControls}${deliveredControls}${location}${events ? `<details class="mt-3"><summary class="text-xs font-semibold cursor-pointer">Status history</summary><div class="mt-2 space-y-1">${events}</div></details>` : ""}</article>`;
}

function deliveryRateList(order) {
  const rates = deliveryState.rates[order.id] || [];
  if (!rates.length) return "";
  return `<div class="space-y-2 mt-3">${rates.map(rate => `<div class="flex items-center justify-between gap-2 rounded-xl bg-black/5 p-3 text-sm"><div><b>${deliveryEscape(rate.carrier)} ${deliveryEscape(rate.service)}</b><div class="text-xs text-ink/50">${rate.delivery_days ? `${rate.delivery_days} day(s) · ` : ""}${deliveryEscape(rate.currency)} ${deliveryEscape(rate.amount)}</div></div><button onclick="deliveryBuyLabel('${order.id}','${deliveryEscape(rate.id)}','${deliveryEscape(rate.carrier)}','${deliveryEscape(rate.service)}','${deliveryEscape(rate.currency)} ${deliveryEscape(rate.amount)}')" class="rounded-lg bg-primary text-white font-semibold px-3 py-2">Buy label</button></div>`).join("")}</div>`;
}

async function deliveryReload() { try { const [orders, settings] = await Promise.all([DeliveryApi.orders(), DeliveryApi.settings()]); deliveryState.orders = orders; deliveryState.settings = settings; render(); } catch (err) { toast(err.message || "Could not refresh deliveries"); } }
async function deliverySaveSettings() {
  try {
    const origin_address = { name: document.getElementById("delivery-origin-name").value, phone: document.getElementById("delivery-origin-phone").value, street1: document.getElementById("delivery-origin-street").value, street2: document.getElementById("delivery-origin-street2").value, city: document.getElementById("delivery-origin-city").value, state: document.getElementById("delivery-origin-state").value, zip: document.getElementById("delivery-origin-postal").value, country: document.getElementById("delivery-origin-country").value };
    deliveryState.settings = await DeliveryApi.saveSettings({ enabled: document.getElementById("delivery-enabled").checked, flat_delivery_fee: Number(document.getElementById("delivery-fee").value || 0), origin_address });
    toast("Delivery settings saved"); render();
  } catch (err) { toast(err.message || "Could not save delivery settings"); }
}
function deliveryCopyLink() { const input = document.getElementById("delivery-public-link"); if (input) navigator.clipboard?.writeText(input.value).then(() => toast("Customer link copied")).catch(() => { input.select(); document.execCommand("copy"); toast("Customer link copied"); }); }
async function deliveryConnectEasyPost() {
  const input = document.getElementById("delivery-easypost-key"), key = input?.value.trim();
  if (!key) { toast("Enter your EasyPost API key"); return; }
  try { await DeliveryApi.connectEasyPost(key); input.value = ""; toast("EasyPost connected and tracking webhook verified"); await deliveryReload(); }
  catch (err) { toast(err.message || "Could not connect EasyPost"); }
}
async function deliveryAccept(id, method) {
  const select = document.getElementById(`delivery-driver-${id}`);
  try { await DeliveryApi.accept(id, method, method === "owner_driver" ? select?.value : null); toast("Delivery request accepted"); await deliveryReload(); }
  catch (err) { toast(err.message || "Could not accept the request"); }
}
async function deliveryChangeStatus(id, status) {
  try { await DeliveryApi.status(id, status); toast(`Delivery ${deliveryStatusLabels[status]?.toLowerCase() || status}`); if (["cancelled", "failed", "returned", "delivered"].includes(status)) deliveryStopSharing(id); await deliveryReload(); }
  catch (err) { toast(err.message || "Could not update delivery"); }
}
async function deliveryMarkDelivered(id) {
  const choice = document.getElementById(`delivery-payment-${id}`)?.value || "unpaid";
  const paymentStatus = choice === "unpaid" ? "unpaid" : "paid";
  const paymentMethod = paymentStatus === "paid" ? choice : "";
  if (!confirm(paymentStatus === "paid" ? "Confirm delivery and that this payment was actually collected?" : "Confirm the customer received this order? This records the sale and reduces inventory.")) return;
  try { await DeliveryApi.status(id, "delivered", paymentStatus, paymentMethod); deliveryStopSharing(id); toast("Delivered; sale and stock updated"); await deliveryReload(); }
  catch (err) { toast(err.message || "Could not complete delivery"); }
}
async function deliveryConfirmPayment(id) {
  const method = document.getElementById(`delivery-payment-${id}`)?.value;
  if (!method) { toast("Choose the payment method that was actually collected"); return; }
  if (!confirm(`Confirm that ${method} payment was actually collected for this delivery?`)) return;
  try { await DeliveryApi.payment(id, method); toast("Delivery payment recorded"); await deliveryReload(); }
  catch (err) { toast(err.message || "Could not record delivery payment"); }
}
async function deliveryStartSharing(id) {
  if (!navigator.geolocation) { toast("This device does not provide location services"); return; }
  const order = deliveryState.orders.find(row => row.id === id);
  if (order && order.status !== "in_transit") {
    try { await DeliveryApi.status(id, "in_transit"); }
    catch (err) { toast(err.message || "Could not start delivery"); return; }
  }
  if (deliveryLocationWatches.has(id)) { toast("Location sharing is already active"); return; }
  toast("Allow location access to share your live delivery position");
  let lastSentAt = 0;
  const watchId = navigator.geolocation.watchPosition(async position => {
    if (Date.now() - lastSentAt < 15000) return;
    lastSentAt = Date.now();
    try { await DeliveryApi.location(id, position); } catch (err) { if (err.status !== 429) console.warn("Delivery location update failed", err); }
  }, error => toast(error.code === 1 ? "Location access was denied" : "Unable to read your current location"), { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  deliveryLocationWatches.set(id, watchId);
  await deliveryReload();
}
function deliveryStopSharing(id) { const watch = deliveryLocationWatches.get(id); if (watch != null) navigator.geolocation?.clearWatch(watch); deliveryLocationWatches.delete(id); }
async function deliveryGetRates(id) {
  try {
    let customs_info;
    const raw = document.getElementById(`delivery-customs-${id}`)?.value.trim();
    if (raw) { try { customs_info = JSON.parse(raw); } catch { toast("Customs information must be valid JSON"); return; } }
    const result = await DeliveryApi.rates(id, { weight_kg: document.getElementById(`delivery-weight-${id}`).value, length_cm: document.getElementById(`delivery-length-${id}`).value, width_cm: document.getElementById(`delivery-width-${id}`).value, height_cm: document.getElementById(`delivery-height-${id}`).value, customs_info });
    deliveryState.rates[id] = result.rates || []; toast(`${deliveryState.rates[id].length} carrier rate(s) received`); await deliveryReload();
  } catch (err) { toast(err.message || "Could not get live rates"); }
}
async function deliveryBuyLabel(id, rateId, carrier, service, price) {
  if (!confirm(`Purchase ${carrier} ${service} shipping label for ${price}? EasyPost may charge your account.`)) return;
  try { await DeliveryApi.buy(id, rateId); toast("Courier label purchased"); await deliveryReload(); }
  catch (err) { toast(err.message || "Could not purchase the shipping label"); }
}

window.addEventListener("beforeunload", () => { for (const [id] of deliveryLocationWatches) deliveryStopSharing(id); });


