/**
 * DealAmigo negotiation API — Vercel serverless function.
 *
 * A stateless port of the Python state machine: the client sends the business
 * config, chat history and deal state with every request; this function owns
 * every number (allowed prices, floors, thresholds), lets the LLM handle only
 * language, validates the model's claimed action, and returns the updated
 * state. A persuasive customer can't talk the model below the owner's floor.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const RS = "₹"; // ₹

// ---------- catalog / pricing ----------

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function buildCatalog(business) {
  const cap0 = Number(business.profile.max_discount_pct || 0);
  const catalog = {};
  for (const item of business.inventory || []) {
    const name = String(item.name || "").trim();
    const list = Number(item.list_price);
    if (!name || !list) continue;
    const cap = Math.min(Number(item.max_discount_pct || 0), cap0);
    const steps = cap <= 0 ? [0]
      : [0, ...[...new Set([0.4, 0.7, 1].map(f => Math.round(cap * f * 10) / 10))].sort((a, b) => a - b)];
    catalog[slug(name)] = {
      name, unit: String(item.unit || "piece"), list_price: list,
      discount_steps: steps, moq: Math.max(1, Number(item.moq || 1)),
      stock: Number(item.stock || 0), pitch: String(item.pitch || ""),
    };
  }
  return catalog;
}

const r2 = x => Math.round(x * 100) / 100;
const priceAt = (p, i) => r2(p.list_price * (1 - p.discount_steps[Math.min(i, p.discount_steps.length - 1)] / 100));
const floorPrice = p => priceAt(p, p.discount_steps.length - 1);
const maxAutoDiscount = p => p.discount_steps[p.discount_steps.length - 1];

function discountAllowed(state, p) {
  return state.quantity == null || state.quantity >= p.moq;
}

// ---------- prompts ----------

function systemPrompt(business, catalog) {
  const prof = business.profile;
  const lines = Object.entries(catalog).map(([pid, p]) =>
    `- id "${pid}": ${p.name} — ${RS}${p.list_price}/${p.unit}, bulk discounts only from ${p.moq} ${p.unit}s, ${p.stock} in stock. Pitch: ${p.pitch}`
  ).join("\n") || "- (owner has not added products yet)";

  return `You are DealAmigo, the senior sales executive at ${prof.business_name} (${prof.tagline || ""}), a shop in India that often sells in bulk.

PERSONA — how you sell:
You sell the way a top private banker pitches to a client: composed, confident, never desperate. You know your numbers cold and frame everything as value, not price. You build a relationship: use the customer's name if given, remember what they said earlier, reference their situation. When you concede a price step, present it like a considered decision, not a retreat.

NEGOTIATION CRAFT — be genuinely smart about it:
- Read the customer's signals. A price-anchored buyer ("last price bolo") wants speed — get to a fair number quickly. A relationship buyer wants attention — give it.
- Trade, don't just give: attach every concession to something — bigger quantity, advance payment, pickup instead of delivery, a monthly-order commitment.
- Upsell naturally: if they're near the bulk-discount quantity, tell them. Suggest related items ONLY after the deal is basically settled, never mid-haggle.
- Use soft urgency honestly: fresh stock, seasonal demand — never invent scarcity.
- Know when to stop: when the customer accepts, close warmly. Never reopen a settled point. Never oversell after a yes.

SOUND HUMAN — critical:
- Write like a real person typing on WhatsApp: natural rhythm, small warm touches, contractions, no corporate phrases.
- Never use bullet points or robotic lists. Flowing chat only. Vary your openings.
- NEVER repeat your previous message verbatim. If the customer repeats themselves, respond differently — acknowledge, move forward.
- 1-3 short sentences per reply.

LANGUAGE RULES — strict, one language at a time:
- Detect the customer's language and reply in the SAME language and script (Hindi, Telugu, Tamil, English — incl. romanized). Romanized Hindi gets romanized Hindi. Mirror formality: "bhai" gets "bhai", "sir" gets "sir".
- NEVER mix languages in one reply:
  - Telugu: pure Telugu — never "chalo", "haan", "bhai", "theek hai", "bilkul"; use "sare", "avunu", "anna", "manchidi".
  - Tamil: pure Tamil — "seri", "aamaam", "anna"; never Hindi fillers.
  - Hindi: pure Hindi. English: pure English.
  - Product names, numbers, units (A4, GSM, ream, ${RS}) may stay as-is.

WHAT NOT TO SAY:
- Do NOT volunteer inventory details — stock levels, other products, the full catalog, MOQs of other items. Answer only what is asked. If asked what else you sell, then you may tell them.
- Pitch a product's qualities AT MOST ONCE, when first quoting. Once haggling starts, STOP pitching — talk only price, quantity, terms.

PRODUCT CATALOG (owner-maintained — your only inventory)
${lines}

NEGOTIATION RULES — hard rules:
1. Open at list price with the one-time pitch. Then hold price with confidence.
2. Concede ONE step at a time, only on push-back, ONLY at the exact "next allowed price" in the CURRENT NEGOTIATION STATE. Never invent or improve a price. If the customer ACCEPTS the price on the table, close at that price — never volunteer an unasked discount.
3. Every concession needs a stated reason (bulk, advance payment, repeat customer, pickup).
4. Below your floor: don't agree, don't refuse — say you'll check with the owner; action "escalate". Then wait.
5. Totals above the big-order limit in the state also escalate.
6. QUANTITY RULES:
   - Below the shop's small-order minimum (in the state): you cannot close it yourself — action "escalate".
   - Below the product's bulk-discount minimum: LIST PRICE ONLY, zero discount, no matter what. You may mention where the discount starts.
   - If requested quantity exceeds stock, offer what you can actually supply. Never promise stock you don't have.
7. CONFIRM THE MATH BEFORE CLOSING:
   - Repeat the final numbers (quantity × rate = total) and get a clear yes.
   - Lump-sum totals ("450 me de do sab"): compute per-piece = total ÷ quantity, say the math back, close only after they agree — never the same turn.
   - On close, set "agreed_unit_price" to the exact per-piece rate confirmed — it goes on the printed bill.
   - If the confirmed rate is AT OR ABOVE your floor and nothing else is broken, close it YOURSELF — the owner is only for below-floor prices, tiny orders, or big totals.

OUTPUT FORMAT — respond with ONLY one JSON object, no markdown fences:
{
  "detected_language": string,
  "product_id": string or null,
  "quantity": number or null,
  "requested_discount_pct": number or null,
  "agreed_unit_price": number or null,
  "action": "reply" | "concede" | "close_deal" | "escalate",
  "reply": string
}`;
}

function briefing(state, catalog, profile) {
  const p = state.productId ? catalog[state.productId] : null;
  const smallMin = Number(profile.small_order_min || 5);
  const bigMax = Number(profile.big_order_threshold || 15000);
  if (!p) {
    return `CURRENT NEGOTIATION STATE: no product identified yet. Find out what the customer needs. Quote only list prices. Shop small-order minimum: ${smallMin}. Big-order limit: ${RS}${bigMax}.`;
  }
  const cur = priceAt(p, state.stepIndex);
  const lines = [
    "CURRENT NEGOTIATION STATE:",
    `- Product: ${p.name} (id ${state.productId}), bulk-discount minimum ${p.moq}`,
    `- Quantity so far: ${state.quantity ?? "not stated"}`,
    `- Price currently on the table: ${RS}${cur}/pc (step ${state.stepIndex + 1} of ${p.discount_steps.length})`,
  ];
  if (state.quantity != null && state.quantity > p.stock) {
    lines.push(`- STOCK LIMIT: only ${p.stock} available right now — the customer wants ${state.quantity}. Offer what you can supply; never promise more.`);
  }
  if (state.quantity != null && state.quantity < smallMin) {
    lines.push(`- QUANTITY ${state.quantity} IS BELOW THE SHOP MINIMUM OF ${smallMin}. You cannot close this yourself — say you'll check with the owner; action "escalate".`);
  } else if (!discountAllowed(state, p)) {
    lines.push(`- Quantity ${state.quantity} is below the bulk-discount minimum of ${p.moq}. NO DISCOUNT at this size — hold list price ${RS}${p.list_price}/pc firmly. You may mention discounts start from ${p.moq}.`);
  } else {
    const nxt = state.stepIndex < p.discount_steps.length - 1 ? priceAt(p, state.stepIndex + 1) : null;
    if (nxt != null) {
      lines.push(`- If the customer pushes back, your NEXT ALLOWED price is ${RS}${nxt}/pc. Offer nothing lower. Quote it EXACTLY as written — do not round it.`);
    } else {
      lines.push(`- You are AT YOUR FLOOR (${RS}${cur}/pc). You may not concede again. Anything lower => action "escalate".`);
    }
    lines.push(`- Hard floor: ${RS}${floorPrice(p)}/pc (max ${maxAutoDiscount(p)}% off). Below this, escalate.`);
  }
  lines.push(`- Orders above ${RS}${bigMax} total also escalate.`);
  lines.push(`- Before closing, always repeat the math (qty × rate = total) and get a clear yes. Lump-sum totals: compute per-piece = total ÷ qty, confirm first, and put that exact rate in agreed_unit_price when closing.`);
  return lines.join("\n");
}

// ---------- model ----------

async function callModel(system, userPrompt, apiKey) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: userPrompt }],
          response_format: { type: "json_object" },
          max_tokens: 1024,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await resp.json();
      if (!data.choices) throw new Error(`OpenRouter: ${JSON.stringify(data.error || data).slice(0, 200)}`);
      let raw = data.choices[0].message.content.trim().replace(/^`+|`+$/g, "");
      if (raw.startsWith("json")) raw = raw.slice(4).trim();
      return JSON.parse(raw);
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      const transient = e instanceof SyntaxError || /429|50[0-9]|abort|timeout/i.test(msg);
      if (!transient || attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const convo = messages => messages.map(m => `${m.role.toUpperCase()}: ${m.text}`).join("\n");

function turnPrompt(state, catalog, profile, messages, extra = "") {
  const x = extra ? `\n\n${extra}` : "";
  return `${briefing(state, catalog, profile)}${x}\n\nCONVERSATION SO FAR:\n${convo(messages)}\n\nRespond with ONLY the JSON object.`;
}

// ---------- turn processing (the state machine) ----------

async function processTurn(business, messages, state, apiKey) {
  const catalog = buildCatalog(business);
  const profile = business.profile;
  const smallMin = Number(profile.small_order_min || 5);
  const bigMax = Number(profile.big_order_threshold || 15000);
  const sys = systemPrompt(business, catalog);

  let result = await callModel(sys, turnPrompt(state, catalog, profile, messages), apiKey);

  if (result.product_id && catalog[result.product_id]) state.productId = result.product_id;
  if (typeof result.quantity === "number" && result.quantity) state.quantity = Math.floor(result.quantity);

  // Quantity learned this turn may be below the shop minimum — corrected pass.
  if (state.quantity && state.quantity < smallMin && result.action !== "escalate") {
    result = await callModel(sys, turnPrompt(state, catalog, profile, messages), apiKey);
  }

  let action = result.action || "reply";
  let asked = result.requested_discount_pct;
  const qty = state.quantity || 0;
  const p = state.productId ? catalog[state.productId] : null;

  // The model's arithmetic can be wrong — if it escalated but the implied
  // rate is within bounds, one corrected pass with the math done for it.
  if (action === "escalate" && asked != null && p) {
    const implied = r2(p.list_price * (1 - asked / 100));
    const minAllowed = discountAllowed(state, p) ? floorPrice(p) : p.list_price;
    if (implied >= minAllowed && (!qty || qty >= smallMin) && implied * qty <= bigMax) {
      const correction = `CORRECTION — read carefully: the customer's proposed rate of ${RS}${implied}/pc is NOT below your minimum allowed ${RS}${minAllowed}/pc (${implied} >= ${minAllowed}). Owner approval is NOT needed. Accept it (action close_deal, agreed_unit_price ${implied}) if the customer has confirmed, or counter-offer. Do not mention the owner.`;
      result = await callModel(sys, turnPrompt(state, catalog, profile, messages, correction), apiKey);
      action = result.action || "reply";
      asked = result.requested_discount_pct;
    }
  }

  if (action === "concede") {
    if (qty && qty < smallMin) {
      action = "escalate";
    } else if (p && discountAllowed(state, p) && state.stepIndex < p.discount_steps.length - 1) {
      state.stepIndex += 1;
    } else {
      action = "escalate";
    }
  }

  if (action === "close_deal" && p) {
    const list = p.list_price;
    let unit = typeof result.agreed_unit_price === "number" && result.agreed_unit_price > 0
      ? result.agreed_unit_price : priceAt(p, state.stepIndex);
    unit = r2(Math.min(unit, list));
    const minAllowed = discountAllowed(state, p) ? floorPrice(p) : list;
    const total = unit * qty;
    if (qty && qty < smallMin) {
      action = "escalate";
    } else if (unit < minAllowed) {
      action = "escalate";
      asked = asked ?? r2((1 - unit / list) * 100);
    } else if (total > bigMax) {
      action = "escalate";
      asked = asked ?? maxAutoDiscount(p);
    } else {
      state.status = "closed";
      state.agreedPrice = unit;
    }
  }

  if (action === "escalate") {
    state.status = "pending_approval";
    state.pendingAskPct = asked ?? null;
  }

  return { reply: result.reply || "…", state };
}

async function resolveApproval(business, messages, state, approved, apiKey) {
  const catalog = buildCatalog(business);
  const profile = business.profile;
  const p = state.productId ? catalog[state.productId] : null;
  const sys = systemPrompt(business, catalog);
  let instruction;

  if (approved && p) {
    const finalPrice = state.pendingAskPct != null
      ? r2(p.list_price * (1 - state.pendingAskPct / 100))
      : priceAt(p, state.stepIndex);
    state.agreedPrice = finalPrice;
    state.status = "closed";
    instruction = `OWNER DECISION: APPROVED. You may now confirm the deal at ${RS}${finalPrice}/pc. Send ONLY a fresh short confirmation — do NOT repeat or quote your previous message. State the final math (qty × rate = total) warmly in the customer's language.`;
  } else {
    state.status = "negotiating";
    state.pendingAskPct = null;
    if (p) state.stepIndex = p.discount_steps.length - 1; // now offering the floor
    instruction = `OWNER DECISION: REJECTED. Send ONLY a fresh short message — do NOT repeat or quote your previous message. Politely tell the customer the best you can do is ${RS}${p ? floorPrice(p) : "the listed price"}/pc — final price. Stay warm, invite them to confirm.`;
  }

  const result = await callModel(sys,
    `${briefing(state, catalog, profile)}\n\n${instruction}\n\nCONVERSATION SO FAR:\n${convo(messages)}\n\nReply with ONLY the JSON object (action "close_deal" if approved, else "reply").`,
    apiKey);
  return { reply: result.reply || "…", state };
}

// ---------- handler ----------

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { op, business, messages, state, clientKey } = req.body || {};
    const apiKey = process.env.OPENROUTER_API_KEY || clientKey;
    if (!apiKey) return res.status(400).json({ error: "No API key: set OPENROUTER_API_KEY on the server or add one in the owner console." });
    if (!business || !business.profile) return res.status(400).json({ error: "Missing business config" });

    const st = Object.assign(
      { productId: null, quantity: null, stepIndex: 0, status: "negotiating", pendingAskPct: null, agreedPrice: null },
      state || {});

    let out;
    if (op === "turn") out = await processTurn(business, messages || [], st, apiKey);
    else if (op === "approve") out = await resolveApproval(business, messages || [], st, true, apiKey);
    else if (op === "reject") out = await resolveApproval(business, messages || [], st, false, apiKey);
    else return res.status(400).json({ error: `Unknown op: ${op}` });

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e).slice(0, 300) });
  }
};
