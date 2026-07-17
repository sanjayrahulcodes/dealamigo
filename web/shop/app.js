/* DealAmigo frontend — customer chat + PIN-gated owner console.
   Business config and deal history persist in localStorage; the deal state
   machine itself lives server-side in /api/chat. */

const RS = "₹";
const LS_BIZ = "dealamigo_business";
const LS_DEALS = "dealamigo_deals";

const DEFAULT_BUSINESS = {
  profile: {
    business_name: "CROSSWORD",
    tagline: "Books · Stationery · Office Supplies",
    address: "Shop No. 12, Main Bazaar Road, Hyderabad — 500001",
    phone: "+91 98765 43210",
    email: "orders@crossword.example",
    whatsapp: "919876543210",
    pin: "1234",
    max_discount_pct: 15,
    small_order_min: 5,
    big_order_threshold: 15000,
    api_key: "",
  },
  inventory: [
    { name: "Long Notebook 200 pages (single line)", unit: "piece", list_price: 60, max_discount_pct: 15, moq: 10, stock: 500, pitch: "Thick 58 GSM paper, no ink bleed, hard cover. Schools buy in bulk." },
    { name: "Blue Ball Pen (0.7mm)", unit: "piece", list_price: 10, max_discount_pct: 15, moq: 20, stock: 1000, pitch: "Smooth-writing branded pen, fresh stock. Offices order monthly." },
    { name: "HB Pencil (dark lead)", unit: "piece", list_price: 5, max_discount_pct: 12, moq: 30, stock: 800, pitch: "Dark smooth lead, doesn't break on sharpening." },
    { name: "A4 Copier Paper 75 GSM (500-sheet ream)", unit: "ream", list_price: 280, max_discount_pct: 10, moq: 3, stock: 120, pitch: "Jam-free in all printers, bright white." },
  ],
};

// ---------- state ----------
let business = loadBusiness();
let messages = [];
let deal = freshDeal();
let billNo = null;

function freshDeal() {
  return { productId: null, quantity: null, stepIndex: 0, status: "negotiating", pendingAskPct: null, agreedPrice: null };
}
function loadBusiness() {
  try {
    const raw = localStorage.getItem(LS_BIZ);
    if (raw) {
      const b = JSON.parse(raw);
      b.profile = Object.assign({}, DEFAULT_BUSINESS.profile, b.profile || {});
      b.inventory = b.inventory && b.inventory.length ? b.inventory : DEFAULT_BUSINESS.inventory;
      return b;
    }
  } catch (e) { /* fall through */ }
  return JSON.parse(JSON.stringify(DEFAULT_BUSINESS));
}
function saveBusiness() { localStorage.setItem(LS_BIZ, JSON.stringify(business)); }
function loadDeals() { try { return JSON.parse(localStorage.getItem(LS_DEALS) || "[]"); } catch { return []; } }
function saveDeal(record) { const d = loadDeals(); d.unshift(record); localStorage.setItem(LS_DEALS, JSON.stringify(d)); }

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- customer view ----------
function renderShopHeader() {
  $("c-shop-name").textContent = business.profile.business_name;
  $("c-shop-tagline").textContent = business.profile.tagline || "";
  $("b-shop-name").textContent = business.profile.business_name;
}

function renderProducts() {
  const strip = $("product-strip");
  strip.innerHTML = "";
  for (const p of business.inventory) {
    if (!p.name || !p.list_price) continue;
    const el = document.createElement("div");
    el.className = "product-chip";
    el.innerHTML = `<div class="p-name">${esc(p.name)}</div>
      <div class="p-price">${RS}${Number(p.list_price)} <span style="font-size:0.7rem;color:var(--muted);font-family:Inter">/ ${esc(p.unit || "piece")}</span></div>
      <div class="p-bulk">Bulk deals from ${Number(p.moq || 1)}+ — ask in chat</div>`;
    strip.appendChild(el);
  }
}

function addBubble(role, text) {
  const row = document.createElement("div");
  row.className = `chat-row ${role}`;
  const who = role === "customer" ? "You" : business.profile.business_name;
  row.innerHTML = `<div class="bubble ${role}"><div class="who">${esc(who)}</div>${esc(text).replace(/\n/g, "<br>")}</div>`;
  $("chat-log").appendChild(row);
  $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
}

function renderChatFresh() {
  $("chat-log").innerHTML = "";
  if (!messages.length) {
    addBubble("agent", `Namaste! Welcome to ${business.profile.business_name}. Tell me what you need — any language works.`);
  }
  for (const m of messages) addBubble(m.role, m.text);
  syncStatusUI();
}

function syncStatusUI() {
  const pending = deal.status === "pending_approval";
  const closed = deal.status === "closed";
  $("approval-wait").classList.toggle("hidden", !pending);
  $("chat-text").disabled = pending || closed;
  $("chat-form").querySelector("button").disabled = pending || closed;
  $("appr-badge").classList.toggle("hidden", !pending);
  renderApprovalCard();
  if (closed) renderOrderDone(); else $("order-done").classList.add("hidden");
}

function catalogItem(pid) {
  if (!pid) return null;
  const slugify = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return business.inventory.find(p => slugify(p.name) === pid) || null;
}

async function api(op) {
  const body = {
    op, business: { profile: business.profile, inventory: business.inventory },
    messages, state: deal, clientKey: business.profile.api_key || undefined,
  };
  const resp = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

$("chat-form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("chat-text").value.trim();
  if (!text || deal.status !== "negotiating") return;
  $("chat-text").value = "";
  messages.push({ role: "customer", text });
  addBubble("customer", text);
  $("typing").classList.remove("hidden");
  $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
  try {
    const out = await api("turn");
    deal = out.state;
    messages.push({ role: "agent", text: out.reply });
    addBubble("agent", out.reply);
    if (deal.status === "closed") recordDeal();
  } catch (err) {
    addBubble("agent", `(connection hiccup: ${err.message} — please resend)`);
  } finally {
    $("typing").classList.add("hidden");
    syncStatusUI();
  }
});

// ---------- order done: receipt + whatsapp ----------
function recordDeal() {
  const p = catalogItem(deal.productId);
  billNo = makeBillNo();
  saveDeal({
    bill_no: billNo, closed_at: new Date().toISOString().slice(0, 19),
    product: p ? p.name : "item", quantity: deal.quantity,
    unit_price: deal.agreedPrice,
    total: Math.round((deal.agreedPrice || 0) * (deal.quantity || 0) * 100) / 100,
  });
}

function makeBillNo() {
  const prefix = business.profile.business_name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "DA";
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function billHTML() {
  const prof = business.profile;
  const p = catalogItem(deal.productId);
  const qty = deal.quantity || 0, rate = deal.agreedPrice || 0;
  const list = p ? Number(p.list_price) : rate;
  const total = Math.round(qty * rate * 100) / 100;
  const disc = list ? Math.round((1 - rate / list) * 1000) / 10 : 0;
  const now = new Date();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${billNo}</title><style>
    html{background:#fff}body{font-family:Georgia,serif;color:#222;max-width:680px;margin:36px auto;padding:0 22px;background:#fff}
    .lh{text-align:center;border-bottom:3px double #0e5c46;padding-bottom:12px}
    .lh h1{margin:0;font-size:28px;letter-spacing:5px;color:#0e5c46}
    .lh .tg{font-style:italic;color:#555;margin:4px 0}.lh .ct{font-size:12px;color:#666}
    .meta{display:flex;justify-content:space-between;margin:20px 0 8px;font-size:14px}
    h2{font-size:15px;letter-spacing:2px;color:#0e5c46;margin:16px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th{background:#0e5c46;color:#fff;padding:8px 10px;text-align:left}
    td{border-bottom:1px solid #ddd;padding:8px 10px}.num{text-align:right}
    .tot td{border-top:2px solid #0e5c46;border-bottom:none;font-weight:bold;font-size:16px}
    .note{font-size:12px;color:#666;margin-top:10px}
    .sign{margin-top:44px;text-align:right;font-size:13px}
    .sign .line{display:inline-block;border-top:1px solid #444;padding-top:4px;width:190px;text-align:center}
    .foot{margin-top:32px;text-align:center;font-size:12px;color:#888;border-top:1px solid #ddd;padding-top:12px}
  </style></head><body>
  <div class="lh"><h1>${esc(prof.business_name)}</h1><div class="tg">${esc(prof.tagline || "")}</div>
  <div class="ct">${esc(prof.address || "")}<br>${esc(prof.phone || "")} · ${esc(prof.email || "")}</div></div>
  <div class="meta"><div><b>Bill No:</b> ${billNo}</div><div><b>Date:</b> ${now.toLocaleString("en-IN")}</div></div>
  <h2>RECEIPT</h2>
  <table><tr><th>Item</th><th class="num">Qty</th><th class="num">List</th><th class="num">Agreed rate</th><th class="num">Amount</th></tr>
  <tr><td>${esc(p ? p.name : "item")}</td><td class="num">${qty}</td><td class="num">${RS}${list.toFixed(2)}</td>
  <td class="num">${RS}${rate.toFixed(2)}</td><td class="num">${RS}${total.toFixed(2)}</td></tr>
  <tr class="tot"><td colspan="4">Grand Total</td><td class="num">${RS}${total.toFixed(2)}</td></tr></table>
  <div class="note">Negotiated discount: ${disc}% off list price.</div>
  <div class="sign"><span class="line">Authorised Signatory<br>${esc(prof.business_name)}</span></div>
  <div class="foot">Computer-generated receipt issued by the ${esc(prof.business_name)} sales agent (DealAmigo).<br>Thank you for your business!</div>
  </body></html>`;
}

function renderOrderDone() {
  const p = catalogItem(deal.productId);
  const total = Math.round((deal.agreedPrice || 0) * (deal.quantity || 0) * 100) / 100;
  const wa = (business.profile.whatsapp || "").replace(/\D/g, "");
  const orderLine = `Order ${billNo}: ${deal.quantity} x ${p ? p.name : "item"} @ ${RS}${deal.agreedPrice} = ${RS}${total}`;
  const dMsg = encodeURIComponent(`Hello ${business.profile.business_name}! ${orderLine}. I would like HOME DELIVERY please. My address: `);
  const pMsg = encodeURIComponent(`Hello ${business.profile.business_name}! ${orderLine}. I will PICK UP from the store. When can I collect it?`);
  const el = $("order-done");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="od-title">Order confirmed</div>
    <div class="od-sub">${deal.quantity} × ${RS}${deal.agreedPrice}${p ? " — " + esc(p.name) : ""} = <b>${RS}${total.toLocaleString("en-IN")}</b></div>
    <div class="od-actions">
      <button class="btn ghost" id="btn-bill">View receipt</button>
      ${wa ? `<a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${dMsg}">Get it delivered</a>
      <a class="btn amber" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${pMsg}">Pick up at store</a>` : ""}
      <button class="btn ghost" id="btn-new">New order</button>
    </div>`;
  $("btn-bill").onclick = () => {
    const w = window.open("", "_blank");
    w.document.write(billHTML());
    w.document.close();
  };
  $("btn-new").onclick = () => { messages = []; deal = freshDeal(); billNo = null; renderChatFresh(); };
}

// ---------- owner console ----------
$("owner-link").onclick = () => { $("pin-modal").classList.remove("hidden"); $("pin-input").value = ""; $("pin-error").classList.add("hidden"); $("pin-input").focus(); };
$("pin-cancel").onclick = () => $("pin-modal").classList.add("hidden");
$("pin-submit").onclick = tryPin;
$("pin-input").addEventListener("keydown", e => { if (e.key === "Enter") tryPin(); });

function tryPin() {
  if ($("pin-input").value === String(business.profile.pin || "1234")) {
    $("pin-modal").classList.add("hidden");
    openConsole();
  } else {
    $("pin-error").classList.remove("hidden");
  }
}

function openConsole() {
  $("customer-view").classList.add("hidden");
  $("business-view").classList.remove("hidden");
  renderApprovalCard(); renderInventory(); renderProfileForm(); renderDeals();
}
$("exit-console").onclick = () => {
  $("business-view").classList.add("hidden");
  $("customer-view").classList.remove("hidden");
  renderShopHeader(); renderProducts(); renderChatFresh();
};

document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
  $(`tab-${t.dataset.tab}`).classList.remove("hidden");
});

// approvals
function renderApprovalCard() {
  const box = $("approval-card");
  if (!box) return;
  if (deal.status !== "pending_approval") {
    box.innerHTML = `<p class="muted">No deals waiting. When a customer asks for more than your limits allow, it lands here with the exact numbers.</p>`;
    return;
  }
  const p = catalogItem(deal.productId);
  const ask = deal.pendingAskPct;
  let detail = ask != null ? `Customer wants about <b>${ask}% off</b>` : "Customer request is outside the agent's authority";
  if (p) {
    const askPrice = ask != null ? Math.round(p.list_price * (1 - ask / 100) * 100) / 100 : null;
    detail += ` on <b>${esc(p.name)}</b> (list ${RS}${p.list_price})`;
    if (askPrice != null && deal.quantity) {
      detail += `.<br>Approving sells at <b>${RS}${askPrice}/pc</b> × ${deal.quantity} = <b>${RS}${(askPrice * deal.quantity).toLocaleString("en-IN")}</b>`;
    }
  }
  if (deal.quantity) detail += `. Quantity: <b>${deal.quantity}</b>.`;
  box.innerHTML = `<div class="approval-box">
    <div class="a-title">Deal waiting for your decision</div>
    <div class="a-detail">${detail}</div>
    <div class="approval-actions">
      <button class="btn primary" id="ap-yes">Approve deal</button>
      <button class="btn danger" id="ap-no">Reject — hold floor price</button>
    </div>
    <div class="a-transcript">${messages.map(m => `<div><b>${m.role === "customer" ? "Customer" : "Agent"}:</b> ${esc(m.text)}</div>`).join("")}</div>
  </div>`;
  $("ap-yes").onclick = () => decide("approve");
  $("ap-no").onclick = () => decide("reject");
}

async function decide(op) {
  const box = $("approval-card");
  box.innerHTML = `<p class="muted">Agent is replying to the customer…</p>`;
  try {
    const out = await api(op);
    deal = out.state;
    messages.push({ role: "agent", text: out.reply });
    if (deal.status === "closed") recordDeal();
    renderDeals();
    box.innerHTML = `<p class="muted">Done — the agent has replied to the customer. Exit the console to see the chat.</p>`;
    $("appr-badge").classList.add("hidden");
  } catch (err) {
    box.innerHTML = `<p class="muted">Error: ${esc(err.message)}</p>`;
  }
}

// inventory
function renderInventory() {
  const tbody = $("inv-table").querySelector("tbody");
  tbody.innerHTML = "";
  business.inventory.forEach((p, i) => tbody.appendChild(invRow(p, i)));
}
function invRow(p) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="col-name"><input value="${esc(p.name || "")}" data-k="name"></td>
    <td><input value="${esc(p.unit || "piece")}" data-k="unit" size="6"></td>
    <td><input type="number" min="0" step="0.5" value="${p.list_price ?? ""}" data-k="list_price"></td>
    <td><input type="number" min="0" max="90" value="${p.max_discount_pct ?? 0}" data-k="max_discount_pct"></td>
    <td><input type="number" min="1" value="${p.moq ?? 1}" data-k="moq"></td>
    <td><input type="number" min="0" value="${p.stock ?? 0}" data-k="stock"></td>
    <td class="col-pitch"><input value="${esc(p.pitch || "")}" data-k="pitch"></td>
    <td><button class="inv-del" title="Remove">✕</button></td>`;
  tr.querySelector(".inv-del").onclick = () => tr.remove();
  return tr;
}
$("inv-add").onclick = () => $("inv-table").querySelector("tbody").appendChild(invRow({ unit: "piece", max_discount_pct: 0, moq: 1, stock: 0 }));
$("inv-save").onclick = () => {
  const rows = [...$("inv-table").querySelectorAll("tbody tr")].map(tr => {
    const o = {};
    tr.querySelectorAll("input[data-k]").forEach(inp => {
      o[inp.dataset.k] = inp.type === "number" ? Number(inp.value || 0) : inp.value.trim();
    });
    return o;
  }).filter(o => o.name && o.list_price > 0);
  business.inventory = rows;
  saveBusiness();
  renderProducts();
  $("inv-saved").classList.remove("hidden");
  setTimeout(() => $("inv-saved").classList.add("hidden"), 2500);
};

// profile
function renderProfileForm() {
  const f = business.profile;
  $("f-name").value = f.business_name; $("f-tagline").value = f.tagline || "";
  $("f-address").value = f.address || ""; $("f-phone").value = f.phone || "";
  $("f-email").value = f.email || ""; $("f-whatsapp").value = f.whatsapp || "";
  $("f-pin").value = f.pin || "1234"; $("f-maxdisc").value = f.max_discount_pct;
  $("f-smallmin").value = f.small_order_min; $("f-bigmax").value = f.big_order_threshold;
  $("f-apikey").value = f.api_key || "";
}
$("prof-save").onclick = () => {
  const f = business.profile;
  f.business_name = $("f-name").value.trim() || "My Shop";
  f.tagline = $("f-tagline").value.trim();
  f.address = $("f-address").value.trim();
  f.phone = $("f-phone").value.trim();
  f.email = $("f-email").value.trim();
  f.whatsapp = $("f-whatsapp").value.replace(/\D/g, "");
  f.pin = $("f-pin").value.trim() || "1234";
  f.max_discount_pct = Number($("f-maxdisc").value || 0);
  f.small_order_min = Number($("f-smallmin").value || 5);
  f.big_order_threshold = Number($("f-bigmax").value || 15000);
  f.api_key = $("f-apikey").value.trim();
  saveBusiness();
  renderShopHeader();
  $("prof-saved").classList.remove("hidden");
  setTimeout(() => $("prof-saved").classList.add("hidden"), 2500);
};

// deals
function renderDeals() {
  const list = $("deals-list");
  const deals = loadDeals();
  list.innerHTML = deals.length ? "" : `<p class="muted">No closed deals yet — they'll appear here after the first sale.</p>`;
  for (const d of deals) {
    const row = document.createElement("div");
    row.className = "deal-row";
    row.innerHTML = `<span>${esc(d.closed_at || "").replace("T", " ")}</span>
      <span>${esc(d.product || "")} × ${d.quantity}</span>
      <span>@ ${RS}${d.unit_price}</span>
      <span class="d-total">${RS}${Number(d.total).toLocaleString("en-IN")}</span>`;
    list.appendChild(row);
  }
}

// ---------- boot ----------
renderShopHeader();
renderProducts();
renderChatFresh();
