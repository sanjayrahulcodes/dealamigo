/* DealAmigo shops directory — lists all businesses from the shared data layer.
   Each card shows an overview and opens that shop's page (with chat). */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const grid = document.getElementById("shopGrid");
let all = [];

let activeCat = "all";
let query = "";

function stars(r) { const n = Math.round(r || 5); return "★".repeat(n) + "☆".repeat(5 - n); }

function matches(b) {
  const catOk = activeCat === "all" || b.category === activeCat;
  if (!catOk) return false;
  if (!query) return true;
  const hay = (b.profile.business_name + " " + b.category + " " + b.about + " " +
    b.inventory.map((p) => p.name).join(" ")).toLowerCase();
  return hay.includes(query);
}

function render() {
  const list = all.filter(matches);
  if (!list.length) { grid.innerHTML = `<p class="muted" style="grid-column:1/-1">No shops match your search.</p>`; return; }
  grid.innerHTML = list.map((b) => {
    const from = Math.min(...b.inventory.map((p) => Number(p.list_price)));
    return `<a class="shop-card" href="shop/index.html?shop=${encodeURIComponent(b.slug)}&chat=1">
      <div class="shop-top">
        <div class="shop-logo">${b.logo || "🏪"}</div>
        <span class="shop-badge live">● Open</span>
      </div>
      <div class="shop-name">${esc(b.profile.business_name)}</div>
      <div class="shop-cat">${esc(b.category)}</div>
      <div class="shop-blurb">${esc(b.about || b.profile.tagline || "")}</div>
      <div class="shop-meta">
        <span class="shop-rating">${stars(b.rating)} <b>${b.rating || 5}</b></span>
        <span class="shop-dist">📍 ${esc(b.distance || "")}</span>
      </div>
      <div class="shop-foot">
        <span class="shop-from">from ${"₹"}${from}</span>
        <span class="shop-open-btn">Chat with us →</span>
      </div>
    </a>`;
  }).join("");
}

document.getElementById("filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  document.querySelectorAll(".filter").forEach((f) => f.classList.toggle("active", f === btn));
  activeCat = btn.dataset.cat;
  render();
});
document.querySelector(".shops-search input").addEventListener("input", (e) => {
  query = e.target.value.trim().toLowerCase();
  render();
});

grid.innerHTML = `<p class="muted" style="grid-column:1/-1">Loading shops…</p>`;
DA.allBusinesses().then((list) => { all = list; render(); })
  .catch((e) => { grid.innerHTML = `<p class="muted" style="grid-column:1/-1">Couldn't load shops: ${esc(e.message)}</p>`; });
