/* DealAmigo shops directory — placeholder listing.
   CROSSWORD is the live shop and opens the working chatbot; the rest are
   demo placeholders until the multi-tenant backend lands. */
const SHOPS = [
  { name: "CROSSWORD", cat: "Stationery", ic: "✏️", blurb: "Books, notebooks, pens & office supplies", dist: "1.2 km", rating: "4.8", live: true, href: "shop/index.html" },
  { name: "Anand Hardware", cat: "Hardware", ic: "🔩", blurb: "Fasteners, tools, fittings & more", dist: "2.0 km", rating: "4.6", live: false },
  { name: "PackWell Supplies", cat: "Packaging", ic: "📦", blurb: "Boxes, tape, bubble wrap, mailers", dist: "3.4 km", rating: "4.7", live: false },
  { name: "Sri Textiles", cat: "Textiles", ic: "🧵", blurb: "Fabric, thread, trims, wholesale rolls", dist: "2.8 km", rating: "4.5", live: false },
  { name: "Daily Mart Wholesale", cat: "Groceries", ic: "🛒", blurb: "Staples & bulk goods for shops", dist: "0.9 km", rating: "4.4", live: false },
  { name: "Volt Electronics", cat: "Electronics", ic: "🔌", blurb: "Components, cables, accessories", dist: "4.1 km", rating: "4.6", live: false },
];

const stars = (r) => "★".repeat(Math.round(Number(r))) + "☆".repeat(5 - Math.round(Number(r)));

document.getElementById("shopGrid").innerHTML = SHOPS.map((s) => {
  const badge = s.live
    ? `<span class="shop-badge live">● Live</span>`
    : `<span class="shop-badge soon">Coming soon</span>`;
  const action = s.live
    ? `<a class="btn btn-green shop-open" href="${s.href}">Open shop →</a>`
    : `<button class="btn btn-outline shop-open" disabled>Coming soon</button>`;
  return `<div class="shop-card ${s.live ? "" : "is-soon"}">
    <div class="shop-top">
      <div class="shop-logo">${s.ic}</div>
      ${badge}
    </div>
    <div class="shop-name">${s.name}</div>
    <div class="shop-cat">${s.cat}</div>
    <div class="shop-blurb">${s.blurb}</div>
    <div class="shop-meta">
      <span class="shop-rating">${stars(s.rating)} <b>${s.rating}</b></span>
      <span class="shop-dist">📍 ${s.dist}</span>
    </div>
    ${action}
  </div>`;
}).join("");
