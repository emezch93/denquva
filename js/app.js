const API_BASE = "https://duka-api.emezch93.workers.dev";
const USE_SAMPLE_DATA = true;

const CURRENCY = "₦";

function formatMoney(n) {
  return CURRENCY + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 });
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
  default_low_stock_threshold: 5,
  logo_url: "",
};

// Every real API call goes through this so a failed request always
// throws, instead of the UI quietly treating an error response as
// if it had succeeded.
async function apiJson(res) {
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
    const res = await fetch(`${API_BASE}/api/products?search=${encodeURIComponent(search)}`);
    return apiJson(res);
  },

  async createProduct(data) {
    if (USE_SAMPLE_DATA) {
      const product = { id: nextProductId++, ...data };
      sampleProducts.push(product);
      return product;
    }
    const res = await fetch(`${API_BASE}/api/products`, {
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
    const res = await fetch(`${API_BASE}/api/products/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    return apiJson(res);
  },

  async deleteProduct(id) {
    if (USE_SAMPLE_DATA) {
      sampleProducts = sampleProducts.filter(p => p.id !== id);
      return { success: true };
    }
    const res = await fetch(`${API_BASE}/api/products/${id}`, { method: "DELETE" });
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
    const res = await fetch(`${API_BASE}/api/sales`, {
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
    const res = await fetch(`${API_BASE}/api/stock-movements`, {
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
    const res = await fetch(`${API_BASE}/api/sales?range=${range}`);
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
    const res = await fetch(`${API_BASE}/api/dashboard`);
    return apiJson(res);
  },

  async askAI(question) {
    if (USE_SAMPLE_DATA) {
      return { answer: "The AI assistant will answer using your real sales data once the Worker and AI key are connected. For now this is sample mode." };
    }
    const res = await fetch(`${API_BASE}/api/ai`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }),
    });
    return apiJson(res);
  },

  async generateDescription(name, category, extra) {
    if (USE_SAMPLE_DATA) {
      return { description: `${name} — a reliable ${category.toLowerCase() || "product"} your customers ask for regularly.` };
    }
    const res = await fetch(`${API_BASE}/api/ai/product-description`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, category, extra }),
    });
    return apiJson(res);
  },

  async getSettings() {
    if (USE_SAMPLE_DATA) {
      return sampleSettings;
    }
    const res = await fetch(`${API_BASE}/api/settings`);
    return apiJson(res);
  },

  async updateSettings(data) {
    if (USE_SAMPLE_DATA) {
      Object.assign(sampleSettings, data);
      return sampleSettings;
    }
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    return apiJson(res);
  },
};

// ---------------- APP STATE & ROUTING ----------------

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "products", label: "Products", icon: "🛒" },
  { id: "sales", label: "Sales", icon: "🧾" },
  { id: "ai", label: "AI Assistant", icon: "✨" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

let currentView = "dashboard";

function setView(view) {
  currentView = view;
  render();
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
    <div class="nav-item ${currentView === item.id ? "active" : ""}" onclick="setView('${item.id}')">
      <span>${item.icon}</span><span>${item.label}</span>
    </div>`).join("");
  bottom.innerHTML = NAV_ITEMS.map(item => `
    <div class="bottom-nav-item ${currentView === item.id ? "active" : ""}" onclick="setView('${item.id}')">
      <span class="text-lg">${item.icon}</span><span>${item.label}</span>
    </div>`).join("");
  document.getElementById("mobile-title").textContent = NAV_ITEMS.find(i => i.id === currentView).label;
}

async function render() {
  renderNav();
  const app = document.getElementById("app");
  app.innerHTML = `<div class="py-16 text-center text-ink/40">Loading…</div>`;
  try {
    if (currentView === "dashboard") app.innerHTML = await ViewDashboard();
    if (currentView === "products") app.innerHTML = await ViewProducts();
    if (currentView === "sales") app.innerHTML = await ViewSales();
    if (currentView === "ai") app.innerHTML = await ViewAI();
    if (currentView === "settings") app.innerHTML = await ViewSettings();
  } catch (err) {
    app.innerHTML = `<div class="text-center py-16 text-danger">Something went wrong: ${err.message}</div>`;
  }
}

// ---------------- DASHBOARD VIEW ----------------

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
        <button onclick="openSellModal(${p.id})" class="flex-1 bg-primary text-white font-semibold py-2.5 rounded-xl text-sm">SELL</button>
        <button onclick="openStockModal(${p.id})" class="flex-1 bg-amber-light text-amber-dark font-semibold py-2.5 rounded-xl text-sm">ADD STOCK</button>
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

  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">AI Assistant</h1>
    <div class="card p-4 mb-3 min-h-[50vh] flex flex-col justify-end" id="ai-thread">${bubbles}</div>
    <div class="flex gap-2">
      <button id="mic-btn" onclick="toggleVoiceInput()" title="Speak your question"
        class="w-11 h-11 rounded-full bg-surface border border-black/10 flex items-center justify-center flex-shrink-0 text-lg">🎤</button>
      <input id="ai-input" placeholder="Ask about your business" class="flex-1 border border-black/10 rounded-full px-4 py-2.5"
        onkeydown="if(event.key==='Enter') sendAIMessage()" />
      <button onclick="sendAIMessage()" class="bg-primary text-white font-semibold px-4 py-2.5 rounded-full">Ask</button>
    </div>
  `;
}

async function sendAIMessage() {
  const input = document.getElementById("ai-input");
  const question = input.value.trim();
  if (!question) return;
  aiMessages.push({ role: "user", text: question });
  input.value = "";
  const replyIndex = aiMessages.length;
  aiMessages.push({ role: "assistant", text: "···" });
  render();

  let answer;
  try {
    const result = await Api.askAI(question);
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

// Uses the browser's built in speech recognition, no extra AI voice
// service needed. Falls back gracefully where it is not supported.
let activeRecognition = null;

function toggleVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast("Voice input is not supported on this browser");
    return;
  }
  const micBtn = document.getElementById("mic-btn");
  if (activeRecognition) {
    activeRecognition.stop();
    return;
  }
  activeRecognition = new SpeechRecognition();
  activeRecognition.lang = "en-NG";
  activeRecognition.interimResults = false;
  activeRecognition.maxAlternatives = 1;
  micBtn.classList.add("mic-active");
  micBtn.textContent = "●";

  activeRecognition.onresult = (event) => {
    document.getElementById("ai-input").value = event.results[0][0].transcript;
  };
  activeRecognition.onerror = () => toast("Could not hear that, try again");
  activeRecognition.onend = () => {
    micBtn.classList.remove("mic-active");
    micBtn.textContent = "🎤";
    activeRecognition = null;
  };
  activeRecognition.start();
}

// ---------------- SETTINGS VIEW ----------------

async function ViewSettings() {
  const s = await Api.getSettings();
  return `
    <h1 class="font-display text-2xl font-extrabold hidden md:block mb-4">Settings</h1>
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
        <label class="text-xs text-ink/50">Currency symbol</label>
        <input id="set-currency" value="${s.currency_symbol || "₦"}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" />
      </div>
      <div>
        <label class="text-xs text-ink/50">Default low stock alert</label>
        <input id="set-threshold" type="number" value="${s.default_low_stock_threshold ?? 5}" class="w-full border border-black/10 rounded-xl px-3 py-2.5 mt-1" />
      </div>
      <button onclick="saveSettings()" class="w-full bg-primary text-white font-semibold py-2.5 rounded-xl mt-2">Save Settings</button>
    </div>
  `;
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
  const data = {
    business_name: document.getElementById("set-name").value.trim() || "My Shop",
    business_description: document.getElementById("set-desc").value.trim(),
    currency_symbol: document.getElementById("set-currency").value.trim() || "₦",
    default_low_stock_threshold: parseInt(document.getElementById("set-threshold").value) || 5,
  };
  if (pendingLogoDataUrl) data.logo_url = pendingLogoDataUrl;
  try {
    await Api.updateSettings(data);
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
