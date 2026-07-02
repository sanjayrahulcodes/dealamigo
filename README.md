# 🤝 DealMitra — AI Sales Agent for Small Businesses

An AI sales agent that chats with customers in their own language (Hindi,
Telugu, Tamil, English — mixed/romanized script included), pitches products,
**negotiates price step by step within owner-set limits**, and **asks the
owner for approval** before crossing any limit.

## Why it's an agent, not a chatbot

Language and numbers are split on purpose:

- **Gemini** handles understanding the customer and phrasing replies in their language.
- **A deterministic Python state machine** ([negotiation.py](negotiation.py)) owns every
  number: the discount step currently on the table, the exact next price the model is
  *allowed* to offer, the hard floor, and the auto-close / needs-approval decision.

Each turn, the model is told exactly what it may offer and nothing more, and the
action it claims ("concede", "close_deal", "escalate") is validated by the state
machine before it takes effect. A persuasive customer can talk to the LLM all day —
it structurally cannot go below the floor price.

## The flow

1. Customer: *"bhai M8 bolt 500 piece chahiye, best rate?"*
2. Agent pitches at list price, in romanized Hindi.
3. Customer haggles → agent concedes **one configured step at a time**
   (e.g. 4% → 8% → 12%), citing a reason each time (bulk qty, advance payment…).
4. Customer demands more than the floor → agent says it must check with the owner.
   Chat pauses. An **Approve / Reject** card appears for the owner.
5. Owner clicks → agent confirms the deal (or holds the floor price) in the
   customer's language. Closed deals are logged to `output/deals.json` with the
   full negotiation trail.

## Run locally

```
pip install -r requirements.txt
copy .env.example .env        # paste your GEMINI_API_KEY (aistudio.google.com/apikey)
streamlit run app.py
```

## Deploy (free, ~3 minutes)

1. Push this folder to a GitHub repo.
2. Go to [share.streamlit.io](https://share.streamlit.io) → New app → pick the repo,
   main file `app.py`.
3. In the app's **Settings → Secrets**, add:
   ```
   GEMINI_API_KEY = "your-key"
   ```
4. Deploy — you get a public `https://<app>.streamlit.app` link.

## Configure for your business

Everything lives in [config.py](config.py): business name, product catalog,
per-product discount steps (the last step **is** the floor), MOQs, and the
big-order threshold that forces owner approval regardless of discount.

## Files

- `app.py` — Streamlit chat UI + inline owner-approval card
- `config.py` — catalog, discount steps, floors, thresholds
- `system_prompt.py` — agent persona + language & negotiation rules
- `negotiation.py` — deal state machine, Gemini calls, deal logging

## Roadmap

- WhatsApp integration via Twilio (the UI already mimics the flow)
- Voice notes in/out (speech-to-text → same pipeline)
- Owner approval over Telegram/SMS instead of the web card
