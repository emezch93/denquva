(() => {
  const API = "https://denquva-api.emezch93.workers.dev/api/public/delivery/";
  const root = document.getElementById("delivery-public-root");
  const query = new URLSearchParams(location.search);
  const slug = query.get("shop");
  const trackingToken = query.get("track");
  let shopData;
  let products = [];
  let cart = new Map();
  let turnstileWidget;

  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const money = (value, currency) => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0); }
    catch { return `${currency || ""} ${(Number(value) || 0).toFixed(2)}`; }
  };
  const api = async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not reach the shop. Please try again.");
    return body;
  };
  const sayError = error => { root.innerHTML = `<h1>Delivery</h1><p class="error">${escapeHtml(error.message || error)}</p><p class="muted">If this continues, contact the shop owner.</p>`; };

  function renderProducts() {
    const available = products.filter(product => product.available);
    root.innerHTML = `<h1 style="margin-top:0">${escapeHtml(shopData.name)}</h1>${shopData.description ? `<p class="muted">${escapeHtml(shopData.description)}</p>` : ""}<h2>Products</h2><div>${available.length ? available.map(product => `<div class="product"><img src="${escapeHtml(product.image_url || "icons/icon-192.png")}" alt="" loading="lazy" onerror="this.src='icons/icon-192.png'"><div class="product-info"><strong>${escapeHtml(product.name)}</strong><div class="muted">${escapeHtml(product.description || product.category || "")}</div><div>${money(product.price, shopData.currency_code)}</div></div><input class="quantity" aria-label="Quantity of ${escapeHtml(product.name)}" type="number" min="0" max="999" value="${cart.get(product.id) || 0}" onchange="DeliveryPublic.setQuantity(${Number(product.id)},this.value)"></div>`).join("") : `<p class="muted">No products are currently available.</p>`}</div><form id="delivery-request-form" class="grid" style="margin-top:20px"><h2 style="grid-column:1/-1;margin-bottom:0">Delivery details</h2><input name="customer_name" autocomplete="name" placeholder="Full name" required maxlength="100"><input name="customer_phone" autocomplete="tel" placeholder="Phone number (include country code)" required maxlength="40"><input name="customer_email" type="email" autocomplete="email" placeholder="Email (optional)" maxlength="160"><input name="country_code" placeholder="Country code, e.g. NG" required maxlength="2" pattern="[A-Za-z]{2}" autocapitalize="characters"><input name="region" placeholder="State / region" maxlength="100"><input name="locality" placeholder="City / town" maxlength="100"><input name="area" placeholder="Area / neighborhood" maxlength="100"><input name="postal_code" placeholder="Postal code (if used)" maxlength="32"><input name="address_line1" autocomplete="address-line1" placeholder="Street address" required maxlength="200"><input name="address_line2" autocomplete="address-line2" placeholder="Apartment, suite (optional)" maxlength="200"><textarea name="delivery_instructions" style="grid-column:1/-1" placeholder="Delivery instructions (optional)" maxlength="400"></textarea><div class="cf-turnstile" data-sitekey="0x4AAAAAAFS-OZp-MCP-4szJ" data-appearance="interaction-only"></div><div id="order-summary" style="grid-column:1/-1"></div><button id="delivery-submit" style="grid-column:1/-1" type="submit">Request delivery</button><p id="form-message" class="muted" style="grid-column:1/-1">Submitting a request does not charge you. The shop will confirm delivery availability.</p></form>`;
    updateSummary();
    document.getElementById("delivery-request-form").addEventListener("submit", submitOrder);
    renderTurnstile();
  }

  function renderTurnstile() {
    const target = document.querySelector("#delivery-request-form .cf-turnstile");
    if (!target || !window.turnstile || turnstileWidget) return;
    turnstileWidget = window.turnstile.render(target, {
      sitekey: "0x4AAAAAAFS-OZp-MCP-4szJ",
      appearance: "interaction-only",
      callback: token => { const field = document.querySelector("#delivery-request-form [name='turnstile_token']"); if (field) field.value = token; },
      "expired-callback": () => { const field = document.querySelector("#delivery-request-form [name='turnstile_token']"); if (field) field.value = ""; },
    });
    const field = document.createElement("input");
    field.type = "hidden"; field.name = "turnstile_token";
    document.getElementById("delivery-request-form").append(field);
  }

  function updateSummary() {
    const rows = [...cart.entries()].filter(([, quantity]) => quantity > 0).map(([id, quantity]) => {
      const product = products.find(item => Number(item.id) === Number(id));
      return product ? { product, quantity, total: Number(product.price) * quantity } : null;
    }).filter(Boolean);
    const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
    const fee = Number(shopData.delivery_fee || 0);
    const summary = document.getElementById("order-summary");
    if (!summary) return;
    summary.innerHTML = `<div class="card" style="padding:14px;background:#f7faf8"><strong>Order summary</strong>${rows.length ? rows.map(row => `<div style="display:flex;justify-content:space-between;margin-top:7px"><span>${escapeHtml(row.product.name)} × ${row.quantity}</span><span>${money(row.total, shopData.currency_code)}</span></div>`).join("") : `<p class="muted">Choose at least one product.</p>`}<div style="display:flex;justify-content:space-between;margin-top:10px"><span>Subtotal</span><span>${money(subtotal, shopData.currency_code)}</span></div><div style="display:flex;justify-content:space-between"><span>Delivery fee</span><span>${money(fee, shopData.currency_code)}</span></div><div style="display:flex;justify-content:space-between;font-weight:800"><span>Estimated total</span><span>${money(subtotal + fee, shopData.currency_code)}</span></div></div>`;
  }

  async function submitOrder(event) {
    event.preventDefault();
    const rows = [...cart.entries()].filter(([, quantity]) => quantity > 0).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
    const message = document.getElementById("form-message"), button = document.getElementById("delivery-submit");
    if (!rows.length) { message.textContent = "Choose at least one product before requesting delivery."; message.className = "error"; return; }
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    data.country_code = String(data.country_code || "").trim().toUpperCase();
    data.items = rows;
    data.turnstile_token = form.elements.turnstile_token?.value || "";
    button.disabled = true; message.textContent = "Sending your request securely…"; message.className = "muted";
    try {
      const result = await api(`${encodeURIComponent(slug)}/orders`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(data) });
      history.replaceState({}, "", `delivery.html?track=${encodeURIComponent(new URL(result.tracking_url).searchParams.get("track"))}`);
      await showTracking(new URL(result.tracking_url).searchParams.get("track"));
    } catch (error) {
      message.textContent = error.message || "Could not send your request."; message.className = "error";
      if (window.turnstile && turnstileWidget) window.turnstile.reset(turnstileWidget);
      button.disabled = false;
    }
  }

  async function showTracking(token) {
    const data = await api(`track/${encodeURIComponent(token)}`);
    const order = data.order;
    const locationBlock = order.location ? `<p class="muted">Last driver location update: ${escapeHtml(new Date(order.location.captured_at).toLocaleString())}. Accuracy about ${Math.round(order.location.accuracy_m || 0)} m.</p><iframe id="map" title="Approximate delivery location" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${order.location.longitude - 0.01}%2C${order.location.latitude - 0.01}%2C${order.location.longitude + 0.01}%2C${order.location.latitude + 0.01}&layer=mapnik&marker=${order.location.latitude}%2C${order.location.longitude}"></iframe><p class="muted">Map tiles are provided by OpenStreetMap. Location updates only while the driver shares location.</p>` : "";
    root.innerHTML = `<h1 style="margin-top:0">Track your delivery</h1><p class="muted">${escapeHtml(order.shop_name)} · Reference ${escapeHtml(order.reference)}</p><p>Status: <span class="status">${escapeHtml(order.status.replaceAll("_", " "))}</span></p><p class="muted">Order total: ${money(order.total, order.currency)} · Updated ${escapeHtml(new Date(order.updated_at).toLocaleString())}</p>${order.tracking_code ? `<p>Courier tracking: ${escapeHtml(order.tracking_code)} ${order.tracking_url ? `<a href="${escapeHtml(order.tracking_url)}" target="_blank" rel="noopener noreferrer">Carrier tracking</a>` : ""}</p>` : ""}${locationBlock}<p id="refresh-note" class="muted">Tracking refreshes automatically every 15 seconds. Keep this link private.</p><button type="button" onclick="DeliveryPublic.refreshTracking()">Refresh now</button>`;
  }

  async function refreshTracking() { try { await showTracking(trackingToken || new URLSearchParams(location.search).get("track")); } catch (error) { sayError(error); } }
  async function start() {
    if (trackingToken) { await showTracking(trackingToken); setInterval(refreshTracking, 15000); return; }
    if (!slug) throw new Error("This delivery link is missing its shop code. Ask the shop for the correct link.");
    const data = await api(encodeURIComponent(slug));
    shopData = data.shop; products = data.products || []; renderProducts();
  }

  window.DeliveryPublic = {
    setQuantity(id, value) { const quantity = Math.max(0, Math.min(999, Math.floor(Number(value) || 0))); cart.set(id, quantity); updateSummary(); },
    refreshTracking,
  };
  document.getElementById("delivery-turnstile-script")?.addEventListener("load", renderTurnstile);
  start().catch(sayError);
})();

