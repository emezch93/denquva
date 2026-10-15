const REVERSE_REASONS = ["Sold the wrong item", "Customer returned it", "Wrong quantity or price", "Other"];
let reverseTarget = null;
let reverseUndoTimer = null;

// From the Sales page: the sale the owner has open.
function openReverseSheetById(saleId) {
  const list = typeof lastRenderedSales !== "undefined" ? lastRenderedSales : [];
  const s = list.find(x => x.id === saleId);
  if (!s) return;
  openReverseSheet([{ id: s.id, product_name: s.product_name, quantity: s.quantity, total_amount: s.total_amount }]);
}

// From the receipt right after a sale.
function posReverseFromReceipt() {
  if (posLastReceipt && posLastReceipt.sales && posLastReceipt.sales.length) openReverseSheet(posLastReceipt.sales);
}

function openReverseSheet(sales) {
  if (!sales || !sales.length) return;
  reverseTarget = { sales };
  const total = sales.reduce((n, s) => n + Number(s.total_amount || 0), 0);
  const many = sales.length > 1;
  posOpenSheet(`
    <h2 class="font-display text-xl font-extrabold mb-1">Reverse ${many ? "these sales" : "this sale"}?</h2>
    <p class="text-sm text-ink/50 mb-3">The sale is taken out of your Sales, revenue and profit. A record of it is kept under Sales, Reversed.</p>
    <div class="pos-receipt">
      ${sales.map(s => `<div class="pos-r-row"><span>${Number(s.quantity)} \u00d7 ${escapeHtml(s.product_name || "Item")}</span><span>${formatMoney(s.total_amount)}</span></div>`).join("")}
      ${many ? `<div class="pos-r-row pos-r-total"><span>Total</span><span>${formatMoney(total)}</span></div>` : ""}
    </div>
    <label class="pos-label-row" style="border:0;padding-left:0"><input id="rv-restock" type="checkbox" checked /><span>Put the items back in stock</span></label>
    <label class="text-xs text-ink/50 mt-1 mb-1" style="display:block" for="rv-reason">Why?</label>
    <select id="rv-reason" class="w-full border border-black/10 rounded-xl px-3 py-2.5 bg-white">
      ${REVERSE_REASONS.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("")}
    </select>
    <p class="text-xs text-danger mt-3">If the customer already paid by card or transfer, give them their money back yourself. Denquva cannot send money.</p>
    <div class="flex gap-2 mt-4">
      <button onclick="posCloseSheet()" class="flex-1 py-2.5 rounded-xl border border-black/10 font-semibold">Keep the sale</button>
      <button id="rv-go" onclick="confirmReverse()" class="flex-1 py-2.5 rounded-xl bg-danger text-white font-semibold">Reverse sale</button>
    </div>`);
}

async function confirmReverse() {
  const t = reverseTarget;
  if (!t) return;
  const btn = document.getElementById("rv-go");
  btn.disabled = true;
  btn.textContent = "Reversing";
  const restock = document.getElementById("rv-restock").checked;
  const reason = document.getElementById("rv-reason").value;
  try {
    const r = await Api.reverseSales(t.sales.map(s => s.id), { restock, reason });
    reverseTarget = null;
    posCloseSheet();
    closeModal("sale-detail-modal");
    reverseHideUndoBar();
    const n = r.reversed.length;
    if (n) {
      const stock = r.reversed.some(x => x.restocked) ? "Stock is back." : "Stock was not changed.";
      toast(`Reversed ${n} sale${n === 1 ? "" : "s"}. ${stock}`);
    }
    if (r.skipped.length) toast(r.skipped[0].reason);
    render();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Reverse sale";
    toast(err.message || "Could not reverse the sale");
  }
}

// A short bar with an Undo button, shown for a few seconds after a single
// sale so a wrong tap can be fixed straight away.
function reverseShowUndoBar(sales) {
  reverseHideUndoBar();
  const bar = document.createElement("div");
  bar.id = "undo-bar";
  bar.className = "rv-undo";
  bar.innerHTML = `<span>Sale recorded</span><button onclick="reverseUndoTap()">Undo</button>`;
  bar._sales = sales;
  document.body.appendChild(bar);
  reverseUndoTimer = setTimeout(reverseHideUndoBar, 9000);
}

function reverseUndoTap() {
  const bar = document.getElementById("undo-bar");
  if (!bar) return;
  const sales = bar._sales;
  reverseHideUndoBar();
  openReverseSheet(sales);
}

function reverseHideUndoBar() {
  clearTimeout(reverseUndoTimer);
  const bar = document.getElementById("undo-bar");
  if (bar) bar.remove();
}
