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
const HOLD_TURNS = 2; // discount requests refused before the agent will concede at all

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

// Backstop for hold-count tracking: the model is asked to self-report every
// discount request via requested_discount_pct, but LLMs are not perfectly
// reliable at this across languages. This keyword scan on the raw customer
// text catches an ask even when the model's field comes back null, so the
// hold protocol can never be skipped just because the model forgot to flag it.
const DISCOUNT_ASK_RE = /\b(?:kam(?!\s+se\s+kam)|kaam|sasta|chhoot|discount|thakkuva|taggin|kammi|kuraiv|thallu|thallupadi|cheap|lower|less|reduce|off)\b|best\s*price|better\s*price/i;
function looksLikeDiscountAsk(messages) {
  const last = [...messages].reverse().find(m => m.role === "customer");
  return !!(last && DISCOUNT_ASK_RE.test(last.text));
}

// ---------- prompts ----------

function systemPrompt(business, catalog) {
  const prof = business.profile;
  const lines = Object.entries(catalog).map(([pid, p]) =>
    `- id "${pid}": ${p.name} — ${RS}${p.list_price}/${p.unit}, bulk discounts only from ${p.moq} ${p.unit}s, ${p.stock} in stock. Pitch: ${p.pitch}`
  ).join("\n") || "- (owner has not added products yet)";

  return `You are DealAmigo, the senior sales executive at ${prof.business_name} (${prof.tagline || ""}), a shop in India that often sells in bulk.

PERSONA — how you sell:
You sell the way a top private banker pitches to a client: composed, confident, never desperate, always professional. You know your numbers cold and frame everything as value, not price. You build a relationship: use the customer's name if given, remember what they said earlier, reference their situation. When you concede a price step, present it like a considered decision, not a retreat. You are intelligent and adaptive — you read what the customer actually needs, not just what they say, and you never sound scripted or robotic.

NEGOTIATION CRAFT — be genuinely smart about it:
- Read the customer's signals. A price-anchored buyer ("last price bolo") wants speed — get to a fair number quickly once you do concede. A relationship buyer wants attention — give it.
- Hold your ground with substance, not stubbornness: when declining a discount, give a real, confident reason (quality, demand, fair pricing already) — never just "no" and never sound defensive or apologetic about it.
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
2. PRICE HOLD PROTOCOL — the first two times a customer asks for a lower price on a product, you must NOT give any discount and must NOT hint that one might come later. Decline calmly and professionally: the price already reflects the product's quality and fair value, and you're confident in it. Two clean, composed refusals — no new number offered either time. The CURRENT NEGOTIATION STATE tells you exactly which hold you're on; follow it precisely.
3. Only from the customer's THIRD ask does the CURRENT NEGOTIATION STATE allow you to concede. From then on, concede ONE step at a time, only on continued push-back, ONLY at the exact "next allowed price" given in the state. Never invent, round, or improve a price. Frame each concession as a genuine, considered exception ("since you've been reasonable about the quantity, here's what I can do") — never as a habit or a retreat. If the customer ACCEPTS the price on the table, close at that price — never volunteer an unasked discount.
4. Every concession needs a stated reason (bulk, advance payment, repeat customer, pickup).
5. Below your floor: don't agree, don't refuse — say you'll check with the owner; action "escalate". Then wait.
6. Totals above the big-order limit in the state also escalate.
7. QUANTITY RULES:
   - Below the shop's small-order minimum (in the state): you cannot close it yourself — action "escalate".
   - Below the product's bulk-discount minimum: LIST PRICE ONLY, zero discount, no matter what. You may mention where the discount starts.
   - If requested quantity exceeds stock, offer what you can actually supply. Never promise stock you don't have.
8. CONFIRM THE MATH BEFORE CLOSING:
   - Repeat the final numbers (quantity × rate = total) and get a clear yes.
   - Lump-sum totals ("450 me de do sab"): compute per-piece = total ÷ quantity, say the math back, close only after they agree — never the same turn.
   - On close, set "agreed_unit_price" to the exact per-piece rate confirmed — it goes on the printed bill.
   - If the confirmed rate is AT OR ABOVE your floor and nothing else is broken, close it YOURSELF — the owner is only for below-floor prices, tiny orders, or big totals.

OUTPUT FORMAT — respond with ONLY one JSON object, no markdown fences:
{
  "detected_language": string,
  "product_id": string or null,
  "quantity": number or null,
  "requested_discount_pct": number or null,  // set this whenever the customer is asking for a lower
                                             // price, EVEN IF you are going to refuse (hold phase) —
                                             // it's how the system tracks hold count. Leave null if
                                             // they are not asking for a discount this turn.
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
    const holdCount = state.holdCount || 0;
    const inHoldPhase = state.stepIndex === 0 && holdCount < HOLD_TURNS;
    if (inHoldPhase) {
      const holdNumber = holdCount + 1; // which refusal this would be, if they ask again
      lines.push(`- HOLD PHASE — refusal ${holdNumber} of ${HOLD_TURNS}: if the customer asks for a lower price this turn, you must NOT give any discount. Decline calmly and professionally, citing the product's quality/value as the reason the price is fair. Do not name any new price. Action must be "reply". (You may only start conceding once the customer has asked ${HOLD_TURNS + 1} times in total.) IMPORTANT: whenever the customer is asking for a lower price this turn — even though you're refusing — you MUST still set "requested_discount_pct" in your JSON to your best estimate of what they want (e.g. 10 if unclear). This field is REQUIRED on every discount ask, refused or not; only leave it null if they are not asking for a discount at all this turn.`);
    } else {
      const nxt = state.stepIndex < p.discount_steps.length - 1 ? priceAt(p, state.stepIndex + 1) : null;
      if (nxt != null) {
        lines.push(`- The customer has pushed enough — you may now concede if they push again. Your NEXT ALLOWED price is ${RS}${nxt}/pc. Offer nothing lower. Quote it EXACTLY as written — do not round it. Present it as a considered one-time exception, not a habit.`);
      } else {
        lines.push(`- You are AT YOUR FLOOR (${RS}${cur}/pc). You may not concede again. Anything lower => action "escalate".`);
      }
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

  const prevProductId = state.productId;
  if (result.product_id && catalog[result.product_id]) state.productId = result.product_id;
  if (typeof result.quantity === "number" && result.quantity) state.quantity = Math.floor(result.quantity);

  // Switching products resets the hold count — it's a fresh negotiation.
  if (state.productId !== prevProductId) state.holdCount = 0;

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

  // Hold protocol: the first HOLD_TURNS discount asks on a product get refused,
  // no matter what the model decides — this is the one rule that must never
  // depend on the model remembering correctly.
  const askedThisTurn = asked != null || looksLikeDiscountAsk(messages);
  const holdActive = p && discountAllowed(state, p) && state.stepIndex === 0
    && (state.holdCount || 0) < HOLD_TURNS;
  if (holdActive && (action === "concede" || askedThisTurn)) {
    const wasConcede = action === "concede";
    state.holdCount = (state.holdCount || 0) + 1;
    action = "reply";
    if (wasConcede) {
      // The model tried to give a discount early — force a corrected,
      // professional refusal instead of using its (wrong) reply text.
      const correction = `CORRECTION: You may NOT give a discount yet — this is refusal ${state.holdCount} of ${HOLD_TURNS}. Decline calmly and professionally, citing the product's quality/value as the reason the price is fair. Do not name any new price, and do not hint a discount is coming. Action must be "reply".`;
      result = await callModel(sys, turnPrompt(state, catalog, profile, messages, correction), apiKey);
      action = "reply"; // enforced regardless of what the regenerated pass says
    }
  } else if (!holdActive && action === "reply" && askedThisTurn && p && discountAllowed(state, p)
             && state.stepIndex < p.discount_steps.length - 1) {
    // Past the hold phase, the customer pushed again, and the model's own
    // reply already reads like an offer — but it mislabeled the action, so
    // our step counter would silently fall out of sync with what was said.
    // Treat it as the concede it obviously is, so the price on the table
    // (and the next turn's briefing) matches what the customer just heard.
    action = "concede";
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

    // A close during the hold phase at anything below list is really an
    // early concession wearing a different action name — treat it as one.
    if (holdActive && unit < list) {
      state.holdCount = (state.holdCount || 0) + 1;
      const correction = `CORRECTION: You may NOT give a discount yet — this is refusal ${state.holdCount} of ${HOLD_TURNS}. Decline calmly and professionally, citing the product's quality/value. Do not name any new price. Action must be "reply".`;
      result = await callModel(sys, turnPrompt(state, catalog, profile, messages, correction), apiKey);
      return { reply: result.reply || "…", state };
    }
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
      { productId: null, quantity: null, stepIndex: 0, status: "negotiating", pendingAskPct: null, agreedPrice: null, holdCount: 0 },
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
