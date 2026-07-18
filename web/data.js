/* DealAmigo shared data layer (window.DA) — Supabase-backed.
   Loadable from any page via <script src>. Businesses, products, deals and
   the live approval queue all live in Postgres now, so a change made on one
   device (e.g. adding a business, closing a deal, resolving an approval)
   shows up on any other device after a refresh — no more localStorage
   silo per browser. Requires the Supabase UMD script tag loaded first. */
(function () {
  const SUPABASE_URL = "https://byrmunbfghezfonkqmqs.supabase.co";
  const SUPABASE_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cm11bmJmZ2hlemZvbmtxbXFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyODE3MjYsImV4cCI6MjA5OTg1NzcyNn0.0SJaM7BDWDgi7NkG-Mw2elEwfdruX2UZBwItNJTFgTQ";
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  const slugify = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "shop";

  // ---------------- seed catalog (used once, to populate an empty DB) ----------------
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

  // ---------------- row <-> app-shape mapping ----------------
  function toBusiness(row, products) {
    return {
      slug: row.slug, logo: row.logo || "🏪", category: row.category || "General",
      rating: row.rating || 5, distance: row.distance || "—", about: row.about || "",
      ownerId: row.owner_id || null,
      id: row.id,
      profile: {
        business_name: row.name, tagline: row.tagline || "", address: row.address || "",
        phone: row.phone || "", email: row.email || "", whatsapp: row.whatsapp || "",
        pin: row.pin || "1234", razorpay_key_id: row.razorpay_key_id || "",
        max_discount_pct: Number(row.max_discount_pct || 0),
        small_order_min: Number(row.small_order_min || 1),
        big_order_threshold: Number(row.big_order_threshold || 15000),
      },
      inventory: (products || []).map((p) => ({
        id: p.id, name: p.name, unit: p.unit || "piece", list_price: Number(p.list_price),
        max_discount_pct: Number(p.max_discount_pct || 0), moq: Number(p.moq || 1),
        stock: Number(p.stock || 0), pitch: p.pitch || "",
      })),
    };
  }

  async function fetchAllBusinesses() {
    const { data: rows, error } = await sb.from("businesses").select("*, products(*)").order("created_at");
    if (error) throw error;
    return (rows || []).map((r) => toBusiness(r, r.products));
  }

  // ---------------- one-time seed (only runs if the DB is empty) ----------------
  let seeded = false;
  async function ensureSeeded() {
    if (seeded) return;
    seeded = true;
    const { count, error } = await sb.from("businesses").select("id", { count: "exact", head: true });
    if (error || (count || 0) > 0) return; // already has data (or can't tell) — leave it alone
    for (const b of SEED) {
      const { data: biz, error: bizErr } = await sb.from("businesses").insert({
        slug: b.slug, name: b.profile.business_name, tagline: b.profile.tagline,
        address: b.profile.address, phone: b.profile.phone, email: b.profile.email,
        whatsapp: b.profile.whatsapp, pin: b.profile.pin, category: b.category,
        logo: b.logo, rating: b.rating, distance: b.distance, about: b.about,
        max_discount_pct: b.profile.max_discount_pct, small_order_min: b.profile.small_order_min,
        big_order_threshold: b.profile.big_order_threshold, owner_id: null,
      }).select().single();
      if (bizErr || !biz) continue;
      await sb.from("products").insert(b.inventory.map((p) => ({ ...p, business_id: biz.id })));
      // A little sales history so the dashboard's analytics aren't empty on day one.
      const n = 9 + Math.floor(Math.random() * 6);
      const histDeals = [];
      for (let i = 0; i < n; i++) {
        const p = b.inventory[Math.floor(Math.random() * b.inventory.length)];
        const qty = p.moq * (1 + Math.floor(Math.random() * 6));
        const discPct = Math.round(Math.random() * (p.max_discount_pct || 8) * 10) / 10;
        const unit = Math.round(p.list_price * (1 - discPct / 100) * 100) / 100;
        const daysAgo = Math.floor(Math.random() * 28);
        histDeals.push({
          business_id: biz.id,
          bill_no: b.profile.business_name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() + "-" + (1000 + i),
          product: p.name, quantity: qty, unit_price: unit, list_price: p.list_price,
          discount_pct: discPct, total: Math.round(unit * qty * 100) / 100, status: "closed",
          created_at: new Date(Date.now() - daysAgo * 864e5 - Math.random() * 6e7).toISOString(),
        });
      }
      if (histDeals.length) await sb.from("deals").insert(histDeals);
    }
  }

  // ---------------- businesses ----------------
  async function allBusinesses() { await ensureSeeded(); return fetchAllBusinesses(); }

  async function getBusiness(slug) {
    await ensureSeeded();
    const { data: row, error } = await sb.from("businesses").select("*, products(*)").eq("slug", slug).maybeSingle();
    if (error || !row) return null;
    return toBusiness(row, row.products);
  }

  async function addBusiness(input, ownerId) {
    let slug = slugify(input.profile.business_name);
    // avoid collisions
    for (let i = 0; i < 5; i++) {
      const { data: exists } = await sb.from("businesses").select("id").eq("slug", slug).maybeSingle();
      if (!exists) break;
      slug = slugify(input.profile.business_name) + "_" + Math.floor(Math.random() * 900 + 100);
    }
    const { data: biz, error } = await sb.from("businesses").insert({
      slug, name: input.profile.business_name, tagline: input.profile.tagline || "",
      address: input.profile.address || "", phone: input.profile.phone || "",
      email: input.profile.email || "", whatsapp: input.profile.whatsapp || "",
      pin: input.profile.pin || "1234", category: input.category || "General",
      logo: input.logo || "🏪", about: input.about || "", rating: 5.0, distance: "—",
      max_discount_pct: input.profile.max_discount_pct || 15,
      small_order_min: input.profile.small_order_min || 5,
      big_order_threshold: input.profile.big_order_threshold || 15000,
      owner_id: ownerId || null,
    }).select().single();
    if (error || !biz) throw error || new Error("Could not create business");
    const inv = (input.inventory || []).filter((p) => p.name && p.list_price > 0);
    if (inv.length) await sb.from("products").insert(inv.map((p) => ({ ...p, business_id: biz.id })));
    return getBusiness(slug);
  }

  async function updateBusiness(slug, patch) {
    const { data: row } = await sb.from("businesses").select("id").eq("slug", slug).maybeSingle();
    if (!row) return null;
    if (patch.profile) {
      const p = patch.profile;
      await sb.from("businesses").update({
        name: p.business_name, tagline: p.tagline, address: p.address, phone: p.phone,
        email: p.email, whatsapp: p.whatsapp, pin: p.pin, razorpay_key_id: p.razorpay_key_id,
        max_discount_pct: p.max_discount_pct, small_order_min: p.small_order_min,
        big_order_threshold: p.big_order_threshold,
      }).eq("id", row.id);
    }
    if (patch.inventory) {
      await sb.from("products").delete().eq("business_id", row.id);
      const inv = patch.inventory.filter((p) => p.name && p.list_price > 0);
      if (inv.length) await sb.from("products").insert(inv.map((p) => ({ ...p, business_id: row.id })));
    }
    return getBusiness(slug);
  }

  async function businessesForOwner() {
    // In this demo every signed-in owner manages all businesses (no per-user
    // silo yet — see README roadmap); this at least makes every shop visible
    // and editable from any device, which is the bug being fixed here.
    await ensureSeeded();
    return fetchAllBusinesses();
  }

  // ---------------- deals (transactions) ----------------
  async function getDeals(slug) {
    const { data: biz } = await sb.from("businesses").select("id").eq("slug", slug).maybeSingle();
    if (!biz) return [];
    const { data: rows, error } = await sb.from("deals").select("*").eq("business_id", biz.id).order("created_at", { ascending: false });
    if (error) return [];
    return (rows || []).map((d) => ({
      bill_no: d.bill_no, closed_at: (d.created_at || "").slice(0, 19), product: d.product,
      quantity: d.quantity, unit_price: d.unit_price, list_price: d.list_price,
      discount_pct: d.discount_pct, total: d.total, paid: d.paid, payment_id: d.payment_id,
    }));
  }

  async function addDeal(slug, deal) {
    const { data: biz } = await sb.from("businesses").select("id").eq("slug", slug).maybeSingle();
    if (!biz) return;
    await sb.from("deals").insert({
      business_id: biz.id, bill_no: deal.bill_no, product: deal.product, quantity: deal.quantity,
      unit_price: deal.unit_price, list_price: deal.list_price, discount_pct: deal.discount_pct,
      total: deal.total, status: "closed",
    });
  }

  async function markPaid(slug, billNo, paymentId) {
    const { data: biz } = await sb.from("businesses").select("id").eq("slug", slug).maybeSingle();
    if (!biz) return;
    await sb.from("deals").update({ paid: true, payment_id: paymentId }).eq("business_id", biz.id).eq("bill_no", billNo);
  }

  // ---------------- approvals (live cross-device escalation queue) ----------------
  async function createApproval(slug, rec) {
    const { data: biz } = await sb.from("businesses").select("id").eq("slug", slug).maybeSingle();
    if (!biz) return null;
    const { data: row, error } = await sb.from("approvals").insert({
      business_id: biz.id, business_slug: slug, business_name: rec.business_name,
      messages: rec.messages, state: rec.state, product: rec.product,
      quantity: rec.quantity, ask_pct: rec.askPct,
    }).select().single();
    if (error) throw error;
    return fromApprovalRow(row);
  }

  async function getApproval(id) {
    const { data: row, error } = await sb.from("approvals").select("*").eq("id", id).maybeSingle();
    if (error || !row) return null;
    return fromApprovalRow(row);
  }

  async function listPendingApprovals() {
    const { data: rows, error } = await sb.from("approvals").select("*").is("decision", null).order("created_at", { ascending: false });
    if (error) return [];
    return (rows || []).map(fromApprovalRow);
  }

  async function resolveApproval(id, decision, reply, state) {
    await sb.from("approvals").update({ decision, reply, state, resolved_at: new Date().toISOString() }).eq("id", id);
  }

  async function deleteApproval(id) { await sb.from("approvals").delete().eq("id", id); }

  function fromApprovalRow(row) {
    return {
      id: row.id, slug: row.business_slug, business_name: row.business_name,
      messages: row.messages || [], state: row.state, product: row.product,
      quantity: row.quantity, askPct: row.ask_pct, decision: row.decision, reply: row.reply,
      createdAt: row.created_at,
    };
  }

  // ---------------- analytics ----------------
  async function analytics(slug) {
    const deals = await getDeals(slug);
    const revenue = deals.reduce((s, d) => s + (d.total || 0), 0);
    const orders = deals.length;
    const avgDisc = orders ? deals.reduce((s, d) => s + (d.discount_pct || 0), 0) / orders : 0;
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i));
      return { label: d.toLocaleDateString("en-IN", { weekday: "short" }), key: d.toISOString().slice(0, 10), total: 0 };
    });
    for (const d of deals) { const k = (d.closed_at || "").slice(0, 10); const hit = days.find((x) => x.key === k); if (hit) hit.total += d.total || 0; }
    const byProd = {};
    for (const d of deals) byProd[d.product] = (byProd[d.product] || 0) + (d.total || 0);
    const topProducts = Object.entries(byProd).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, total]) => ({ name, total }));
    return { revenue, orders, avgDisc, days, topProducts };
  }

  window.DA = {
    slugify, SEED, allBusinesses, getBusiness, addBusiness, updateBusiness, businessesForOwner,
    getDeals, addDeal, markPaid,
    createApproval, getApproval, listPendingApprovals, resolveApproval, deleteApproval,
    analytics,
  };
})();
