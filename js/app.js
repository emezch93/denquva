const API_BASE = "https://duka-api.emezch93.workers.dev";
const USE_SAMPLE_DATA = false;
const CURRENCIES = {
  NGN: { symbol: "₦", locale: "en-NG", name: "Nigerian Naira" },
  USD: { symbol: "$", locale: "en-US", name: "US Dollar" },
  GBP: { symbol: "£", locale: "en-GB", name: "British Pound" },
  EUR: { symbol: "€", locale: "de-DE", name: "Euro" },
  GHS: { symbol: "GH₵", locale: "en-GH", name: "Ghanaian Cedi" },
  KES: { symbol: "KSh", locale: "en-KE", name: "Kenyan Shilling" },
  ZAR: { symbol: "R", locale: "en-ZA", name: "South African Rand" },
  INR: { symbol: "₹", locale: "en-IN", name: "Indian Rupee" },
  XOF: { symbol: "CFA", locale: "fr-SN", name: "West African CFA Franc" },
  EGP: { symbol: "E£", locale: "ar-EG", name: "Egyptian Pound" },
  UGX: { symbol: "USh", locale: "en-UG", name: "Ugandan Shilling" },
  TZS: { symbol: "TSh", locale: "en-TZ", name: "Tanzanian Shilling" },
  CAD: { symbol: "CA$", locale: "en-CA", name: "Canadian Dollar" },
  AUD: { symbol: "AU$", locale: "en-AU", name: "Australian Dollar" },
  JPY: { symbol: "¥", locale: "ja-JP", name: "Japanese Yen" },
  CNY: { symbol: "¥", locale: "zh-CN", name: "Chinese Yuan" },
  BRL: { symbol: "R$", locale: "pt-BR", name: "Brazilian Real" },
  MXN: { symbol: "MX$", locale: "es-MX", name: "Mexican Peso" },
  AED: { symbol: "AED", locale: "ar-AE", name: "UAE Dirham" },
  PHP: { symbol: "₱", locale: "en-PH", name: "Philippine Peso" },
};

// Loaded once per session from this shop's saved settings.
let shopSettings = null;

// ---------------- AUTH STATE ----------------
// Duka is multi tenant: every shop owner logs in, and every API call
// below carries their token so the Worker knows whose data to touch.
let authToken = localStorage.getItem("duka_token") || null;
let currentShop = null; // { shop_name, email, subscription_status }

// Which shop this session is currently operating on. Defaults to the
// login's own shop, but a login that runs several shops can switch.
let activeShopId = localStorage.getItem("duka_active_shop_id") || null;

async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (activeShopId) headers["X-Shop-Id"] = activeShopId;
  return fetch(url, { ...options, headers });
}

function logout() {
  authToken = null;
  currentShop = null;
  shopSettings = null;
  activeShopId = null;
  localStorage.removeItem("duka_token");
  localStorage.removeItem("duka_active_shop_id");
  render();
}

function formatMoney(n) {
  const code = shopSettings?.currency_code || "NGN";
  const currency = CURRENCIES[code] || CURRENCIES.NGN;
  return currency.symbol + Number(n || 0).toLocaleString(currency.locale, { maximumFractionDigits: 0 });
}

// Resizes and compresses an uploaded image before it's stored as a
// base64 string. Keeps rows in D1 small instead of needing separate
// file storage, which this project's stack intentionally avoids.
function compressImageToDataUrl(file, maxW = 400, maxH = 400, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------- SAMPLE DATA (clearly labeled, replaced by real data later) ----------------
let sampleProducts = [
  { id: 1, name: "Coca Cola", description: "50cl Coca Cola soft drink", category: "Drinks", sku: "COKE50", selling_price: 700, cost_price: 500, quantity: 31, low_stock_threshold: 10 },
  { id: 2, name: "Peak Milk", description: "Peak evaporated milk tin", category: "Groceries", sku: "PEAK170", selling_price: 950, cost_price: 800, quantity: 8, low_stock_threshold: 10 },
  { id: 3, name: "Dettol Soap", description: "Dettol antiseptic soap", category: "Toiletries", sku: "DETSOAP", selling_price: 600, cost_price: 420, quantity: 4, low_stock_threshold: 6 },
  { id: 4, name: "Indomie Pack", description: "Indomie noodles, pack of 40", category: "Groceries", sku: "INDO40", selling_price: 8500, cost_price: 7200, quantity: 15, low_stock_threshold: 5 },
];
let sampleSales = [
  { id: 1, product_id: 1, product_name: "Coca Cola", quantity: 3, unit_price: 700, unit_cost: 500, total_amount: 2100, estimated_profit: 600, sold_at: new Date().toISOString() },
];
let nextProductId = 5;
let nextSaleId = 2;
let sampleSettings = {
  business_name: "My Shop",
  business_description: "",
  currency_symbol: "₦",
  currency_code: "NGN",
  default_low_stock_threshold: 5,
  logo_url: "",
};

// Every real API call goes through this so a failed request always
// throws, instead of the UI quietly treating an error response as
// if it had succeeded.
async function apiJson(res) {
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------------- API LAYER ----------------
// Every screen calls these functions. Swap USE_SAMPLE_DATA to
// false once your Worker is live, and nothing else needs to change.

const Api = {
  async getProducts(search = "") {
    if (USE_SAMPLE_DATA) {
      const term = search.toLowerCase();
      return sampleProducts.filter(p =>
        !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.category.toLowerCase().includes(term)
      );
    }
    const res = await authFetch(`${API_BASE}/api/products?search=${encodeURIComponent(search)}`);
    return apiJson(res);
  },

  async createProduct(data) {
    if (USE_SAMPLE_DATA) {
      const product = { id: nextProductId++, ...data };
      sampleProducts.push(product);
      return product;
    }
    const res = await authFetch(`${API_BASE}/api/products`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    return apiJson(res);
  },

  async updateProduct(id, data) {
    if (USE_SAMPLE_DATA) {
      const p = sampleProducts.find(p => p.id === id);
      Object.assign(p, data);
      return p;
    }
    const res = await authFetch(`${API_BASE}/api/products/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    return apiJson(res);
  },

  async deleteProduct(id) {
    if (USE_SAMPLE_DATA) {
      sampleProducts = sampleProducts.filter(p => p.id !== id);
      return { success: true };
    }
    const res = await authFetch(`${API_BASE}/api/products/${id}`, { method: "DELETE" });
    return apiJson(res);
  },

  async sell(productId, quantity) {
    if (USE_SAMPLE_DATA) {
      const p = sampleProducts.find(p => p.id === productId);
      if (!p) throw new Error("Product not found");
      if (p.quantity < quantity) throw new Error(`Only ${p.quantity} units are available.`);
      p.quantity -= quantity;
      const totalAmount = p.selling_price * quantity;
      const estimatedProfit = (p.selling_price - p.cost_price) * quantity;
      sampleSales.unshift({
        id: nextSaleId++, product_id: p.id, product_name: p.name, quantity,
        unit_price: p.selling_price, unit_cost: p.cost_price,
        total_amount: totalAmount, estimated_profit: estimatedProfit, sold_at: new Date().toISOString(),
      });
      return { success: true, new_quantity: p.quantity, total_amount: totalAmount, estimated_profit: estimatedProfit };
    }
    const res = await authFetch(`${API_BASE}/api/sales`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, quantity }),
    });
    return apiJson(res);
  },

  async addStock(productId, quantity, costPerUnit, supplier, note) {
    if (USE_SAMPLE_DATA) {
      const p = sampleProducts.find(p => p.id === productId);
      p.quantity += quantity;
      return { success: true, new_quantity: p.quantity };
    }
    const res = await authFetch(`${API_BASE}/api/stock-movements`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, quantity, cost_per_unit: costPerUnit, supplier, note }),
    });
    return apiJson(res);
  },

  async getSales(range = "") {
    if (USE_SAMPLE_DATA) {
      if (!range || range === "all") return sampleSales;
      const now = new Date();
      return sampleSales.filter(s => {
        const d = new Date(s.sold_at);
        if (range === "today") return d.toDateString() === now.toDateString();
        if (range === "week") return (now - d) / 86400000 <= 7;
        if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return true;
      });
    }
    const res = await authFetch(`${API_BASE}/api/sales?range=${range}`);
    return apiJson(res);
  },

  async getDashboard() {
    if (USE_SAMPLE_DATA) {
      const today = new Date().toDateString();
      const todaySales = sampleSales.filter(s => new Date(s.sold_at).toDateString() === today);
      return {
        total_products: sampleProducts.length,
        total_stock: sampleProducts.reduce((a, p) => a + p.quantity, 0),
        today_sales_count: todaySales.reduce((a, s) => a + s.quantity, 0),
        today_revenue: todaySales.reduce((a, s) => a + s.total_amount, 0),
        low_stock_products: sampleProducts.filter(p => p.quantity <= p.low_stock_threshold),
        recent_sales: sampleSales.slice(0, 10),
      };
    }
    const res = await authFetch(`${API_BASE}/api/dashboard`);
    return apiJson(res);
  },

  async askAI(question, attachment) {
    if (USE_SAMPLE_DATA) {
      return { answer: "The AI assistant will answer using your real sales data once the Worker and AI key are connected. For now this is sample mode." };
    }
    const res = await authFetch(`${API_BASE}/api/ai`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, attachment }),
    });
    return apiJson(res);
  },

  async generateDescription(name, category, extra) {
    if (USE_SAMPLE_DATA) {
      return { description: `${name} — a reliable ${category.toLowerCase() || "product"} your customers ask for regularly.` };
    }
    const res = await authFetch(`${API_BASE}/api/ai/product-description`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, category, extra }),
    });
    return apiJson(res);
  },

  async getSettings() {
    if (USE_SAMPLE_DATA) {
      return sampleSettings;
    }
    const res = await authFetch(`${API_BASE}/api/settings`);
    return apiJson(res);
  },

  async updateSettings(data) {
    if (USE_SAMPLE_DATA) {
      Object.assign(sampleSettings, data);
      return sampleSettings;
    }
    const res = await authFetch(`${API_BASE}/api/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    return apiJson(res);
  },

  async signup({ shop_name, email, password, security_question, security_answer }) {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_name, email, password, security_question, security_answer }),
    });
    return apiJson(res);
  },

  async login({ email, password }) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return apiJson(res);
  },

  async me() {
    const res = await authFetch(`${API_BASE}/auth/me`);
    return apiJson(res);
  },

  async resumePayment() {
    const res = await authFetch(`${API_BASE}/paystack/resume`, { method: "POST" });
    return apiJson(res);
  },

  async changePassword(current_password, new_password) {
    const res = await authFetch(`${API_BASE}/auth/change-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password, new_password }),
    });
    return apiJson(res);
  },

  async transcribeAudio(audio_base64, mime_type) {
    if (USE_SAMPLE_DATA) {
      return { text: "" };
    }
    const res = await authFetch(`${API_BASE}/api/ai/transcribe`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64, mime_type }),
    });
    return apiJson(res);
  },

  async getSecurityQuestion(email) {
    const res = await fetch(`${API_BASE}/auth/security-question?email=${encodeURIComponent(email)}`);
    return apiJson(res);
  },

  async resetPasswordWithAnswer(email, answer, new_password) {
    const res = await fetch(`${API_BASE}/auth/reset-password-with-answer`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, answer, new_password }),
    });
    return apiJson(res);
  },

  async updateSecurityQuestion(current_password, security_question, security_answer) {
    const res = await authFetch(`${API_BASE}/auth/update-security-question`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password, security_question, security_answer }),
    });
    return apiJson(res);
  },

  async listShops() {
    if (USE_SAMPLE_DATA) return [{ id: 1, shop_name: sampleSettings.business_name, is_owner: true }];
    const res = await authFetch(`${API_BASE}/api/shops`);
    return apiJson(res);
  },

  async createShop(shop_name) {
    const res = await authFetch(`${API_BASE}/api/shops`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_name }),
    });
    return apiJson(res);
  },

  async duplicateShop(id) {
    const res = await authFetch(`${API_BASE}/api/shops/${id}/duplicate`, { method: "POST" });
    return apiJson(res);
  },

  async deleteShop(id) {
    const res = await authFetch(`${API_BASE}/api/shops/${id}`, { method: "DELETE" });
    return apiJson(res);
  },

  async uploadDocument(data, mime_type, label) {
    const res = await authFetch(`${API_BASE}/api/documents`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, mime_type, label }),
    });
    return apiJson(res);
  },

  async updateDocumentLabel(id, label) {
    const res = await authFetch(`${API_BASE}/api/documents/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    return apiJson(res);
  },

  async markDocumentApplied(id) {
    const res = await authFetch(`${API_BASE}/api/documents/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applied: true }),
    });
    return apiJson(res);
  },

  async listDocuments() {
    if (USE_SAMPLE_DATA) return [];
    const res = await authFetch(`${API_BASE}/api/documents`);
    return apiJson(res);
  },

  async deleteDocument(id) {
    const res = await authFetch(`${API_BASE}/api/documents/${id}`, { method: "DELETE" });
    return apiJson(res);
  },

  async importProducts(rows) {
    const res = await authFetch(`${API_BASE}/api/import/products`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }),
    });
    return apiJson(res);
  },

  async importSales(rows) {
    const res = await authFetch(`${API_BASE}/api/import/sales`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }),
    });
    return apiJson(res);
  },

  async importStock(rows) {
    const res = await authFetch(`${API_BASE}/api/import/stock`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }),
    });
    return apiJson(res);
  },
};

// ---------------- APP STATE & ROUTING ----------------

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "📊", hint: "Today's sales, revenue, and low stock at a glance" },
  { id: "products", label: "Products", icon: "🛒", hint: "Add, edit, sell, and restock your products" },
  { id: "sales", label: "Sales", icon: "🧾", hint: "Your sales history and estimated profit" },
  { id: "ai", label: "AI Assistant", icon: "✨", hint: "Ask questions about your business, by typing or speaking" },
  { id: "settings", label: "Settings", icon: "⚙️", hint: "Shop name, logo, currency, password, and subscription" },
];

let currentView = "dashboard";

function setView(view) {
  currentView = view;
  render();
}

// A password field with a Show/Hide toggle, so the person can check
// what they actually typed instead of guessing at hidden dots.
function passwordFieldHtml(id, placeholder, extraAttrs = "") {
  return `
    <div class="relative">
      <input id="${id}" type="password" placeholder="${placeholder}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 pr-14" ${extraAttrs} />
      <button type="button" onclick="togglePasswordVisibility('${id}', this)" class="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs font-semibold">Show</button>
    </div>`;
}

function togglePasswordVisibility(id, btn) {
  const input = document.getElementById(id);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "Hide";
  } else {
    input.type = "password";
    btn.textContent = "Show";
  }
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

function renderNav() {
  const sidebar = document.getElementById("sidebar-nav");
  const bottom = document.getElementById("bottom-nav");
  sidebar.innerHTML = NAV_ITEMS.map(item => `
    <div class="nav-item ${currentView === item.id ? "active" : ""}" onclick="setView('${item.id}')" title="${item.hint}">
      <span>${item.icon}</span><span>${item.label}</span>
    </div>`).join("");
  bottom.innerHTML = NAV_ITEMS.map(item => `
    <div class="bottom-nav-item ${currentView === item.id ? "active" : ""}" onclick="setView('${item.id}')" title="${item.hint}">
      <span class="text-lg">${item.icon}</span><span>${item.label}</span>
    </div>`).join("");
  document.getElementById("mobile-title").textContent = NAV_ITEMS.find(i => i.id === currentView).label;
}

function hideNav() {
  document.getElementById("sidebar-aside")?.classList.add("!hidden");
  document.getElementById("bottom-nav")?.classList.add("!hidden");
  document.getElementById("mobile-header")?.classList.add("!hidden");
}

function showNav() {
  document.getElementById("sidebar-aside")?.classList.remove("!hidden");
  document.getElementById("bottom-nav")?.classList.remove("!hidden");
  document.getElementById("mobile-header")?.classList.remove("!hidden");
}

function isSessionUsable(shop) {
  if (shop.subscription_status === "active") return true;
  if (shop.subscription_status === "trial" && shop.trial_ends_at) {
    return new Date(shop.trial_ends_at).getTime() > Date.now();
  }
  return false;
}

// While a shop is on the free trial, quietly check every so often
// whether they've actually subscribed, so the trial banner disappears
// on its own instead of sticking around until the next full login.
let lastTrialStatusCheck = 0;
async function maybeRefreshTrialStatus() {
  if (!currentShop || currentShop.subscription_status !== "trial") return;
  const now = Date.now();
  if (now - lastTrialStatusCheck < 60000) return;
  lastTrialStatusCheck = now;
  try {
    const updated = await Api.me();
    const wasTrial = currentShop.subscription_status === "trial";
    currentShop = updated;
    if (wasTrial && updated.subscription_status !== "trial") render();
  } catch {
    // Non critical, just try again next time.
  }
}

async function render() {
  // Sample mode has no Worker to log into, so it skips straight to the app.
  if (!USE_SAMPLE_DATA) {
    if (!authToken) {
      hideNav();
      document.getElementById("app").innerHTML = await ViewAuth();
      return;
    }
    if (!currentShop) {
      try {
        currentShop = await Api.me();
        if (!activeShopId) {
          activeShopId = String(currentShop.id);
          localStorage.setItem("duka_active_shop_id", activeShopId);
        }
      } catch (err) {
        if (err.status === 401) {
          logout();
        } else {
          hideNav();
          document.getElementById("app").innerHTML = `
            <div class="max-w-sm mx-auto mt-16 text-center">
              <div class="text-4xl mb-3">📡</div>
              <h1 class="font-display text-xl font-extrabold mb-2">Can't reach Duka</h1>
              <p class="text-sm text-ink/50 mb-5">Check your connection and try again. You're still logged in.</p>
              <button onclick="render()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Retry</button>
            </div>`;
        }
        return;
      }
    }
    if (!isSessionUsable(currentShop)) {
      hideNav();
      document.getElementById("app").innerHTML = await ViewPaymentPending();
      return;
    }
    maybeRefreshTrialStatus();
  }

  if (!shopSettings) {
    try { shopSettings = USE_SAMPLE_DATA ? sampleSettings : await Api.getSettings(); }
    catch { shopSettings = {}; }
  }

  showNav();
  renderNav();
  const app = document.getElementById("app");
  app.innerHTML = `<div class="py-16 text-center text-ink/40">Loading…</div>`;
  try {
    if (currentView === "dashboard") app.innerHTML = await ViewDashboard();
    if (currentView === "products") app.innerHTML = await ViewProducts();
    if (currentView === "sales") app.innerHTML = await ViewSales();
    if (currentView === "ai") {
      app.innerHTML = await ViewAI();
      if (pendingAIQuestion) {
        const input = document.getElementById("ai-input");
        if (input) input.value = pendingAIQuestion;
        pendingAIQuestion = null;
      }
    }
    if (currentView === "settings") app.innerHTML = await ViewSettings();
  } catch (err) {
    app.innerHTML = `<div class="text-center py-16 text-danger">Something went wrong: ${err.message}</div>`;
  }
}

// ---------------- AUTH & BILLING VIEWS ----------------

let authMode = "login"; // or "signup"

async function ViewAuth() {
  if (authMode === "forgot") return ViewForgotPassword();
  return `
    <div class="max-w-sm mx-auto mt-10 md:mt-20">
      <div class="text-center mb-6">
        <div class="font-display text-3xl font-extrabold text-primary-dark">Duka</div>
        <p class="text-sm text-ink/50 mt-1">Simple stock and sales, in your pocket.</p>
      </div>
      <div class="flex bg-black/5 rounded-full p-1 mb-5">
        <button onclick="authMode='login'; render()" class="flex-1 py-2 rounded-full text-sm font-semibold ${authMode === "login" ? "bg-white shadow-sm" : "text-ink/50"}">Log in</button>
        <button onclick="authMode='signup'; render()" class="flex-1 py-2 rounded-full text-sm font-semibold ${authMode === "signup" ? "bg-white shadow-sm" : "text-ink/50"}">Sign up</button>
      </div>
      <div class="card p-4 space-y-3">
        ${authMode === "signup" ? `<input id="auth-shopname" placeholder="Shop name" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />` : ""}
        <input id="auth-email" type="email" placeholder="Email" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
        ${passwordFieldHtml("auth-password", "Password", `onkeydown="if(event.key==='Enter') submitAuth()"`)}
        ${authMode === "signup" ? `
          <input id="auth-security-question" placeholder="A security question only you'd know the answer to" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
          <input id="auth-security-answer" placeholder="Your answer" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
        ` : ""}
        <button id="auth-submit-btn" onclick="submitAuth()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">
          ${authMode === "signup" ? "Create account" : "Log in"}
        </button>
        ${authMode === "login" ? `<button onclick="authMode='forgot'; render()" class="w-full text-xs text-primary underline text-center">Forgot your password?</button>` : ""}
      </div>
      <p class="text-xs text-ink/40 text-center mt-4">
        ${authMode === "signup" ? "Free for 7 days, no card needed to start." : ""}
      </p>
    </div>
  `;
}

let forgotStep = "email"; // then "answer"
let forgotEmail = "";
let forgotQuestion = "";

function ViewForgotPassword() {
  return `
    <div class="max-w-sm mx-auto mt-10 md:mt-20">
      <div class="text-center mb-6">
        <div class="font-display text-3xl font-extrabold text-primary-dark">Duka</div>
        <p class="text-sm text-ink/50 mt-1">Reset your password</p>
      </div>
      <div class="card p-4 space-y-3">
        ${forgotStep === "email" ? `
          <input id="forgot-email" type="email" placeholder="Email" class="w-full border border-black/10 rounded-xl px-3 py-2.5"
            onkeydown="if(event.key==='Enter') submitForgotEmail()" />
          <button id="forgot-submit-btn" onclick="submitForgotEmail()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Continue</button>
        ` : `
          <p class="text-sm font-medium">${forgotQuestion}</p>
          <input id="forgot-answer" placeholder="Your answer" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
          ${passwordFieldHtml("forgot-new-password", "New password")}
          ${passwordFieldHtml("forgot-confirm-password", "Confirm new password")}
          <button id="forgot-submit-btn" onclick="submitForgotAnswer()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Update password</button>
        `}
        <button onclick="authMode='login'; forgotStep='email'; render()" class="w-full text-xs text-ink/50 underline text-center">Back to log in</button>
      </div>
    </div>
  `;
}

async function submitForgotEmail() {
  const email = document.getElementById("forgot-email").value.trim();
  if (!email) { toast("Enter your email"); return; }
  const btn = document.getElementById("forgot-submit-btn");
  btn.disabled = true;
  btn.classList.add("opacity-60");
  btn.textContent = "Checking…";
  try {
    const { question } = await Api.getSecurityQuestion(email);
    forgotEmail = email;
    forgotQuestion = question;
    forgotStep = "answer";
    render();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.classList.remove("opacity-60");
    btn.textContent = "Continue";
  }
}

async function submitForgotAnswer() {
  const answer = document.getElementById("forgot-answer").value.trim();
  const next = document.getElementById("forgot-new-password").value;
  const confirm = document.getElementById("forgot-confirm-password").value;
  if (!answer) { toast("Enter your answer"); return; }
  if (!next || next.length < 6) { toast("Password must be at least 6 characters"); return; }
  if (next !== confirm) { toast("Passwords don't match"); return; }

  const btn = document.getElementById("forgot-submit-btn");
  btn.disabled = true;
  btn.classList.add("opacity-60");
  btn.textContent = "Updating…";
  try {
    await Api.resetPasswordWithAnswer(forgotEmail, answer, next);
    authMode = "login";
    forgotStep = "email";
    toast("Password updated, log in with your new password.");
    render();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.classList.remove("opacity-60");
    btn.textContent = "Update password";
  }
}

async function submitAuth() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!email || !password) { toast("Email and password are required"); return; }

  const btn = document.getElementById("auth-submit-btn");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.classList.add("opacity-60");
  btn.textContent = authMode === "signup" ? "Creating account…" : "Logging in…";

  try {
    if (authMode === "signup") {
      const shop_name = document.getElementById("auth-shopname").value.trim();
      const security_question = document.getElementById("auth-security-question").value.trim();
      const security_answer = document.getElementById("auth-security-answer").value.trim();
      if (!shop_name) { toast("Shop name is required"); return; }
      if (!security_question || !security_answer) { toast("A security question and answer are required, they're how you recover your password"); return; }
      const result = await Api.signup({ shop_name, email, password, security_question, security_answer });
      authToken = result.token;
      localStorage.setItem("duka_token", authToken);
      if (result.authorization_url) {
        window.location.href = result.authorization_url;
        return;
      }
      toast(result.error || "Account created, enjoy your free trial!");
      currentShop = null;
      render();
    } else {
      const result = await Api.login({ email, password });
      authToken = result.token;
      localStorage.setItem("duka_token", authToken);
      currentShop = null;
      render();
    }
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.classList.remove("opacity-60");
    btn.textContent = originalLabel;
  }
}

async function ViewPaymentPending() {
  const status = currentShop?.subscription_status;
  const isTrialExpired = status === "trial";
  const message = isTrialExpired
    ? "Your 7 day free trial has ended. Subscribe to keep using Duka."
    : status === "past_due"
    ? "Your last payment didn't go through. Renew to keep using Duka."
    : status === "canceled"
    ? "Your subscription was canceled. Resubscribe to keep using Duka."
    : "Complete your payment to start using Duka.";
  return `
    <div class="max-w-sm mx-auto mt-16 text-center">
      <div class="text-4xl mb-3">${isTrialExpired ? "🎉" : "⏳"}</div>
      <h1 class="font-display text-xl font-extrabold mb-2">${isTrialExpired ? "Trial complete" : "Almost there"}</h1>
      <p class="text-sm text-ink/50 mb-5">${message}</p>
      <button onclick="resumePaymentFlow()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mb-3">Continue to payment</button>
      <button onclick="refreshSession()" class="w-full border border-black/10 py-2.5 rounded-xl font-semibold mb-3">I already paid, refresh</button>
      <button onclick="logout()" class="text-xs text-ink/40 underline">Log out</button>
    </div>
  `;
}

async function resumePaymentFlow() {
  try {
    const result = await Api.resumePayment();
    window.location.href = result.authorization_url;
  } catch (err) {
    toast(err.message);
  }
}

async function refreshSession() {
  try {
    const updated = await Api.me();
    currentShop = updated;
    if (isSessionUsable(updated)) {
      toast("Payment confirmed!");
    } else {
      toast("Still not showing as paid yet. This can take a minute after paying, try again shortly.");
    }
    render();
  } catch (err) {
    toast("Could not check your status. Check your connection and try again.");
  }
}

// ---------------- DASHBOARD VIEW ----------------

function trialBannerHtml() {
  if (USE_SAMPLE_DATA || !currentShop || currentShop.subscription_status !== "trial" || !currentShop.trial_ends_at) return "";
  const daysLeft = Math.max(0, Math.ceil((new Date(currentShop.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  return `
    <div class="bg-amber-light text-amber-dark text-sm font-semibold rounded-xl px-4 py-2.5 mb-4 flex items-center justify-between">
      <span>${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial</span>
      <button onclick="setView('settings')" class="underline">Subscribe</button>
    </div>`;
}

async function ViewDashboard() {
  const d = await Api.getDashboard();
  const stat = (label, value) => `
    <div class="stat-card">
      <div class="text-xs text-ink/50 mb-1">${label}</div>
      <div class="font-display text-2xl font-extrabold">${value}</div>
    </div>`;

  const lowStockHtml = d.low_stock_products.length
    ? d.low_stock_products.map(p => `
        <div class="flex items-center justify-between py-2.5 border-b border-black/5 last:border-0">
          <span>${p.name}</span>
          <span class="text-xs font-semibold text-danger bg-danger-light px-2 py-1 rounded-full">${p.quantity} left</span>
        </div>`).join("")
    : `<div class="text-sm text-ink/40 py-4 text-center">Nothing running low. Nice.</div>`;

  const recentHtml = d.recent_sales.length
    ? d.recent_sales.map(s => `
        <div class="flex items-center justify-between py-2.5 border-b border-black/5 last:border-0">
          <div>
            <div class="font-medium">${s.product_name}</div>
            <div class="text-xs text-ink/45">${s.quantity} units</div>
          </div>
          <div class="font-semibold">${formatMoney(s.total_amount)}</div>
        </div>`).join("")
    : `<div class="text-sm text-ink/40 py-4 text-center">No sales recorded yet.</div>`;

  return `
    ${trialBannerHtml()}
    <div class="flex items-center justify-between mb-5">
      <h1 class="font-display text-2xl font-extrabold hidden md:block">Dashboard</h1>
      <button onclick="setView('products')" class="bg-primary text-white font-semibold px-4 py-2.5 rounded-full text-sm">+ New Sale</button>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-5">
      ${stat("Total Products", d.total_products)}
      ${stat("Units In Stock", d.total_stock)}
      ${stat("Today's Sales", d.today_sales_count)}
      ${stat("Today's Revenue", formatMoney(d.today_revenue))}
    </div>
    <div class="card p-4 mb-5">
      <h2 class="font-display font-bold mb-1">Low Stock</h2>
      ${lowStockHtml}
    </div>
    <div class="card p-4">
      <h2 class="font-display font-bold mb-1">Recent Sales</h2>
      ${recentHtml}
    </div>
  `;
}

// ---------------- PRODUCTS VIEW ----------------

let productSearchTerm = "";

async function ViewProducts() {
  const products = await Api.getProducts(productSearchTerm);
  const cards = products.length
    ? products.map(productCard).join("")
    : `<div class="text-center py-16 text-ink/40">No products yet. Add your first one.</div>`;

  return `
    <div class="flex items-center justify-between mb-4 gap-3">
      <h1 class="font-display text-2xl font-extrabold hidden md:block">Products</h1>
      <input id="product-search" type="text" placeholder="Search name, SKU or category"
        value="${productSearchTerm}"
        oninput="productSearchTerm = this.value; render()"
        class="flex-1 md:flex-none md:w-64 bg-surface border border-black/10 rounded-full px-4 py-2.5 text-sm" />
      <button onclick="openProductForm()" class="bg-primary text-white font-semibold px-4 py-2.5 rounded-full text-sm whitespace-nowrap">+ Add</button>
    </div>
    <div class="grid sm:grid-cols-2 gap-3">${cards}</div>
  `;
}

function productCard(p) {
  const isLow = p.quantity <= p.low_stock_threshold;
  return `
    <div class="card p-4 flex flex-col gap-2">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          ${p.image_url
            ? `<div class="w-12 h-12 rounded-xl bg-cover bg-center flex-shrink-0" style="background-image:url('${p.image_url}')"></div>`
            : `<div class="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center text-lg flex-shrink-0">📦</div>`}
          <div>
            <div class="font-display font-bold">${p.name}</div>
            <div class="text-xs text-ink/45">${p.category || "Uncategorized"}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-semibold">${formatMoney(p.selling_price)}</div>
          <div class="text-xs ${isLow ? "text-danger font-semibold" : "text-ink/45"}">${p.quantity} available${isLow ? " · LOW" : ""}</div>
        </div>
      </div>
      <div class="flex gap-2 mt-1">
        <button onclick="openSellModal(${p.id})" title="Record a sale, reduces stock automatically" class="flex-1 bg-primary text-white font-semibold py-2.5 rounded-xl text-sm">SELL</button>
        <button onclick="openStockModal(${p.id})" title="Restock this product and log the movement" class="flex-1 bg-amber-light text-amber-dark font-semibold py-2.5 rounded-xl text-sm">ADD STOCK</button>
      </div>
      <div class="flex gap-3 text-xs text-ink/45 pt-1">
        <button onclick="openProductForm(${p.id})" class="underline">Edit</button>
        <button onclick="confirmDeleteProduct(${p.id})" class="underline">Delete</button>
      </div>
    </div>`;
}

function openProductForm(id) {
  const product = id ? sampleProducts.find(p => p.id === id) : null;
  pendingProductImage = product?.image_url || null;
  const modal = document.getElementById("product-modal");
  document.getElementById("product-modal-body").innerHTML = `
    <h2 class="font-display text-xl font-extrabold mb-4">${product ? "Edit product" : "Add product"}</h2>
    <div class="space-y-3">
      <div class="flex items-center gap-3">
        <div id="product-photo-preview" class="w-14 h-14 rounded-xl bg-black/5 bg-cover bg-center flex items-center justify-center text-lg flex-shrink-0"
          style="${product?.image_url ? `background-image:url('${product.image_url}')` : ""}">${product?.image_url ? "" : "📦"}</div>
        <label class="text-sm font-semibold text-primary cursor-pointer">
          Add photo
          <input type="file" accept="image/*" class="hidden" onchange="onProductPhotoSelected(event)" />
        </label>
      </div>
      <input id="pf-name" placeholder="Product name" value="${product?.name || ""}" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
      <div class="flex gap-2">
        <input id="pf-desc" placeholder="Description" value="${product?.description || ""}" class="flex-1 border border-black/10 rounded-xl px-3 py-2.5" />
        <button onclick="generateAIDescription()" class="text-xs bg-primary-light text-primary-dark font-semibold px-3 rounded-xl whitespace-nowrap">✨ AI</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input id="pf-category" placeholder="Category" value="${product?.category || ""}" class="border border-black/10 rounded-xl px-3 py-2.5" />
        <input id="pf-sku" placeholder="SKU" value="${product?.sku || ""}" class="border border-black/10 rounded-xl px-3 py-2.5" />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input id="pf-price" type="number" placeholder="Selling price" value="${product?.selling_price ?? ""}" class="border border-black/10 rounded-xl px-3 py-2.5" />
        <input id="pf-cost" type="number" placeholder="Cost price" value="${product?.cost_price ?? ""}" class="border border-black/10 rounded-xl px-3 py-2.5" />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input id="pf-qty" type="number" placeholder="Quantity" value="${product?.quantity ?? 0}" ${product ? "disabled" : ""} class="border border-black/10 rounded-xl px-3 py-2.5 ${product ? "bg-black/5" : ""}" />
        <input id="pf-threshold" type="number" placeholder="Low stock alert at" value="${product?.low_stock_threshold ?? 5}" class="border border-black/10 rounded-xl px-3 py-2.5" />
      </div>
      ${product ? `<p class="text-xs text-ink/40">Use "Add Stock" to change quantity, so movement history stays accurate.</p>` : ""}
    </div>
    <div class="flex gap-2 mt-5">
      <button onclick="closeModal('product-modal')" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button onclick="saveProduct(${id || "null"})" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Save</button>
    </div>
  `;
  modal.classList.remove("hidden");
}

let pendingProductImage = null;

async function onProductPhotoSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    pendingProductImage = await compressImageToDataUrl(file, 400, 400);
    const preview = document.getElementById("product-photo-preview");
    preview.style.backgroundImage = `url('${pendingProductImage}')`;
    preview.textContent = "";
  } catch (err) {
    toast("Could not read that image, try a different file");
  }
}

async function generateAIDescription() {
  const name = document.getElementById("pf-name").value;
  const category = document.getElementById("pf-category").value;
  if (!name) { toast("Enter a product name first"); return; }
  const { description } = await Api.generateDescription(name, category, "");
  document.getElementById("pf-desc").value = description;
}

async function saveProduct(id) {
  const data = {
    name: document.getElementById("pf-name").value.trim(),
    description: document.getElementById("pf-desc").value.trim(),
    category: document.getElementById("pf-category").value.trim(),
    sku: document.getElementById("pf-sku").value.trim(),
    selling_price: parseFloat(document.getElementById("pf-price").value) || 0,
    cost_price: parseFloat(document.getElementById("pf-cost").value) || 0,
    low_stock_threshold: parseInt(document.getElementById("pf-threshold").value) || 5,
  };
  if (!data.name) { toast("Product name is required"); return; }
  if (!id) data.quantity = parseInt(document.getElementById("pf-qty").value) || 0;
  if (pendingProductImage) data.image_url = pendingProductImage;

  try {
    if (id) await Api.updateProduct(id, data);
    else await Api.createProduct(data);

    pendingProductImage = null;
    closeModal("product-modal");
    toast(id ? "Product updated" : "Product added");
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function confirmDeleteProduct(id) {
  if (!confirm("Delete this product? This cannot be undone.")) return;
  try {
    await Api.deleteProduct(id);
    toast("Product deleted");
    render();
  } catch (err) {
    toast(err.message);
  }
}

// ---------------- SELL MODAL ----------------

let sellQty = 1;

function openSellModal(productId) {
  sellQty = 1;
  renderSellModal(productId);
  document.getElementById("sell-modal").classList.remove("hidden");
}

function renderSellModal(productId) {
  const p = sampleProducts.find(p => p.id === productId);
  document.getElementById("sell-modal-body").innerHTML = `
    <h2 class="font-display text-xl font-extrabold mb-1">${p.name}</h2>
    <p class="text-sm text-ink/50 mb-4">${p.quantity} units available · ${formatMoney(p.selling_price)} each</p>
    <div class="flex items-center justify-center gap-5 mb-4">
      <div class="qty-btn" onclick="changeSellQty(${productId}, -1)">−</div>
      <div class="font-display text-3xl font-extrabold w-12 text-center">${sellQty}</div>
      <div class="qty-btn" onclick="changeSellQty(${productId}, 1)">+</div>
    </div>
    <p class="text-center font-semibold mb-5">Total: ${formatMoney(p.selling_price * sellQty)}</p>
    <div class="flex gap-2">
      <button onclick="closeModal('sell-modal')" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button onclick="confirmSale(${productId})" class="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold">Confirm Sale</button>
    </div>
  `;
}

function changeSellQty(productId, delta) {
  sellQty = Math.max(1, sellQty + delta);
  renderSellModal(productId);
}

async function confirmSale(productId) {
  try {
    const result = await Api.sell(productId, sellQty);
    closeModal("sell-modal");
    toast(`Sold. New stock: ${result.new_quantity}`);
    render();
  } catch (err) {
    toast(err.message);
  }
}

// ---------------- ADD STOCK MODAL ----------------

function openStockModal(productId) {
  const p = sampleProducts.find(p => p.id === productId);
  document.getElementById("stock-modal-body").innerHTML = `
    <h2 class="font-display text-xl font-extrabold mb-1">Add stock — ${p.name}</h2>
    <p class="text-sm text-ink/50 mb-4">Current stock: ${p.quantity}</p>
    <div class="space-y-3">
      <input id="as-qty" type="number" placeholder="Quantity to add" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
      <input id="as-cost" type="number" placeholder="Cost per unit (optional)" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
      <input id="as-supplier" placeholder="Supplier (optional)" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
    </div>
    <div class="flex gap-2 mt-5">
      <button onclick="closeModal('stock-modal')" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Cancel</button>
      <button onclick="confirmAddStock(${productId})" class="flex-1 py-2.5 rounded-xl bg-amber text-white font-semibold">Add Stock</button>
    </div>
  `;
  document.getElementById("stock-modal").classList.remove("hidden");
}

async function confirmAddStock(productId) {
  const qty = parseInt(document.getElementById("as-qty").value);
  if (!qty || qty <= 0) { toast("Enter a valid quantity"); return; }
  const cost = parseFloat(document.getElementById("as-cost").value) || 0;
  const supplier = document.getElementById("as-supplier").value.trim();
  try {
    const result = await Api.addStock(productId, qty, cost, supplier, "");
    closeModal("stock-modal");
    toast(`Stock updated. New stock: ${result.new_quantity}`);
    render();
  } catch (err) {
    toast(err.message);
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

// ---------------- FOOTER INFO ----------------
// Placeholder copy for About/Support/Privacy/Terms. The privacy and
// terms text especially should be reviewed by a lawyer before this is
// relied on as an actual legal policy, this is a reasonable starting
// draft, not legal advice.
const FOOTER_INFO = {
  about: {
    title: "About Duka",
    body: `Duka is a complete shop management platform for tracking inventory, sales, and profit in real time.
      Add products with photos and pricing, record sales with one tap, and every transaction is logged with a
      full audit trail. A built-in AI assistant answers business questions, reads uploaded receipts and invoices,
      and can even help apply what it reads directly to your stock. One account supports multiple shops or
      branches, each fully independent.`,
  },
  support: {
    title: "Support",
    body: `Need help with your account, billing, or something in the app isn't working as expected? Email
      <a href="mailto:dukashopmanager@gmail.com" class="text-primary-dark underline">dukashopmanager@gmail.com</a>
      and describe what happened, including your shop name if you can. We aim to respond as quickly as possible.`,
  },
  privacy: {
    title: "Privacy Policy",
    body: `Duka stores the business data you enter, products, sales, stock movements, and settings, to provide
      the service. Payment is processed by Paystack, Duka does not store your card details. Questions you ask
      the AI assistant, and any documents you upload, are sent to Google's Gemini API to generate a response;
      document uploads are summarized and the summary is kept, the original file is not stored. Your data is
      never sold. Data for each shop is kept separate and is never visible to other shops on the platform.
      Contact <a href="mailto:dukashopmanager@gmail.com" class="text-primary-dark underline">dukashopmanager@gmail.com</a>
      with any privacy questions.`,
  },
  terms: {
    title: "Terms of Service",
    body: `By using Duka you agree to use it for lawful business purposes and to keep your login credentials
      secure. New accounts include a 7 day free trial; continued use after the trial requires an active paid
      subscription, billed in advance for the period selected. Subscriptions do not renew automatically onto a
      different price without notice. Duka is provided as-is; we work to keep it reliable but cannot guarantee
      uninterrupted service. You are responsible for the accuracy of the business data you enter. Contact
      <a href="mailto:dukashopmanager@gmail.com" class="text-primary-dark underline">dukashopmanager@gmail.com</a>
      with any questions about these terms.`,
  },
};

function showFooterInfo(key) {
  const info = FOOTER_INFO[key];
  if (!info) return;
  document.getElementById("info-modal-body").innerHTML = `
    <h2 class="font-display text-xl font-extrabold mb-3">${info.title}</h2>
    <p class="text-sm text-ink/70 leading-relaxed whitespace-pre-line">${info.body}</p>
    <button onclick="closeModal('info-modal')" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mt-5">Close</button>
  `;
  document.getElementById("info-modal").classList.remove("hidden");
}

// ---------------- SALES VIEW ----------------

let salesRange = "today";

async function ViewSales() {
  const sales = await Api.getSales(salesRange);
  const totalRevenue = sales.reduce((a, s) => a + s.total_amount, 0);
  const totalProfit = sales.reduce((a, s) => a + s.estimated_profit, 0);

  const ranges = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["all", "All"]];
  const tabs = ranges.map(([key, label]) => `
    <button onclick="salesRange='${key}'; render()" class="px-3 py-1.5 rounded-full text-sm font-medium ${salesRange === key ? "bg-primary text-white" : "bg-surface border border-black/10"}">${label}</button>
  `).join("");

  const rows = sales.length
    ? sales.map(s => `
        <div class="flex items-center justify-between py-3 border-b border-black/5 last:border-0">
          <div>
            <div class="font-medium">${s.product_name}</div>
            <div class="text-xs text-ink/45">${new Date(s.sold_at).toLocaleString()} · ${s.quantity} units</div>
          </div>
          <div class="text-right">
            <div class="font-semibold">${formatMoney(s.total_amount)}</div>
            <div class="text-xs text-primary">+${formatMoney(s.estimated_profit)} profit</div>
          </div>
        </div>`).join("")
    : `<div class="text-center py-12 text-ink/40">No sales in this range.</div>`;

  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Sales</h1>
    <div class="flex gap-2 mb-4 flex-wrap">${tabs}</div>
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="stat-card"><div class="text-xs text-ink/50">Revenue</div><div class="font-display text-xl font-extrabold">${formatMoney(totalRevenue)}</div></div>
      <div class="stat-card"><div class="text-xs text-ink/50">Estimated profit</div><div class="font-display text-xl font-extrabold">${formatMoney(totalProfit)}</div></div>
    </div>
    <div class="card p-4">${rows}</div>
  `;
}

// ---------------- AI ASSISTANT VIEW ----------------

let aiMessages = [
  { role: "assistant", text: "Ask me things like \"what did I sell today\" or \"which products are running low\". You can type or tap the mic to speak." },
];

async function ViewAI() {
  const bubbles = aiMessages.map((m, i) => `
    <div class="flex ${m.role === "user" ? "justify-end" : "justify-start"} mb-3">
      <div data-msg-index="${i}" class="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${m.role === "user" ? "bg-primary text-white" : "bg-surface border border-black/10"}">${m.text}</div>
    </div>`).join("");
  const documents = USE_SAMPLE_DATA ? [] : await Api.listDocuments();
  cachedDocuments = documents;

  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">AI Assistant</h1>
    <div class="card p-4 mb-3 min-h-[50vh] flex flex-col justify-end" id="ai-thread">${bubbles}</div>
    ${pendingAttachment ? `
      <div class="flex items-center justify-between bg-primary-light text-primary-dark text-xs font-medium rounded-full px-3 py-2 mb-2">
        <span>📎 ${pendingAttachment.name}</span>
        <button onclick="clearAttachment()" class="font-bold">✕</button>
      </div>
    ` : ""}
    <div class="flex gap-2">
      <label title="Attach a receipt, invoice, or document to this question only" class="w-11 h-11 rounded-full bg-surface border border-black/10 flex items-center justify-center flex-shrink-0 cursor-pointer">
        📎
        <input type="file" accept="image/*,.pdf" class="hidden" onchange="onAttachmentSelected(event)" />
      </label>
      <button id="mic-btn" onclick="toggleVoiceInput()" title="Record a voice question"
        class="w-11 h-11 rounded-full bg-surface border border-black/10 flex items-center justify-center flex-shrink-0">
        <svg id="mic-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      </button>
      <input id="ai-input" placeholder="Ask about your business" class="flex-1 border border-black/10 rounded-full px-4 py-2.5"
        onkeydown="if(event.key==='Enter') sendAIMessage()" />
      <button onclick="sendAIMessage()" class="bg-primary text-white font-semibold px-4 py-2.5 rounded-full">Ask</button>
    </div>

    <div class="card p-4 mt-4">
      <div class="flex items-center justify-between mb-1">
        <h2 class="font-display font-bold">Business Documents</h2>
        <label class="text-xs bg-primary-light text-primary-dark font-semibold px-3 py-1.5 rounded-full cursor-pointer whitespace-nowrap">
          + Upload
          <input type="file" accept="image/*,.pdf" class="hidden" onchange="onDocumentUpload(event)" />
        </label>
      </div>
      <p class="text-xs text-ink/40 mb-2">Receipts, invoices, purchase orders. Every question the AI answers can already draw on all of these together, not just one you attach.</p>
      ${documents.length ? documents.map(d => `
        <div class="border-b border-black/5 last:border-0 py-2">
          <div class="flex items-start justify-between gap-2 cursor-pointer" onclick="toggleDocumentExpanded(${d.id})">
            <div>
              <div class="text-sm font-medium">${d.label || d.vendor || d.document_type || "Document"}</div>
              <div class="text-xs text-ink/45">${d.document_type || ""}${d.amount ? " · " + formatMoney(d.amount) : ""}${d.document_date ? " · " + d.document_date : ""}</div>
            </div>
            <span class="text-xs text-ink/30 flex-shrink-0">${expandedDocumentId === d.id ? "▲" : "▼"}</span>
          </div>
          ${expandedDocumentId === d.id ? `
            <div class="mt-2 pl-1 space-y-2">
              <p class="text-sm text-ink/70">${d.summary}</p>
              <p class="text-xs text-ink/40">No original file is kept, only what was read from it, so this is the full record.</p>
              ${documentLineItemsHtml(d)}
              <div class="flex gap-2 flex-wrap">
                <button onclick="editDocumentLabel(${d.id})" class="text-xs bg-black/5 font-semibold px-3 py-1.5 rounded-full">Edit label</button>
                <button onclick="askAIAboutDocument(${d.id})" class="text-xs bg-primary-light text-primary-dark font-semibold px-3 py-1.5 rounded-full">Ask AI about this</button>
                <button onclick="deleteDocumentFlow(${d.id})" class="text-xs bg-danger-light text-danger font-semibold px-3 py-1.5 rounded-full">Delete</button>
              </div>
            </div>
          ` : ""}
        </div>
      `).join("") : `<div class="text-sm text-ink/40 py-3 text-center">No documents uploaded yet.</div>`}
    </div>
  `;
}

let pendingAttachment = null; // { name, mimeType, data }

async function onAttachmentSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    let data, mimeType;
    if (file.type === "application/pdf") {
      data = await blobToBase64(file);
      mimeType = "application/pdf";
    } else {
      data = (await compressImageToDataUrl(file, 1200, 1200, 0.8)).split(",")[1];
      mimeType = "image/jpeg";
    }
    pendingAttachment = { name: file.name, mimeType, data };
    render();
  } catch {
    toast("Could not read that file");
  }
}

function clearAttachment() {
  pendingAttachment = null;
  render();
}

async function onDocumentUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  toast("Reading document…");
  try {
    let data, mimeType;
    if (file.type === "application/pdf") {
      data = await blobToBase64(file);
      mimeType = "application/pdf";
    } else {
      data = (await compressImageToDataUrl(file, 1200, 1200, 0.8)).split(",")[1];
      mimeType = "image/jpeg";
    }
    const saved = await Api.uploadDocument(data, mimeType);
    toast(`Saved: ${saved.vendor || saved.document_type}${saved.amount ? " · " + formatMoney(saved.amount) : ""}. Add a label anytime by opening it.`);
    render();
  } catch (err) {
    toast(err.message || "Could not read that document");
  }
  event.target.value = "";
}

let cachedDocuments = [];
let expandedDocumentId = null;
let pendingAIQuestion = null;

function toggleDocumentExpanded(id) {
  expandedDocumentId = expandedDocumentId === id ? null : id;
  render();
}

async function editDocumentLabel(id) {
  const doc = cachedDocuments.find(d => d.id === id);
  const label = prompt("Label for this document:", doc?.label || "");
  if (label === null) return;
  try {
    await Api.updateDocumentLabel(id, label.trim());
    toast("Label updated");
    render();
  } catch (err) {
    toast(err.message);
  }
}

function askAIAboutDocument(id) {
  const doc = cachedDocuments.find(d => d.id === id);
  if (!doc) return;
  expandedDocumentId = null;
  pendingAIQuestion = `Tell me more about this ${doc.document_type || "document"}${doc.label ? ` ("${doc.label}")` : ""}, and how it relates to my other business records.`;
  setView("ai");
}

async function deleteDocumentFlow(id) {
  if (!confirm("Remove this document? The AI will no longer be able to refer back to it.")) return;
  try {
    await Api.deleteDocument(id);
    toast("Document removed");
    render();
  } catch (err) {
    toast(err.message);
  }
}

// ---------------- APPLY DOCUMENT ITEMS TO STOCK ----------------
// Extracted line items are always shown for review, never applied
// automatically, a misread quantity should never silently corrupt
// real stock numbers.

let reviewingDocumentId = null;
let reviewItems = [];
let reviewProductsCache = null;

function documentLineItemsHtml(d) {
  let items = [];
  try { items = JSON.parse(d.line_items || "[]"); } catch { items = []; }
  if (!items.length) return "";

  if (d.applied) {
    return `<p class="text-xs text-primary-dark bg-primary-light rounded-full px-3 py-1.5 inline-block">✓ ${items.length} item${items.length === 1 ? "" : "s"} already applied to stock</p>`;
  }

  const directionLabel = d.direction === "sale" ? "sale" : "purchase";
  return `
    <button onclick="toggleReviewItems(${d.id})" class="text-xs bg-amber-light text-amber-dark font-semibold px-3 py-1.5 rounded-full">
      Review ${items.length} item${items.length === 1 ? "" : "s"} found (looks like a ${directionLabel})
    </button>
    ${reviewingDocumentId === d.id ? renderReviewItemsHtml(d.direction) : ""}
  `;
}

function guessProductMatch(description) {
  if (!reviewProductsCache) return null;
  const desc = description.toLowerCase().trim();
  let match = reviewProductsCache.find((p) => p.name.toLowerCase() === desc);
  if (!match) match = reviewProductsCache.find((p) => desc.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(desc));
  return match ? match.id : null;
}

async function toggleReviewItems(id) {
  if (reviewingDocumentId === id) {
    reviewingDocumentId = null;
    render();
    return;
  }
  const doc = cachedDocuments.find((d) => d.id === id);
  if (!doc) return;
  try { reviewItems = JSON.parse(doc.line_items || "[]"); } catch { reviewItems = []; }
  reviewingDocumentId = id;

  if (!reviewProductsCache) {
    try { reviewProductsCache = await Api.getProducts(""); } catch { reviewProductsCache = []; }
  }
  render();
}

function renderReviewItemsHtml(direction) {
  if (!reviewProductsCache) return `<p class="text-xs text-ink/40 py-2">Loading products…</p>`;
  const defaultDirection = direction === "sale" ? "sale" : "purchase";
  return `
    <div class="mt-2 space-y-3 bg-black/5 rounded-xl p-3">
      ${reviewItems.map((item, i) => `
        <div>
          <p class="text-xs text-ink/50 mb-1">"${item.description}" on the document</p>
          <div class="flex items-center gap-2 flex-wrap">
            <select id="review-product-${i}" class="flex-1 min-w-[140px] border border-black/10 rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">— no match, skip —</option>
              ${reviewProductsCache.map((p) => `<option value="${p.id}" ${guessProductMatch(item.description) === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
            </select>
            <input id="review-qty-${i}" type="number" value="${item.quantity}" class="w-16 border border-black/10 rounded-lg px-2 py-1.5 text-xs" />
            <select id="review-direction-${i}" class="border border-black/10 rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="purchase" ${defaultDirection === "purchase" ? "selected" : ""}>+ Add stock</option>
              <option value="sale" ${defaultDirection === "sale" ? "selected" : ""}>− Sell</option>
            </select>
          </div>
        </div>
      `).join("")}
      <button onclick="applyReviewedItems(${reviewingDocumentId})" class="w-full bg-primary text-white text-xs font-semibold py-2 rounded-lg">Apply to stock</button>
    </div>
  `;
}

async function applyReviewedItems(documentId) {
  let appliedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < reviewItems.length; i++) {
    const productSelect = document.getElementById(`review-product-${i}`);
    const qtyInput = document.getElementById(`review-qty-${i}`);
    const directionSelect = document.getElementById(`review-direction-${i}`);
    if (!productSelect || !productSelect.value) { skippedCount++; continue; }
    const productId = Number(productSelect.value);
    const quantity = parseInt(qtyInput.value);
    if (!quantity || quantity <= 0) { skippedCount++; continue; }

    try {
      if (directionSelect.value === "sale") await Api.sell(productId, quantity);
      else await Api.addStock(productId, quantity, 0, "", "From uploaded document");
      appliedCount++;
    } catch {
      skippedCount++;
    }
  }

  try { await Api.markDocumentApplied(documentId); } catch {}
  reviewingDocumentId = null;
  reviewProductsCache = null;
  toast(`Applied ${appliedCount} item${appliedCount === 1 ? "" : "s"} to stock${skippedCount ? `, skipped ${skippedCount}` : ""}`);
  render();
}

async function sendAIMessage() {
  const input = document.getElementById("ai-input");
  const question = input.value.trim();
  if (!question) return;
  const attachment = pendingAttachment;
  aiMessages.push({ role: "user", text: attachment ? `📎 ${attachment.name}\n${question}` : question });
  input.value = "";
  pendingAttachment = null;
  const replyIndex = aiMessages.length;
  aiMessages.push({ role: "assistant", text: "···" });
  render();

  let answer;
  try {
    const result = await Api.askAI(question, attachment);
    answer = result.answer || "Sorry, I could not get an answer just now.";
  } catch (err) {
    answer = "Sorry, I could not reach the AI assistant. Check your connection and try again.";
  }
  await typeOutMessage(replyIndex, answer);
}

// Reveals the AI's reply a few characters at a time so it reads like
// it is being typed live, instead of the full answer appearing at once.
function typeOutMessage(index, fullText) {
  return new Promise((resolve) => {
    const bubble = document.querySelector(`[data-msg-index="${index}"]`);
    let shown = 0;
    const timer = setInterval(() => {
      shown += 2;
      const text = fullText.slice(0, shown);
      aiMessages[index].text = text;
      if (bubble) bubble.textContent = text;
      if (shown >= fullText.length) {
        clearInterval(timer);
        aiMessages[index].text = fullText;
        resolve();
      }
    }, 15);
  });
}

// Records real audio and sends it to Gemini to transcribe, an actual
// AI feature rather than the browser's own built in speech engine.
// Falls back gracefully where microphone access isn't available.
let mediaRecorder = null;
let recordedChunks = [];

async function toggleVoiceInput() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    toast("Voice recording is not supported on this browser");
    return;
  }

  const micBtn = document.getElementById("mic-btn");

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast("Microphone access was blocked or unavailable");
    return;
  }

  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";

  mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop());
    micBtn.classList.remove("mic-active");
    setMicIcon("idle");

    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || mimeType || "audio/webm" });
    if (blob.size === 0) { mediaRecorder = null; return; }

    setMicIcon("loading");
    try {
      const base64 = await blobToBase64(blob);
      const { text } = await Api.transcribeAudio(base64, blob.type);
      if (text) document.getElementById("ai-input").value = text;
      else toast("Didn't catch that, try again");
    } catch (err) {
      toast(err.message || "Could not transcribe that recording");
    }
    setMicIcon("idle");
    mediaRecorder = null;
  };

  mediaRecorder.start();
  micBtn.classList.add("mic-active");
  setMicIcon("recording");
}

function setMicIcon(state) {
  const icon = document.getElementById("mic-icon");
  if (!icon) return;
  if (state === "loading") {
    icon.innerHTML = `<circle cx="12" cy="12" r="3"><animate attributeName="opacity" values="1;0.2;1" dur="1s" repeatCount="indefinite" /></circle>`;
  } else if (state === "recording") {
    icon.innerHTML = `<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"></circle>`;
  } else {
    icon.innerHTML = `
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>`;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------------- SETTINGS VIEW ----------------

async function ViewSettings() {
  const s = USE_SAMPLE_DATA ? sampleSettings : await Api.getSettings();
  shopSettings = s;
  const shops = USE_SAMPLE_DATA ? [] : await Api.listShops();

  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Settings</h1>

    ${!USE_SAMPLE_DATA && shops.length ? `
    <div class="card p-4 mb-4">
      <h2 class="font-display font-bold mb-1">Your shops</h2>
      <p class="text-sm text-ink/50 mb-3">One login, several shops or branches. Switch between them anytime.</p>
      <div class="space-y-2">
        ${shops.map(sh => `
          <div class="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
            <div>
              <div class="font-medium">${sh.shop_name}${String(sh.id) === activeShopId ? " (current)" : ""}</div>
            </div>
            <div class="flex gap-2">
              ${String(sh.id) !== activeShopId ? `<button onclick="switchShop(${sh.id})" class="text-xs bg-primary-light text-primary-dark font-semibold px-3 py-1.5 rounded-full">Switch</button>` : ""}
              <button onclick="duplicateShopFlow(${sh.id})" class="text-xs bg-black/5 font-semibold px-3 py-1.5 rounded-full">Duplicate</button>
              ${!sh.is_owner ? `<button onclick="deleteShopFlow(${sh.id}, '${sh.shop_name.replace(/'/g, "\\'")}')" class="text-xs bg-danger-light text-danger font-semibold px-3 py-1.5 rounded-full">Delete</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
      <button onclick="createShopFlow()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mt-3">+ Create another shop</button>
    </div>
    ` : ""}

    <div class="card p-4 space-y-3">
      <div class="flex items-center gap-3">
        <div id="logo-preview" class="w-14 h-14 rounded-full bg-black/5 bg-cover bg-center flex items-center justify-center text-xl overflow-hidden"
          style="${s.logo_url ? `background-image:url('${s.logo_url}')` : ""}">${s.logo_url ? "" : "🏪"}</div>
        <label class="text-sm font-semibold text-primary cursor-pointer">
          Change logo
          <input type="file" accept="image/*" class="hidden" onchange="onLogoSelected(event)" />
        </label>
      </div>
      <div>
        <label class="text-xs text-ink/50">Business name</label>
        <input id="set-name" value="${s.business_name || ""}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" />
      </div>
      <div>
        <label class="text-xs text-ink/50">Business description</label>
        <input id="set-desc" value="${s.business_description || ""}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" />
      </div>
      <div>
        <label class="text-xs text-ink/50">Currency</label>
        <select id="set-currency" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1 bg-white">
          ${Object.entries(CURRENCIES).map(([code, c]) => `
            <option value="${code}" ${((s.currency_code || "NGN") === code) ? "selected" : ""}>${code} — ${c.symbol} ${c.name}</option>
          `).join("")}
        </select>
      </div>
      <div>
        <label class="text-xs text-ink/50">Default low stock alert</label>
        <input id="set-threshold" type="number" value="${s.default_low_stock_threshold ?? 5}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" />
      </div>
      <button onclick="saveSettings()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mt-2">Save Settings</button>
    </div>

    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Business report</h2>
      <p class="text-sm text-ink/50 mb-3">Download products, sales, and profit as a spreadsheet file.</p>
      <button onclick="downloadReport()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Download report (CSV)</button>
    </div>

    ${!USE_SAMPLE_DATA ? `
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Bulk import</h2>
      <p class="text-sm text-ink/50 mb-3">Already have products, sales, or stock in a spreadsheet? Upload it instead of typing everything in by hand.</p>
      <select id="import-type" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mb-2 bg-white">
        <option value="products">Products (name, selling_price, cost_price, quantity, sku, category, description, low_stock_threshold)</option>
        <option value="sales">Sales history (product_name or sku, quantity, unit_price, unit_cost, sold_at)</option>
        <option value="stock">Stock additions (product_name or sku, quantity_change, note)</option>
      </select>
      <input id="import-file" type="file" accept=".csv,.xlsx,.xls" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mb-2" />
      <p class="text-xs text-ink/40 mb-2">First row must be column headers matching the names above. Products import creates new products, it won't update existing ones. Sales import logs history without changing current stock. Stock import adds to current stock, same as Add Stock.</p>
      <button onclick="runBulkImport()" class="w-full bg-amber text-white font-semibold py-2.5 rounded-xl">Import file</button>
    </div>
    ` : ""}

    ${!USE_SAMPLE_DATA ? `
    ${currentShop?.subscription_status === "trial" ? `
    <div class="card p-4 mt-4">
      <h2 class="font-display font-bold mb-1">Subscription</h2>
      <p class="text-sm text-ink/50 mb-3">You're on the free trial. Subscribe anytime to keep going past it.</p>
      <button onclick="resumePaymentFlow()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Subscribe now</button>
    </div>
    ` : ""}
    <div class="card p-4 space-y-3 mt-4">
      <h2 class="font-display font-bold">Change password</h2>
      ${passwordFieldHtml("cp-current", "Current password")}
      ${passwordFieldHtml("cp-new", "New password")}
      ${passwordFieldHtml("cp-confirm", "Confirm new password")}
      <button onclick="submitChangePassword()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Update Password</button>
    </div>
    <div class="card p-4 space-y-3 mt-4">
      <h2 class="font-display font-bold">Security question</h2>
      <p class="text-sm text-ink/50">This is what unlocks a password reset if you're ever locked out. Update it if you want a different one.</p>
      ${passwordFieldHtml("sq-current-password", "Current password")}
      <input id="sq-question" placeholder="New security question" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
      <input id="sq-answer" placeholder="New answer" class="w-full border border-black/10 rounded-xl px-3 py-2.5" />
      <button onclick="submitUpdateSecurityQuestion()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl">Update Security Question</button>
    </div>
    <button onclick="logout()" class="w-full text-danger font-semibold py-2.5 rounded-xl border border-danger/20 mt-4">Log out</button>
    ` : ""}
  `;
}

async function submitChangePassword() {
  const current = document.getElementById("cp-current").value;
  const next = document.getElementById("cp-new").value;
  const confirm = document.getElementById("cp-confirm").value;

  if (!current || !next) { toast("Fill in both password fields"); return; }
  if (next.length < 6) { toast("New password must be at least 6 characters"); return; }
  if (next !== confirm) { toast("New passwords don't match"); return; }

  try {
    await Api.changePassword(current, next);
    toast("Password updated");
    document.getElementById("cp-current").value = "";
    document.getElementById("cp-new").value = "";
    document.getElementById("cp-confirm").value = "";
  } catch (err) {
    toast(err.message);
  }
}

// ---------------- MULTI SHOP ----------------

function switchShop(id) {
  activeShopId = String(id);
  localStorage.setItem("duka_active_shop_id", activeShopId);
  shopSettings = null;
  toast("Switched shop");
  render();
}

async function createShopFlow() {
  const name = prompt("Name for the new shop:");
  if (!name || !name.trim()) return;
  try {
    const newShop = await Api.createShop(name.trim());
    toast(`${newShop.shop_name} created`);
    switchShop(newShop.id);
  } catch (err) {
    toast(err.message);
  }
}

async function duplicateShopFlow(id) {
  if (!confirm("Duplicate this shop? It copies the product catalog and settings into a brand new shop, starting with zero stock and no sales history.")) return;
  try {
    const newShop = await Api.duplicateShop(id);
    toast(`Duplicated as "${newShop.shop_name}" (${newShop.products_copied} products copied)`);
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteShopFlow(id, name) {
  if (!confirm(`Delete "${name}"? This only works if nothing has been sold or restocked there yet, it's meant for undoing a shop you just created or duplicated by mistake.`)) return;
  try {
    await Api.deleteShop(id);
    if (activeShopId === String(id)) {
      activeShopId = String(currentShop.id);
      localStorage.setItem("duka_active_shop_id", activeShopId);
      shopSettings = null;
    }
    toast(`"${name}" deleted`);
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function submitUpdateSecurityQuestion() {
  const current_password = document.getElementById("sq-current-password").value;
  const security_question = document.getElementById("sq-question").value.trim();
  const security_answer = document.getElementById("sq-answer").value.trim();
  if (!current_password || !security_question || !security_answer) { toast("Fill in all three fields"); return; }

  try {
    await Api.updateSecurityQuestion(current_password, security_question, security_answer);
    toast("Security question updated");
    document.getElementById("sq-current-password").value = "";
    document.getElementById("sq-question").value = "";
    document.getElementById("sq-answer").value = "";
  } catch (err) {
    toast(err.message);
  }
}

// ---------------- BUSINESS REPORT (CSV) ----------------

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

async function downloadReport() {
  try {
    const [products, sales, dashboard] = await Promise.all([
      Api.getProducts(""), Api.getSales("all"), Api.getDashboard(),
    ]);
    const shopName = shopSettings?.business_name || "My Shop";
    const now = new Date();
    const rows = [];

    rows.push(["Duka business report"]);
    rows.push(["Shop", shopName]);
    rows.push(["Generated", now.toLocaleDateString(), now.toLocaleTimeString()]);
    rows.push(["Total products", dashboard.total_products]);
    rows.push(["Units in stock", dashboard.total_stock]);
    rows.push(["Total revenue (all time)", sales.reduce((a, s) => a + s.total_amount, 0)]);
    rows.push(["Total estimated profit (all time)", sales.reduce((a, s) => a + s.estimated_profit, 0)]);
    rows.push([]);

    rows.push(["PRODUCTS"]);
    rows.push(["Name", "Category", "SKU", "Selling price", "Cost price", "Quantity left", "Low stock threshold", "Low stock?"]);
    products.forEach(p => rows.push([
      p.name, p.category, p.sku, p.selling_price, p.cost_price, p.quantity, p.low_stock_threshold,
      p.quantity <= p.low_stock_threshold ? "Yes" : "No",
    ]));
    rows.push([]);

    rows.push(["SALES"]);
    rows.push(["Date", "Time", "Product", "Quantity", "Unit price", "Total", "Estimated profit/loss"]);
    sales.forEach(s => {
      const d = new Date(s.sold_at);
      rows.push([d.toLocaleDateString(), d.toLocaleTimeString(), s.product_name, s.quantity, s.unit_price, s.total_amount, s.estimated_profit]);
    });

    const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${shopName.replace(/[^a-z0-9]+/gi, "-")}-report-${now.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast(err.message || "Could not build the report");
  }
}

// ---------------- BULK IMPORT ----------------

function parseFileToRows(file) {
  return new Promise((resolve, reject) => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (result) => resolve(result.data),
        error: reject,
      });
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target.result, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          resolve(XLSX.utils.sheet_to_json(firstSheet, { defval: "" }));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }
  });
}

// Column names in the file can vary a bit, this maps common
// alternatives onto the fields the Worker actually expects.
const IMPORT_HEADER_ALIASES = {
  product_name: ["product_name", "product", "name"],
  sku: ["sku"],
  category: ["category"],
  description: ["description", "desc"],
  selling_price: ["selling_price", "price", "sale_price"],
  cost_price: ["cost_price", "cost"],
  quantity: ["quantity", "qty", "stock"],
  quantity_change: ["quantity_change", "quantity", "qty", "qty_added"],
  low_stock_threshold: ["low_stock_threshold", "threshold"],
  unit_price: ["unit_price", "price"],
  unit_cost: ["unit_cost", "cost"],
  sold_at: ["sold_at", "date"],
  note: ["note", "supplier"],
};

function mapImportRow(row, fields) {
  const lowerRow = {};
  for (const key in row) lowerRow[key.trim().toLowerCase()] = row[key];

  const mapped = {};
  for (const field of fields) {
    const aliases = IMPORT_HEADER_ALIASES[field] || [field];
    for (const alias of aliases) {
      if (lowerRow[alias] !== undefined && lowerRow[alias] !== "") {
        mapped[field] = lowerRow[alias];
        break;
      }
    }
  }
  return mapped;
}

async function runBulkImport() {
  const type = document.getElementById("import-type").value;
  const fileInput = document.getElementById("import-file");
  const file = fileInput.files[0];
  if (!file) { toast("Choose a file first"); return; }

  try {
    const rawRows = await parseFileToRows(file);
    if (!rawRows.length) { toast("That file has no rows"); return; }

    let rows, result;
    if (type === "products") {
      rows = rawRows.map(r => mapImportRow(r, ["product_name", "sku", "category", "description", "selling_price", "cost_price", "quantity", "low_stock_threshold"]))
        .map(r => ({ name: r.product_name, ...r }));
      result = await Api.importProducts(rows);
    } else if (type === "sales") {
      rows = rawRows.map(r => mapImportRow(r, ["product_name", "sku", "quantity", "unit_price", "unit_cost", "sold_at"]));
      result = await Api.importSales(rows);
    } else {
      rows = rawRows.map(r => mapImportRow(r, ["product_name", "sku", "quantity_change", "note"]));
      result = await Api.importStock(rows);
    }

    toast(`Imported ${result.imported}, skipped ${result.skipped}${result.errors.length ? " (see console for details)" : ""}`);
    if (result.errors.length) console.warn("Import issues:", result.errors);
    fileInput.value = "";
    render();
  } catch (err) {
    toast(err.message || "Could not read that file");
  }
}

let pendingLogoDataUrl = null;

async function onLogoSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    pendingLogoDataUrl = await compressImageToDataUrl(file, 200, 200);
    document.getElementById("logo-preview").style.backgroundImage = `url('${pendingLogoDataUrl}')`;
    document.getElementById("logo-preview").textContent = "";
  } catch (err) {
    toast("Could not read that image, try a different file");
  }
}

async function saveSettings() {
  const currencyCode = document.getElementById("set-currency").value;
  const data = {
    business_name: document.getElementById("set-name").value.trim() || "My Shop",
    business_description: document.getElementById("set-desc").value.trim(),
    currency_code: currencyCode,
    currency_symbol: CURRENCIES[currencyCode]?.symbol || "₦",
    default_low_stock_threshold: parseInt(document.getElementById("set-threshold").value) || 5,
  };
  if (pendingLogoDataUrl) data.logo_url = pendingLogoDataUrl;
  try {
    const updated = await Api.updateSettings(data);
    shopSettings = USE_SAMPLE_DATA ? sampleSettings : updated;
    pendingLogoDataUrl = null;
    toast("Settings saved");
    render();
  } catch (err) {
    toast(err.message);
  }
}

// ---------------- INIT ----------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

window.addEventListener("offline", () => document.getElementById("offline-pill").classList.remove("hidden"));
window.addEventListener("online", () => document.getElementById("offline-pill").classList.add("hidden"));

render();
