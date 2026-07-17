/* DealAmigo shared data layer (window.DA).
   Loadable from any page via <script src>. Holds the seed businesses and a
   localStorage overlay for owner-added shops, closed deals, and the pending-
   approval bus that connects the customer chat to the owner dashboard.
   (Single-browser for the demo; a clean seam to swap for Supabase later.) */
(function () {
  const LS = {
    added: "da_businesses_added",
    deals: "da_deals",
    pending: "da_pending",
    seededDeals: "da_seeded_deals_v1",
  };
  const rd = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
  const wr = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const slugify = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "shop";

  // ---------------- seed businesses (4 fields) ----------------
  const SEED = [
    {
      slug: "crossword", logo: "✏️", category: "Stationery", rating: 4.8, distance: "1.2 km",
      about: "Your neighbourhood stationery wholesaler — notebooks, pens and office supplies trusted by schools and offices across the city.",
      profile: {
        business_name: "CROSSWORD", tagline: "Books · Stationery · Office Supplies",
        address: "Shop 12, Main Bazaar Road, Hyderabad — 500001", phone: "+91 98765 43210",
        email: "orders@crossword.example", whatsapp: "919876543210", pin: "1234",
        max_discount_pct: 15, small_order_min: 5, big_order_threshold: 15000,
      },
      inventory: [
        { name: "Long Notebook 200 pages (single line)", unit: "piece", list_price: 60, max_discount_pct: 15, moq: 10, stock: 500, pitch: "Thick 58 GSM paper, no ink bleed, hard cover. Schools buy in bulk." },
        { name: "Blue Ball Pen (0.7mm)", unit: "piece", list_price: 10, max_discount_pct: 15, moq: 20, stock: 1000, pitch: "Smooth-writing branded pen, fresh stock. Offices order monthly." },
        { name: "HB Pencil (dark lead)", unit: "piece", list_price: 5, max_discount_pct: 12, moq: 30, stock: 800, pitch: "Dark smooth lead, doesn't break on sharpening." },
        { name: "A4 Copier Paper 75 GSM (500-sheet ream)", unit: "ream", list_price: 280, max_discount_pct: 10, moq: 3, stock: 120, pitch: "Jam-free in all printers, bright white." },
      ],
    },
    {
      slug: "anand_hardware", logo: "🔩", category: "Hardware", rating: 4.6, distance: "2.0 km",
      about: "Fasteners, fittings and building hardware for contractors and workshops. Bulk rates, ready stock.",
      profile: {
        business_name: "Anand Hardware", tagline: "Fasteners · Fittings · Tools",
        address: "8 Industrial Estate, Balanagar, Hyderabad — 500037", phone: "+91 98490 11223",
        email: "sales@anandhardware.example", whatsapp: "919849011223", pin: "1234",
        max_discount_pct: 18, small_order_min: 10, big_order_threshold: 25000,
      },
      inventory: [
        { name: "M8 Hex Bolt (Grade 8.8, 40mm)", unit: "piece", list_price: 12, max_discount_pct: 18, moq: 50, stock: 4000, pitch: "High-tensile zinc-plated, ISI marked. Trusted by 200+ workshops." },
        { name: "10mm Nylon Wall Anchor + Screw", unit: "piece", list_price: 6, max_discount_pct: 15, moq: 100, stock: 3000, pitch: "Holds 40kg in solid brick, screw included." },
        { name: "SS-304 Door Hinge (4 inch)", unit: "piece", list_price: 45, max_discount_pct: 12, moq: 20, stock: 600, pitch: "Rust-proof stainless, smooth swing, heavy-duty." },
        { name: "PVC Pipe Clamp (1 inch)", unit: "piece", list_price: 8, max_discount_pct: 15, moq: 100, stock: 2500, pitch: "UV-stable, snaps on fast, plumber's favourite." },
      ],
    },
    {
      slug: "freshmart_wholesale", logo: "🛒", category: "Groceries", rating: 4.5, distance: "0.9 km",
      about: "Wholesale provisions for kirana stores and canteens — rice, oil, sugar and pulses at bulk rates.",
      profile: {
        business_name: "FreshMart Wholesale", tagline: "Staples · Oils · Pulses — in bulk",
        address: "Market Yard, Bowenpally, Hyderabad — 500011", phone: "+91 90000 55667",
        email: "orders@freshmart.example", whatsapp: "919000055667", pin: "1234",
        max_discount_pct: 8, small_order_min: 2, big_order_threshold: 60000,
      },
      inventory: [
        { name: "Sona Masoori Rice (25kg bag)", unit: "bag", list_price: 1150, max_discount_pct: 8, moq: 5, stock: 300, pitch: "Premium aged grain, low breakage. Canteens reorder weekly." },
        { name: "Refined Sunflower Oil (15L tin)", unit: "tin", list_price: 1800, max_discount_pct: 6, moq: 3, stock: 150, pitch: "Light, fresh-pressed, sealed tins. Long shelf life." },
        { name: "Sugar S-30 (50kg bag)", unit: "bag", list_price: 2100, max_discount_pct: 5, moq: 2, stock: 90, pitch: "Fine uniform crystals, mill-fresh." },
        { name: "Toor Dal (30kg bag)", unit: "bag", list_price: 3600, max_discount_pct: 7, moq: 2, stock: 70, pitch: "Cleaned, unpolished, premium grade." },
      ],
    },
    {
      slug: "voltedge_electronics", logo: "🔌", category: "Electronics", rating: 4.7, distance: "3.1 km",
      about: "Electrical and electronic essentials for electricians and retailers — bulbs, cables, boards and batteries.",
      profile: {
        business_name: "VoltEdge Electronics", tagline: "Lighting · Cables · Accessories",
        address: "22 CTC Complex, Secunderabad — 500003", phone: "+91 99887 66554",
        email: "sales@voltedge.example", whatsapp: "919988766554", pin: "1234",
        max_discount_pct: 20, small_order_min: 10, big_order_threshold: 30000,
      },
      inventory: [
        { name: "9W LED Bulb (cool white)", unit: "piece", list_price: 55, max_discount_pct: 20, moq: 25, stock: 1200, pitch: "2-year warranty, low power draw, bright output." },
        { name: "Extension Board (4-socket, 2m)", unit: "piece", list_price: 240, max_discount_pct: 15, moq: 10, stock: 350, pitch: "Surge-protected, ISI mark, heavy copper." },
        { name: "HDMI Cable (1.5m, 4K)", unit: "piece", list_price: 120, max_discount_pct: 18, moq: 20, stock: 600, pitch: "Gold-plated, 4K@60Hz, braided shield." },
        { name: "AA Alkaline Battery (pack of 10)", unit: "pack", list_price: 90, max_discount_pct: 12, moq: 20, stock: 800, pitch: "Long-life, leak-proof, fresh stock." },
      ],
    },
  ];
  const seedMap = Object.fromEntries(SEED.map((b) => [b.slug, b]));

  // ---------------- businesses (seed + owner-added) ----------------
  function addedBusinesses() { return rd(LS.added, []); }
  function allBusinesses() { return [...SEED, ...addedBusinesses()]; }
  function getBusiness(slug) {
    // An owner's saved edits (added list) override the seed — otherwise
    // Settings changes for the 4 demo shops would silently never apply.
    const overridden = addedBusinesses().find((b) => b.slug === slug);
    return overridden || seedMap[slug] || null;
  }

  function addBusiness(input, ownerEmail) {
    const added = addedBusinesses();
    let slug = slugify(input.profile.business_name);
    while (getBusiness(slug)) slug += "_" + Math.floor(Math.random() * 900 + 100);
    const biz = { slug, logo: input.logo || "🏪", category: input.category || "General",
      rating: 5.0, distance: "— km", about: input.about || "", ownerEmail: ownerEmail || null,
      profile: input.profile, inventory: input.inventory || [] };
    added.push(biz); wr(LS.added, added);
    return biz;
  }
  function updateBusiness(slug, patch) {
    const added = addedBusinesses();
    const i = added.findIndex((b) => b.slug === slug);
    if (i >= 0) { Object.assign(added[i], patch); wr(LS.added, added); return added[i]; }
    // Editing a seed shop: store an override copy in the added list.
    const seed = seedMap[slug];
    if (seed) { const copy = JSON.parse(JSON.stringify(seed)); Object.assign(copy, patch); added.push(copy); wr(LS.added, added); return copy; }
    return null;
  }

  // Businesses this owner manages. For the demo, an owner sees the 4 seed
  // shops plus any they've added themselves.
  function businessesForOwner(email) {
    const added = addedBusinesses();
    // Show the saved-edit version of each seed shop if one exists, so the
    // dashboard's business switcher reflects renamed/edited shops too.
    const seeds = SEED.map((b) => added.find((a) => a.slug === b.slug) || b);
    const ownedAdded = added.filter((b) => b.ownerEmail === email && !SEED.find((s) => s.slug === b.slug));
    return [...seeds, ...ownedAdded];
  }

  // ---------------- deals (transactions) ----------------
  function seedDealsOnce() {
    if (rd(LS.seededDeals, false)) return;
    const all = {};
    const products = (slug) => getBusiness(slug).inventory;
    const now = Date.now();
    for (const b of SEED) {
      const list = [];
      const n = 9 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const p = products(b.slug)[Math.floor(Math.random() * products(b.slug).length)];
        const qty = p.moq * (1 + Math.floor(Math.random() * 6));
        const discPct = Math.round(Math.random() * (p.max_discount_pct || 8) * 10) / 10;
        const unit = Math.round(p.list_price * (1 - discPct / 100) * 100) / 100;
        const daysAgo = Math.floor(Math.random() * 28);
        list.push({
          bill_no: b.profile.business_name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() + "-" + (1000 + i),
          closed_at: new Date(now - daysAgo * 864e5 - Math.random() * 6e7).toISOString().slice(0, 19),
          product: p.name, quantity: qty, unit_price: unit, list_price: p.list_price,
          discount_pct: discPct, total: Math.round(unit * qty * 100) / 100, seeded: true,
        });
      }
      list.sort((a, b2) => (a.closed_at < b2.closed_at ? 1 : -1));
      all[b.slug] = list;
    }
    wr(LS.deals, all); wr(LS.seededDeals, true);
  }
  function getDeals(slug) { seedDealsOnce(); return (rd(LS.deals, {})[slug]) || []; }
  function addDeal(slug, deal) {
    seedDealsOnce();
    const all = rd(LS.deals, {});
    (all[slug] = all[slug] || []).unshift(deal);
    wr(LS.deals, all);
  }
  function markPaid(slug, billNo, paymentId) {
    const all = rd(LS.deals, {});
    const deal = (all[slug] || []).find((d) => d.bill_no === billNo);
    if (deal) { deal.paid = true; deal.payment_id = paymentId; wr(LS.deals, all); }
  }

  // ---------------- pending-approval bus ----------------
  // Keyed by slug: { messages, state, product, quantity, askPct, createdAt,
  //   decision: null|'approve'|'reject', reply: null|string, resolvedAt }
  function getPending(slug) { return rd(LS.pending, {})[slug] || null; }
  function allPending() { const m = rd(LS.pending, {}); return Object.entries(m).map(([slug, v]) => ({ slug, ...v })); }
  function setPending(slug, rec) { const m = rd(LS.pending, {}); m[slug] = rec; wr(LS.pending, m); }
  function clearPending(slug) { const m = rd(LS.pending, {}); delete m[slug]; wr(LS.pending, m); }

  // ---------------- analytics ----------------
  function analytics(slug) {
    const deals = getDeals(slug);
    const revenue = deals.reduce((s, d) => s + (d.total || 0), 0);
    const orders = deals.length;
    const avgDisc = orders ? deals.reduce((s, d) => s + (d.discount_pct || 0), 0) / orders : 0;
    // revenue over last 7 days (oldest→newest)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i));
      return { label: d.toLocaleDateString("en-IN", { weekday: "short" }), key: d.toISOString().slice(0, 10), total: 0 };
    });
    for (const d of deals) { const k = (d.closed_at || "").slice(0, 10); const hit = days.find((x) => x.key === k); if (hit) hit.total += d.total || 0; }
    // top products by revenue
    const byProd = {};
    for (const d of deals) byProd[d.product] = (byProd[d.product] || 0) + (d.total || 0);
    const topProducts = Object.entries(byProd).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, total]) => ({ name, total }));
    return { revenue, orders, avgDisc, days, topProducts };
  }

  window.DA = {
    slugify, SEED, allBusinesses, getBusiness, addBusiness, updateBusiness,
    businessesForOwner, getDeals, addDeal, markPaid,
    getPending, allPending, setPending, clearPending, analytics,
  };
})();
