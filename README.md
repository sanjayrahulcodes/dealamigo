# DealAmigo — AI Sales Agent for Small Businesses

An AI sales agent that negotiates with customers in their own language (Hindi,
Telugu, Tamil, English — mixed/romanized script included), within limits the
business owner controls, escalating to the owner only when a deal crosses them —
then generates a letterheaded receipt and hands off delivery/pickup to WhatsApp.

## Two views, one app

**Customer view** — the shop's product list and a WhatsApp-style chat. The
customer haggles in any supported language; the agent pitches once, negotiates
step by step, and closes or escalates. After a deal closes they get the receipt
and two buttons — home delivery or store pickup — each opening WhatsApp with
the order pre-filled.

**Business view** — the owner console:
- **Business profile**: name, tagline, address, phone, email, WhatsApp number —
  all of it feeds the agent's introduction and the bill letterhead.
- **Negotiation limits**: a global max-discount cap the agent can never exceed,
  the minimum order quantity (below it every deal needs the owner), and the
  big-order value that always needs sign-off.
- **Inventory**: an editable product table (price, unit, per-product max
  discount, bulk-discount minimum, stock, selling points). This is the agent's
  entire knowledge of what the shop sells.
- **Approvals**: when a customer wants more than the agent may give, the deal
  appears here with the exact economics; Approve and the agent closes it in the
  customer's language, Reject and it holds the floor price.
- **Deal history**: every closed deal with quantity, rate, and total.

## Why it's an agent, not a chatbot

Language and numbers are split on purpose. The LLM (via OpenRouter) handles
understanding and phrasing; a deterministic state machine
([negotiation.py](negotiation.py)) owns every number — the discount step on the
table, the exact next price the model is allowed to offer, the floor derived
from the owner's cap, and the close/escalate decision. The model is told each
turn what it may offer and nothing more, its claimed action is validated in
code before taking effect, and Python even double-checks the model's arithmetic
(rejecting hallucinated "below floor" escalations). A persuasive customer can
talk to the bot all day and never negotiate it below what the owner set.

## Model

Runs on OpenRouter, default `google/gemini-2.5-flash-lite` (best Indic-language
quality per rupee). Swap via `OPENROUTER_MODEL` in `.env` — e.g.
`openai/gpt-4o-mini` also works.

## Run locally

```
pip install -r requirements.txt
copy .env.example .env        # paste your OPENROUTER_API_KEY (openrouter.ai/keys)
streamlit run app.py
```

## Deploy (free, ~3 minutes)

1. Push this folder to a GitHub repo.
2. [share.streamlit.io](https://share.streamlit.io) → New app → repo, main file `app.py`.
3. App Settings → Secrets: `OPENROUTER_API_KEY = "your-key"`.
4. Deploy — public `https://<app>.streamlit.app` link.

## Files

- `app.py` — Streamlit app: customer chat + business console
- `store.py` — persistent business profile + inventory (data/business.json)
- `system_prompt.py` — agent persona, language rules, selling craft
- `negotiation.py` — deal state machine, OpenRouter calls, deal log
- `billing.py` — letterheaded HTML receipt from the owner's profile
- `config.py` — app constants (name, currency, default model)

## Roadmap

- True WhatsApp channel via Twilio (the handoff links already point there)
- Voice notes in/out
- Multi-deal approval queue backed by a shared store
