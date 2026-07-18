/* DealAmigo owner dashboard — analytics, transactions, live approvals,
   floor/settings, and add-business. Business + deal data come from the shared
   Supabase-backed data layer (window.DA); auth/session from auth.js. */
import { requireAuth, getSession, signOut } from "./auth.js";

const RS = "₹";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => Number(n || 0).toLocaleString("en-IN");

let ownerId = null;
let businesses = [];
let active = null; // active business slug
let apprPollTimer = null;

// ---------------- boot ----------------
(async function boot() {
  const session = await requireAuth(""); // bounce to login if not signed in
  if (session) ownerId = session.user.id;
  $("logout").addEventListener("click", (e) => { e.preventDefault(); signOut(""); });
  wireChrome();
  $("tab-overview").innerHTML = `<p class="muted">Loading your businesses…</p>`;
  await loadBusinesses();
  await render();
  apprPollTimer = setInterval(refreshApprovalsBadge, 3000);
})();

async function loadBusinesses() {
  try {
    businesses = await DA.businessesForOwner(ownerId);
  } catch (e) {
    businesses = [];
  }
  if (!businesses.length) businesses = DA.SEED.slice();
  if (!active || !businesses.find((b) => b.slug === active)) active = businesses[0].slug;
  const sel = $("bizSelect");
  sel.innerHTML = businesses.map((b) => `<option value="${b.slug}">${esc(b.profile.business_name)}</option>`).join("");
  sel.value = active;
}
const activeBiz = () => businesses.find((b) => b.slug === active);

function wireChrome() {
  $("bizSelect").addEventListener("change", async (e) => { active = e.target.value; await render(); });
  document.querySelectorAll(".dtab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".dtab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".dpanel").forEach((p) => p.classList.add("hidden"));
    $("tab-" + t.dataset.tab).classList.remove("hidden");
  }));
  $("addBizBtn").addEventListener("click", openAddModal);
  $("nbCancel").addEventListener("click", () => $("addModal").classList.add("hidden"));
  $("nbAddRow").addEventListener("click", () => addProdRow());
  $("nbSave").addEventListener("click", saveNewBusiness);
}

async function render() {
  renderOverview();
  renderTransactions();
  await renderApprovals();
  renderSettings();
  await refreshApprovalsBadge();
}

// ---------------- overview / analytics ----------------
async function renderOverview() {
  const b = activeBiz();
  $("tab-overview").innerHTML = `<p class="muted">Loading analytics…</p>`;
  const a = await DA.analytics(active);
  const pending = (await DA.listPendingApprovals()).filter((r) => r.slug === active).length;
  const maxDay = Math.max(1, ...a.days.map((d) => d.total));
  $("tab-overview").innerHTML = `
    <div class="dhead">
      <div><h1>${esc(b.profile.business_name)}</h1><p class="muted">${esc(b.category)} · ${esc(b.profile.tagline || "")}</p></div>
    </div>
    <div class="kpi-row">
      ${kpi("Revenue (logged)", RS + inr(Math.round(a.revenue)), "💰")}
      ${kpi("Orders closed", a.orders, "📦")}
      ${kpi("Avg discount", a.avgDisc.toFixed(1) + "%", "🏷️")}
      ${kpi("Pending approvals", pending, pending ? "⚠️" : "✅")}
    </div>
    <div class="dgrid">
      <div class="dcard">
        <div class="dcard-title">Revenue · last 7 days</div>
        <div class="bars">
          ${a.days.map((d) => `<div class="bar-col"><div class="bar" style="height:${Math.round((d.total / maxDay) * 100)}%" title="${RS}${inr(Math.round(d.total))}"></div><span>${d.label}</span></div>`).join("")}
        </div>
      </div>
      <div class="dcard">
        <div class="dcard-title">Top products by revenue</div>
        <div class="toplist">
          ${a.topProducts.length ? a.topProducts.map((p) => {
            const w = Math.round((p.total / a.topProducts[0].total) * 100);
            return `<div class="toprow"><div class="topname">${esc(p.name)}</div><div class="topbar"><div style="width:${w}%"></div></div><div class="topval">${RS}${inr(Math.round(p.total))}</div></div>`;
          }).join("") : `<p class="muted">No sales yet.</p>`}
        </div>
      </div>
    </div>`;
}
const kpi = (label, val, ic) => `<div class="kpi"><div class="kpi-ic">${ic}</div><div class="kpi-num">${val}</div><div class="kpi-lab">${label}</div></div>`;

// ---------------- transactions ----------------
async function renderTransactions() {
  $("tab-transactions").innerHTML = `<p class="muted">Loading transactions…</p>`;
  const deals = await DA.getDeals(active);
  $("tab-transactions").innerHTML = `
    <div class="dhead"><div><h1>Transactions</h1><p class="muted">Every closed deal, newest first.</p></div></div>
    <div class="table-wrap">
      <table class="dtable">
        <thead><tr><th>Bill</th><th>Date</th><th>Product</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Disc</th><th class="num">Total</th></tr></thead>
        <tbody>${deals.length ? deals.map((d) => `
          <tr><td class="mono">${esc(d.bill_no || "—")}</td>
          <td>${esc((d.closed_at || "").replace("T", " ").slice(0, 16))}</td>
          <td>${esc(d.product || "")}</td>
          <td class="num">${d.quantity}</td>
          <td class="num">${RS}${d.unit_price}</td>
          <td class="num">${(d.discount_pct || 0)}%</td>
          <td class="num strong">${RS}${inr(d.total)}</td></tr>`).join("")
        : `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No transactions yet.</td></tr>`}</tbody>
      </table>
    </div>`;
}

// ---------------- approvals (live Supabase queue) ----------------
async function renderApprovals() {
  const box = $("tab-approvals");
  const managedSlugs = businesses.map((b) => b.slug);
  const pending = (await DA.listPendingApprovals()).filter((r) => managedSlugs.includes(r.slug));
  box.innerHTML = `
    <div class="dhead"><div><h1>Special-request approvals</h1><p class="muted">When the agent hits your floor, the deal waits here for your decision.</p></div></div>
    <div id="apprList">${pending.length ? pending.map(apprCard).join("") : `<div class="dcard empty">No approvals waiting. You're all caught up. ✅</div>`}</div>`;
  pending.forEach((r) => {
    $(`ap-yes-${r.id}`)?.addEventListener("click", () => decide(r, "approve"));
    $(`ap-no-${r.id}`)?.addEventListener("click", () => decide(r, "reject"));
  });
}

function apprCard(r) {
  const b = businesses.find((x) => x.slug === r.slug);
  const p = b?.inventory.find((x) => x.name === r.product);
  const askPrice = (r.askPct != null && p) ? Math.round(p.list_price * (1 - r.askPct / 100) * 100) / 100 : null;
  const total = (askPrice != null && r.quantity) ? askPrice * r.quantity : null;
  const last = [...(r.messages || [])].reverse().find((m) => m.role === "customer");
  return `<div class="dcard appr" id="card-${r.id}">
    <div class="appr-top"><div class="appr-shop">${b?.logo || "🏪"} ${esc(r.business_name)}</div><span class="appr-time">just now</span></div>
    <div class="appr-body">
      Customer wants ${r.askPct != null ? `<b>~${r.askPct}% off</b>` : "a special price"}${r.product ? ` on <b>${esc(r.product)}</b>` : ""}${r.quantity ? `, quantity <b>${r.quantity}</b>` : ""}.
      ${askPrice != null ? `<br>Approving sells at <b>${RS}${askPrice}/unit</b>${total != null ? ` = <b>${RS}${inr(Math.round(total))}</b> total` : ""}.` : ""}
      ${last ? `<div class="appr-quote">“${esc(last.text)}”</div>` : ""}
    </div>
    <div class="appr-actions">
      <button class="btn primary" id="ap-yes-${r.id}">Approve</button>
      <button class="btn danger" id="ap-no-${r.id}">Reject — hold floor</button>
    </div>
  </div>`;
}

async function decide(r, op) {
  const card = $(`card-${r.id}`);
  if (card) card.innerHTML = `<p class="muted">Agent is replying to the customer…</p>`;
  const b = businesses.find((x) => x.slug === r.slug);
  if (!b) return;
  try {
    const resp = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, business: { profile: b.profile, inventory: b.inventory }, messages: r.messages, state: r.state }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "error");
    // Write the decision + reply + updated state back for the customer chat to pick up.
    await DA.resolveApproval(r.id, op, data.reply, data.state);
    toast(op === "approve" ? "Deal approved — customer notified." : "Held at floor — customer notified.");
    await renderApprovals(); await refreshApprovalsBadge();
  } catch (e) {
    if (card) card.innerHTML = `<p class="muted">Error: ${esc(e.message)}</p>`;
  }
}

async function refreshApprovalsBadge() {
  const managedSlugs = businesses.map((b) => b.slug);
  const n = (await DA.listPendingApprovals()).filter((r) => managedSlugs.includes(r.slug)).length;
  const badge = $("apprBadge");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
  // keep the approvals panel fresh if it's open
  if (!$("tab-approvals").classList.contains("hidden")) {
    const shown = $("apprList")?.querySelectorAll(".appr").length || 0;
    if (shown !== n) await renderApprovals();
  }
}

// ---------------- settings & floor ----------------
function renderSettings() {
  const b = activeBiz(), p = b.profile;
  $("tab-settings").innerHTML = `
    <div class="dhead"><div><h1>Settings &amp; floor</h1><p class="muted">These limits bound what the AI agent can ever offer.</p></div></div>
    <div class="dcard">
      <div class="form-grid">
        <label>Business name <input id="s-name" value="${esc(p.business_name)}"></label>
        <label>Tagline <input id="s-tag" value="${esc(p.tagline || "")}"></label>
        <label class="wide">Address <input id="s-addr" value="${esc(p.address || "")}"></label>
        <label>Phone <input id="s-phone" value="${esc(p.phone || "")}"></label>
        <label>WhatsApp (digits) <input id="s-wa" value="${esc(p.whatsapp || "")}"></label>
      </div>
      <div class="section-label" style="margin-top:16px">Negotiation limits — the agent never crosses these</div>
      <div class="form-grid">
        <label>Global max discount % <input id="s-max" type="number" value="${p.max_discount_pct}" min="0" max="90"></label>
        <label>Min order qty (below → approval) <input id="s-min" type="number" value="${p.small_order_min}" min="1"></label>
        <label>Big-order limit (${RS}) <input id="s-big" type="number" value="${p.big_order_threshold}" min="1000" step="500"></label>
      </div>
      <div class="section-label" style="margin-top:16px">Payments</div>
      <div class="form-grid">
        <label class="wide">Razorpay Key ID <input id="s-rzp" value="${esc(p.razorpay_key_id || "")}" placeholder="rzp_test_xxxxxxxxxxxx"></label>
      </div>
      <p class="muted" style="margin-top:4px">Get a Key ID from your Razorpay dashboard (Settings → API Keys). Leave blank to keep "Pay now" off and rely on WhatsApp / pay-on-delivery instead.</p>
      <button class="btn primary" id="s-save" style="margin-top:16px">Save settings</button>
    </div>`;
  $("s-save").addEventListener("click", async () => {
    $("s-save").disabled = true; $("s-save").textContent = "Saving…";
    const patch = { profile: Object.assign({}, p, {
      business_name: $("s-name").value.trim() || p.business_name,
      tagline: $("s-tag").value.trim(), address: $("s-addr").value.trim(),
      phone: $("s-phone").value.trim(), whatsapp: $("s-wa").value.replace(/\D/g, ""),
      max_discount_pct: Number($("s-max").value || 0),
      small_order_min: Number($("s-min").value || 1),
      big_order_threshold: Number($("s-big").value || 15000),
      razorpay_key_id: $("s-rzp").value.trim(),
    }) };
    try {
      await DA.updateBusiness(active, patch);
      await loadBusinesses();
      toast("Settings saved — visible on every device now.");
      await render();
    } catch (e) {
      toast("Couldn't save: " + e.message, true);
      renderSettings();
    }
  });
}

// ---------------- add business ----------------
function openAddModal() {
  ["nbName", "nbCat", "nbTag", "nbAbout", "nbWa"].forEach((id) => ($(id).value = ""));
  $("nbLogo").value = "🏪"; $("nbMax").value = 15; $("nbMin").value = 5; $("nbBig").value = 15000;
  $("nbProdTable").querySelector("tbody").innerHTML = "";
  addProdRow(); addProdRow();
  $("addModal").classList.remove("hidden");
}
function addProdRow(p = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="col-name"><input value="${esc(p.name || "")}" data-k="name" placeholder="Product name"></td>
    <td><input value="${esc(p.unit || "piece")}" data-k="unit" size="6"></td>
    <td><input type="number" min="0" step="0.5" value="${p.list_price ?? ""}" data-k="list_price" placeholder="0"></td>
    <td><input type="number" min="0" max="90" value="${p.max_discount_pct ?? 15}" data-k="max_discount_pct"></td>
    <td><input type="number" min="1" value="${p.moq ?? 10}" data-k="moq"></td>
    <td><input type="number" min="0" value="${p.stock ?? 100}" data-k="stock"></td>
    <td class="col-pitch"><input value="${esc(p.pitch || "")}" data-k="pitch" placeholder="Why it's good"></td>
    <td><button class="inv-del" title="Remove">✕</button></td>`;
  tr.querySelector(".inv-del").onclick = () => tr.remove();
  $("nbProdTable").querySelector("tbody").appendChild(tr);
}
async function saveNewBusiness() {
  const name = $("nbName").value.trim();
  if (!name) { toast("Give your business a name.", true); return; }
  const inventory = [...$("nbProdTable").querySelectorAll("tbody tr")].map((tr) => {
    const o = {};
    tr.querySelectorAll("input[data-k]").forEach((inp) => { o[inp.dataset.k] = inp.type === "number" ? Number(inp.value || 0) : inp.value.trim(); });
    return o;
  }).filter((o) => o.name && o.list_price > 0);
  if (!inventory.length) { toast("Add at least one product with a price.", true); return; }
  $("nbSave").disabled = true; $("nbSave").textContent = "Creating…";
  try {
    const biz = await DA.addBusiness({
      logo: $("nbLogo").value.trim() || "🏪", category: $("nbCat").value.trim() || "General",
      about: $("nbAbout").value.trim(),
      profile: {
        business_name: name, tagline: $("nbTag").value.trim(),
        address: "", phone: "", email: "", whatsapp: $("nbWa").value.replace(/\D/g, ""), pin: "1234",
        max_discount_pct: Number($("nbMax").value || 15), small_order_min: Number($("nbMin").value || 5),
        big_order_threshold: Number($("nbBig").value || 15000),
      },
      inventory,
    }, ownerId);
    $("addModal").classList.add("hidden");
    active = biz.slug;
    await loadBusinesses();
    toast(`${name} added — live on every device now.`);
    await render();
  } catch (e) {
    toast("Couldn't create business: " + e.message, true);
  } finally {
    $("nbSave").disabled = false; $("nbSave").textContent = "Create business";
  }
}

// ---------------- toast ----------------
let toastTimer;
function toast(msg, bad) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2800);
}
