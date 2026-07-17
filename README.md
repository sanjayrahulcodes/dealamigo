# DealAmigo — the B2B marketplace where AI negotiates the deal

**Live: https://dealamigo-seven.vercel.app**

DealAmigo is a marketplace that bridges the gap between small, local businesses
and the bulk buyers who want to order from them. A supplier lists their shop
once; from then on, an AI sales agent does the actual selling — pitching,
haggling in the buyer's own language, and closing the deal — while the owner
sets the limits it can never cross and steps in only for the calls that
actually need a human.

It's built around one belief: **for small businesses, a sale isn't a
fixed-price checkout, it's a negotiation.** Millions of shops sell this way —
over WhatsApp, across the counter, in whatever language the customer speaks —
and no mainstream commerce platform is built for that. DealAmigo is.

## Why DealAmigo stands out

- **It's a negotiation platform, not a storefront.** Every other small-business
  commerce tool (Shopify, Dukaan, a WhatsApp catalog) assumes a fixed price.
  DealAmigo's core product *is* the haggle — the thing that actually happens
  when a wholesale buyer calls a supplier.
- **The AI is an agent, not a chatbot glued onto a price list.** Language and
  numbers are architecturally separate (see below). The model can be as
  persuasive as it wants; it structurally cannot talk itself below the floor
  the owner set.
- **It's a two-sided marketplace, not a single shop's tool.** Buyers get one
  place to discover and deal with multiple wholesale suppliers; owners get a
  real dashboard — analytics, transactions, approvals, floor control — across
  every business they run, not just one bot.
- **The owner never loses control.** Every discount cap, every minimum order
  quantity, every big-order threshold is set by the human who owns the risk.
  The agent's job is to sell hard within those lines and hand off the moment
  it would cross one.
- **It closes the loop.** Deal → letterheaded receipt → WhatsApp handoff for
  delivery/pickup → optional real payment via Razorpay. Nothing ends in a
  screenshot.

## What's in the product

### Landing page
A marketing homepage (`web/index.html`) that pitches the platform: the
negotiation problem, the AI agent's four core behaviors, how it works for
buyers vs. owners, a live product preview, the supplier categories on the
marketplace, and calls to action into sign-up. Smooth scroll-reveal sections,
clean typography, no stock video.

### Authentication (Supabase)
Real accounts, not a demo toggle:
- **Google sign-in** — fully configured and live (OAuth via Supabase Auth).
- **Email + password sign-up/login** — implemented in the app (`login.js`,
  `auth.js`); the Supabase project's email provider just needs to be switched
  on in the dashboard to go live (a one-click setting, not a code change).
- Signing up asks whether you're a **buyer** or a **business owner** and
  routes accordingly — buyers land in the shop directory, owners land in
  their dashboard.
- Route guards (`requireAuth`) protect the directory, shop, and dashboard
  pages from being viewed while signed out.

### Buyer side
- **Shop directory** (`shops.html`) — every business on the platform, with
  search and category filters (Stationery, Hardware, Groceries, Electronics
  and more as owners add them).
- **Shop page** (`shop/`) — a clean overview of the business (about, products,
  ratings) with a **"Chat with us"** button that opens a slide-in chat drawer.
- **The chat itself**: negotiate in Hindi, Telugu, Tamil, or English (mixed
  and romanized script all supported, one language mirrored per reply). The
  agent pitches once, then negotiates.
- **After a deal closes**: a letterheaded receipt, a **Pay Now** button
  (Razorpay Checkout, see below), and one-tap WhatsApp handoff for home
  delivery or store pickup.

### Business owner side — the dashboard (`dashboard.html`)
- **Overview / analytics** — revenue KPIs, a 7-day revenue chart, average
  discount given, and top products by revenue.
- **Transactions** — every closed deal: product, quantity, rate, discount,
  total.
- **Approvals** — when the agent hits a limit it can't cross on its own (a
  price below floor, a tiny order, a huge total), the request lands here with
  the exact economics spelled out. **Approve** and the agent confirms the deal
  in the customer's own language in real time; **Reject** and it holds firm
  at the floor price instead. This runs live across tabs/devices via a shared
  pending-approval queue.
- **Settings & floor** — business profile, negotiation limits (global max
  discount, minimum order quantity, big-order threshold), and the Razorpay
  Key ID for accepting real payments.
- **Multi-business support** — a business switcher in the header, and an
  **"+ Add business"** flow so one owner account can run several shops, each
  with its own inventory, limits, and agent.

### Payments — Razorpay
Once a deal closes, the buyer sees a **Pay Now** button that opens Razorpay's
real checkout using the Key ID the owner configured in Settings. No key
configured yet? The button explains that plainly and falls back to the
existing WhatsApp / pay-on-delivery flow — nothing breaks, nothing fakes a
payment.

## Why it's an agent, not a chatbot

Language and numbers are split on purpose. The LLM (via OpenRouter) only
handles understanding the customer and phrasing replies. A deterministic
state machine (`web/api/chat.js` for the live app; `negotiation.py` in the
original Streamlit prototype) owns every number: the discount step on the
table, the exact next price the model is allowed to offer, the floor derived
from the owner's cap, and the close/escalate decision. Specifically:

- The model is told, each turn, the *one* price it's allowed to offer next —
  nothing else.
- Its claimed action (`concede`, `close_deal`, `escalate`, ...) is validated
  in code before it's allowed to change state.
- **Price-hold protocol**: the first two times a customer asks for a
  discount, the agent must refuse outright — professionally, with a real
  reason, no number offered. Only from the third ask does it start conceding,
  in shrinking steps that push toward (never past) the floor.
- **Precision rule**: if a customer names their own exact price, that number
  is authoritative. The agent will never settle for less discount than
  necessary (if their number is above the floor, it accepts immediately
  instead of continuing to haggle down) and never quietly give away *more*
  discount than the customer actually asked for — a real bug we found and
  fixed, where the agent could close a few paise below a price the customer
  had explicitly named.
- A keyword backstop catches discount requests even on turns where the model
  forgets to self-report one, so the hold protocol can never be silently
  skipped.
- The code even double-checks the model's own arithmetic before honoring an
  escalation, catching cases where it miscompares two numbers.

A persuasive customer can talk to the agent all day; it structurally cannot
be negotiated below what the owner allowed.

## Tech stack

- **Frontend**: static HTML/CSS/vanilla JS — no framework, fast to load,
  fast to deploy.
- **Backend**: one Node serverless function (`web/api/chat.js`) on Vercel,
  running the entire negotiation state machine.
- **LLM**: OpenRouter, default `google/gemini-2.5-flash-lite` (best
  Indic-language quality per rupee); swappable via `OPENROUTER_MODEL`.
- **Auth & data**: Supabase (Postgres + Auth). Schema and row-level security
  policies in [`web/db/schema.sql`](web/db/schema.sql).
- **Payments**: Razorpay Checkout, client-side integration, owner-configured
  key.
- **Hosting**: Vercel (static + serverless in one deploy).

## Repo structure

```
web/                     the deployed product
  index.html, styles.css, main.js       landing page
  login.html/.css/.js                   auth (Google + email via Supabase)
  auth.js                               Supabase client + session helpers
  shops.html/.css/.js                   buyer-facing shop directory
  shop/                                 per-shop overview + chat drawer
  dashboard.html/.css/.js               owner console
  data.js                               shared business/deal/approval data layer
  api/chat.js                           negotiation engine (serverless function)
  db/schema.sql                         Supabase tables + RLS policies

app.py, negotiation.py, system_prompt.py,
billing.py, store.py, config.py         original Streamlit prototype (still runnable)
```

## Run locally

**Web app (the live product):**
```
cd web
npm install
node dev-server.cjs        # serves the static site + /api/chat on :8502
```
Add an `.env` file at the repo root with `OPENROUTER_API_KEY=...` for the
dev server to pick up, or set it in your shell.

**Streamlit prototype (original single-shop version):**
```
pip install -r requirements.txt
copy .env.example .env        # paste your OPENROUTER_API_KEY
streamlit run app.py
```

## Deploy

The `web/` folder deploys as-is on Vercel (static + one serverless function,
`vercel.json` already configured). Set `OPENROUTER_API_KEY` as an environment
variable in your Vercel project.

For auth and multi-tenant data: create a Supabase project, run
[`web/db/schema.sql`](web/db/schema.sql) in its SQL editor, and configure
Google OAuth + email under Authentication → Providers. Point `auth.js` at
your project URL and anon key.

For payments: each business owner adds their own Razorpay Key ID under
Dashboard → Settings & floor.

## Roadmap

- Move business/deal/approval data from the browser's local storage into the
  Supabase tables the schema already defines, so the marketplace works across
  devices, not just one browser.
- Server-side Razorpay order creation + payment verification (currently a
  client-only integration, fine for a demo, not yet production-hardened).
- A real WhatsApp channel via Twilio — the handoff links already point there.
- Voice-note negotiation in and out.
