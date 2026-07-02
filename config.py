"""
Business context for DealMitra, the AI sales agent.
Edit the catalog and negotiation bounds before your demo — the agent's
concessions and approval escalations are driven entirely by these numbers.
"""

BUSINESS_NAME = "Shree Stationery Mart"

CURRENCY_SYMBOL = "₹"

# Product catalog. Prices are per piece.
# discount_steps: the ONLY discounts the agent may concede on its own, in
# order, one step per customer push-back. The last step is the agent's
# hard floor — anything deeper goes to the owner for approval.
CATALOG = {
    "long_notebook": {
        "name": "Long Notebook 200 pages (single line)",
        "unit": "piece",
        "list_price": 60.0,
        "discount_steps": [0, 5, 10, 15],  # percent
        "moq": 25,
        "pitch": "Thick 58 GSM paper, no ink bleed, hard cover. Schools and coaching centres buy these in bulk from us.",
    },
    "ball_pen": {
        "name": "Blue Ball Pen (0.7mm)",
        "unit": "piece",
        "list_price": 10.0,
        "discount_steps": [0, 5, 10, 15],
        "moq": 50,
        "pitch": "Smooth-writing branded pen, fresh stock. Most offices around here order monthly from us.",
    },
    "hb_pencil": {
        "name": "HB Pencil (pack quality, dark lead)",
        "unit": "piece",
        "list_price": 5.0,
        "discount_steps": [0, 4, 8, 12],
        "moq": 100,
        "pitch": "Dark smooth lead, doesn't break on sharpening. Popular with schools for exam season.",
    },
    "a4_paper": {
        "name": "A4 Copier Paper 75 GSM (500-sheet ream)",
        "unit": "ream",
        "list_price": 280.0,
        "discount_steps": [0, 3, 6, 10],
        "moq": 5,
        "pitch": "Jam-free in all printers and photocopiers, bright white. Offices and print shops take 20-30 reams at a time.",
    },
}

# Any single deal above this total value needs owner approval even if the
# discount is within bounds.
BIG_ORDER_THRESHOLD = 15000

# Languages the agent will happily converse in (it mirrors the customer).
SUPPORTED_LANGUAGES = "Hindi, Telugu, Tamil, English — including mixed/romanized script"

# OpenRouter model. Override with env var OPENROUTER_MODEL.
# google/gemini-2.5-flash-lite: best Indic-language quality per rupee.
# Fallback that also works well: openai/gpt-4o-mini
DEFAULT_MODEL = "google/gemini-2.5-flash-lite"
