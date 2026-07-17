/* DealAmigo customer shop — overview + chat drawer, multi-tenant by ?shop=slug.
   Escalations are written to the shared approval bus (DA) and the chat polls
   for the owner's decision made in the dashboard. */

const RS = "₹";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const slug = new URLSearchParams(location.search).get("shop") || "crossword";
const business = DA.getBusiness(slug) || DA.getBusiness("crossword");

let messages = [];
let deal = freshDeal();
let billNo = null;
let pollTimer = null;

function freshDeal() {
  return { productId: null, quantity: null, stepIndex: 0, status: "negotiating", pendingAskPct: null, agreedPrice: null, holdCount: 0 };
}
const catalogItem = (pid) => (pid ? business.inventory.find((p) => DA.slugify(p.name) === pid) || null : null);

// ---------------- overview page ----------------
function renderOverview() {
  const b = business, p = b.profile;
  const stars = "★".repeat(Math.round(b.rating || 5)) + "☆".repeat(5 - Math.round(b.rating || 5));
  $("shopMain").innerHTML = `
    <section class="shop-hero-card">
      <div class="shop-logo-lg">${b.logo || "🏪"}</div>
      <div class="shop-hero-info">
        <div class="shop-cat-pill">${esc(b.category || "")}</div>
        <h1>${esc(p.business_name)}</h1>
        <p class="shop-tag">${esc(p.tagline || "")}</p>
        <div class="shop-meta-row">
          <span class="rating">${stars} <b>${b.rating || 5}</b></span>
          <span>📍 ${esc(p.address || "")}</span>
        </div>
      </div>
      <button class="btn btn-green btn-lg cta-chat" id="openChatTop">💬 Chat with us</button>
    </section>

    <section class="shop-about">
      <div class="section-label">About</div>
      <p>${esc(b.about || "")}</p>
    </section>

    <section class="shop-products">
      <div class="section-label">What we sell</div>
      <div class="prod-grid">
        ${b.inventory.map((it) => `
          <div class="prod-card">
            <div class="prod-name">${esc(it.name)}</div>
            <div class="prod-price">${RS}${Number(it.list_price)} <span>/ ${esc(it.unit || "piece")}</span></div>
            <div class="prod-bulk">Bulk deals from ${Number(it.moq || 1)}+ — negotiate in chat</div>
          </div>`).join("")}
      </div>
    </section>

    <div class="shop-cta-strip">
      <div><b>Need a bulk rate?</b><span>Chat with the AI agent and negotiate in your own language.</span></div>
      <button class="btn btn-green btn-lg" id="openChatBottom">💬 Chat with us</button>
    </div>`;
  $("openChatTop").onclick = openChat;
  $("openChatBottom").onclick = openChat;
}

// ---------------- chat drawer ----------------
function openChat() {
  $("chatDrawer").classList.remove("hidden");
  $("chatScrim").classList.remove("hidden");
  $("cdAvatar").textContent = (business.profile.business_name[0] || "S").toUpperCase();
  $("cdName").textContent = business.profile.business_name;
  if (!messages.length) renderChatFresh();
  setTimeout(() => $("chatText").focus(), 50);
}
function closeChat() {
  $("chatDrawer").classList.add("hidden");
  $("chatScrim").classList.add("hidden");
}
$("cdClose").onclick = closeChat;
$("chatScrim").onclick = closeChat;

function addBubble(role, text) {
  const row = document.createElement("div");
  row.className = `chat-row ${role}`;
  const who = role === "customer" ? "You" : business.profile.business_name;
  row.innerHTML = `<div class="bubble ${role}"><div class="who">${esc(who)}</div>${esc(text).replace(/\n/g, "<br>")}</div>`;
  $("chatLog").appendChild(row);
  $("chatScroll").scrollTop = $("chatScroll").scrollHeight;
}
function renderChatFresh() {
  $("chatLog").innerHTML = "";
  addBubble("agent", `Namaste! Welcome to ${business.profile.business_name}. Tell me what you need — any language works.`);
}

function setLocked(locked) {
  $("chatText").disabled = locked;
  $("chatForm").querySelector("button").disabled = locked;
}

async function api(op, extra) {
  const body = Object.assign({ op, business: { profile: business.profile, inventory: business.inventory }, messages, state: deal }, extra || {});
  const resp = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("chatText").value.trim();
  if (!text || deal.status !== "negotiating") return;
  $("chatText").value = "";
  messages.push({ role: "customer", text });
  addBubble("customer", text);
  $("typing").classList.remove("hidden");
  $("chatScroll").scrollTop = $("chatScroll").scrollHeight;
  try {
    const out = await api("turn");
    deal = out.state;
    messages.push({ role: "agent", text: out.reply });
    addBubble("agent", out.reply);
    if (deal.status === "pending_approval") enterPendingApproval();
    if (deal.status === "closed") recordAndShowDone();
  } catch (err) {
    addBubble("agent", `(connection hiccup — please resend)`);
  } finally {
    $("typing").classList.add("hidden");
  }
});

// ---------------- escalation → owner dashboard bus ----------------
function enterPendingApproval() {
  setLocked(true);
  $("approvalWait").classList.remove("hidden");
  const p = catalogItem(deal.productId);
  DA.setPending(slug, {
    business_name: business.profile.business_name,
    messages, state: deal,
    product: p ? p.name : null, quantity: deal.quantity, askPct: deal.pendingAskPct,
    createdAt: Date.now(), decision: null, reply: null,
  });
  pollTimer = setInterval(checkDecision, 1500);
}

async function checkDecision() {
  const rec = DA.getPending(slug);
  if (!rec) { // cleared elsewhere
    clearInterval(pollTimer); return;
  }
  if (rec.decision) {
    clearInterval(pollTimer);
    $("approvalWait").classList.add("hidden");
    // The dashboard already ran the model and stored the reply + updated state.
    deal = rec.state;
    if (rec.reply) { messages.push({ role: "agent", text: rec.reply }); addBubble("agent", rec.reply); }
    DA.clearPending(slug);
    if (deal.status === "closed") recordAndShowDone();
    else setLocked(false);
  }
}

// ---------------- order done: receipt + whatsapp ----------------
function recordAndShowDone() {
  const p = catalogItem(deal.productId);
  billNo = makeBillNo();
  DA.addDeal(slug, {
    bill_no: billNo, closed_at: new Date().toISOString().slice(0, 19),
    product: p ? p.name : "item", quantity: deal.quantity, unit_price: deal.agreedPrice,
    list_price: p ? p.list_price : deal.agreedPrice,
    discount_pct: p ? Math.round((1 - deal.agreedPrice / p.list_price) * 1000) / 10 : 0,
    total: Math.round((deal.agreedPrice || 0) * (deal.quantity || 0) * 100) / 100,
  });
  renderOrderDone();
}
function makeBillNo() {
  const prefix = business.profile.business_name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "DA";
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function billHTML() {
  const prof = business.profile, p = catalogItem(deal.productId);
  const qty = deal.quantity || 0, rate = deal.agreedPrice || 0;
  const list = p ? Number(p.list_price) : rate, total = Math.round(qty * rate * 100) / 100;
  const disc = list ? Math.round((1 - rate / list) * 1000) / 10 : 0;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${billNo}</title><style>
    html{background:#fff}body{font-family:Georgia,serif;color:#222;max-width:680px;margin:36px auto;padding:0 22px;background:#fff}
    .lh{text-align:center;border-bottom:3px double #0e5c46;padding-bottom:12px}.lh h1{margin:0;font-size:28px;letter-spacing:5px;color:#0e5c46}
    .lh .tg{font-style:italic;color:#555;margin:4px 0}.lh .ct{font-size:12px;color:#666}
    .meta{display:flex;justify-content:space-between;margin:20px 0 8px;font-size:14px}h2{font-size:15px;letter-spacing:2px;color:#0e5c46;margin:16px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:14px}th{background:#0e5c46;color:#fff;padding:8px 10px;text-align:left}
    td{border-bottom:1px solid #ddd;padding:8px 10px}.num{text-align:right}.tot td{border-top:2px solid #0e5c46;border-bottom:none;font-weight:bold;font-size:16px}
    .note{font-size:12px;color:#666;margin-top:10px}.sign{margin-top:44px;text-align:right;font-size:13px}
    .sign .line{display:inline-block;border-top:1px solid #444;padding-top:4px;width:190px;text-align:center}
    .foot{margin-top:32px;text-align:center;font-size:12px;color:#888;border-top:1px solid #ddd;padding-top:12px}</style></head><body>
    <div class="lh"><h1>${esc(prof.business_name)}</h1><div class="tg">${esc(prof.tagline || "")}</div>
    <div class="ct">${esc(prof.address || "")}<br>${esc(prof.phone || "")} · ${esc(prof.email || "")}</div></div>
    <div class="meta"><div><b>Bill No:</b> ${billNo}</div><div><b>Date:</b> ${new Date().toLocaleString("en-IN")}</div></div>
    <h2>RECEIPT</h2><table><tr><th>Item</th><th class="num">Qty</th><th class="num">List</th><th class="num">Agreed rate</th><th class="num">Amount</th></tr>
    <tr><td>${esc(p ? p.name : "item")}</td><td class="num">${qty}</td><td class="num">${RS}${list.toFixed(2)}</td><td class="num">${RS}${rate.toFixed(2)}</td><td class="num">${RS}${total.toFixed(2)}</td></tr>
    <tr class="tot"><td colspan="4">Grand Total</td><td class="num">${RS}${total.toFixed(2)}</td></tr></table>
    <div class="note">Negotiated discount: ${disc}% off list price.</div>
    <div class="sign"><span class="line">Authorised Signatory<br>${esc(prof.business_name)}</span></div>
    <div class="foot">Computer-generated receipt issued by the ${esc(prof.business_name)} sales agent (DealAmigo).<br>Thank you for your business!</div></body></html>`;
}
function renderOrderDone() {
  setLocked(true);
  const p = catalogItem(deal.productId);
  const total = Math.round((deal.agreedPrice || 0) * (deal.quantity || 0) * 100) / 100;
  const wa = (business.profile.whatsapp || "").replace(/\D/g, "");
  const rzpKey = (business.profile.razorpay_key_id || "").trim();
  const line = `Order ${billNo}: ${deal.quantity} x ${p ? p.name : "item"} @ ${RS}${deal.agreedPrice} = ${RS}${total}`;
  const dMsg = encodeURIComponent(`Hello ${business.profile.business_name}! ${line}. I'd like HOME DELIVERY please. My address: `);
  const pMsg = encodeURIComponent(`Hello ${business.profile.business_name}! ${line}. I'll PICK UP from the store. When can I collect it?`);
  const el = $("orderDone");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="od-title">✅ Order confirmed</div>
    <div class="od-sub">${deal.quantity} × ${RS}${deal.agreedPrice}${p ? " — " + esc(p.name) : ""} = <b>${RS}${total.toLocaleString("en-IN")}</b></div>
    <div id="payStatus"></div>
    <div class="od-actions">
      <button class="btn btn-green" id="btnPay">💳 Pay now</button>
      <button class="btn btn-outline" id="btnBill">View receipt</button>
      ${wa ? `<a class="btn btn-outline" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${dMsg}">Get it delivered</a>
      <a class="btn btn-amber" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${pMsg}">Pick up at store</a>` : ""}
      <button class="btn btn-outline" id="btnNew">New order</button>
    </div>`;
  $("btnBill").onclick = () => { const w = window.open("", "_blank"); w.document.write(billHTML()); w.document.close(); };
  $("btnNew").onclick = () => { messages = []; deal = freshDeal(); billNo = null; $("orderDone").classList.add("hidden"); setLocked(false); renderChatFresh(); };
  $("btnPay").onclick = () => payNow(total);
}

function payNow(total) {
  const rzpKey = (business.profile.razorpay_key_id || "").trim();
  const status = $("payStatus");
  if (!rzpKey || typeof Razorpay === "undefined") {
    status.innerHTML = `<div class="pay-note">Online payment isn't enabled for this shop yet — use WhatsApp to arrange payment, or pay on delivery/pickup.</div>`;
    return;
  }
  const rzp = new Razorpay({
    key: rzpKey,
    amount: Math.round(total * 100), // paise
    currency: "INR",
    name: business.profile.business_name,
    description: `Order ${billNo}`,
    notes: { bill_no: billNo, shop: slug },
    theme: { color: "#0e5c46" },
    handler: (response) => {
      status.innerHTML = `<div class="pay-note ok">✅ Payment received — ref ${esc(response.razorpay_payment_id)}. Thank you!</div>`;
      DA.markPaid(slug, billNo, response.razorpay_payment_id);
    },
    modal: { ondismiss: () => { status.innerHTML = ""; } },
  });
  rzp.on("payment.failed", (resp) => {
    status.innerHTML = `<div class="pay-note bad">Payment failed: ${esc(resp.error?.description || "please try again")}.</div>`;
  });
  rzp.open();
}

// ---------------- boot ----------------
document.title = business.profile.business_name + " · DealAmigo";
renderOverview();
if (new URLSearchParams(location.search).get("chat") === "1") openChat();
