"""
Business context for DealMitra, the AI sales agent.
Edit the catalog and negotiation bounds before your demo — the agent's
concessions and approval escalations are driven entirely by these numbers.
"""

BUSINESS_NAME = "M POWER Fasteners"

CURRENCY_SYMBOL = "₹"

# Product catalog. Prices are per piece.
# discount_steps: the ONLY discounts the agent may concede on its own, in
# order, one step per customer push-back. The last step is the agent's
# hard floor — anything deeper goes to the owner for approval.
CATALOG = {
    "m8_hex_bolt": {
        "name": "M8 x 40mm Hex Bolt (Grade 8.8)",
        "unit": "piece",
        "list_price": 10.0,
        "discount_steps": [0, 4, 8, 12],  # percent
        "moq": 100,
        "pitch": "High-tensile grade 8.8, zinc plated, ISI marked. Trusted by 200+ local workshops.",
    },
    "wall_anchor": {
        "name": "10mm Nylon Wall Anchor with Screw",
        "unit": "piece",
        "list_price": 6.0,
        "discount_steps": [0, 5, 10],
        "moq": 200,
        "pitch": "Heavy-duty nylon, holds up to 40kg in solid brick. Screw included.",
    },
    "ss_screw": {
        "name": "SS-304 Self-Tapping Screw 4x30mm",
        "unit": "piece",
        "list_price": 3.5,
        "discount_steps": [0, 5, 10, 14],
        "moq": 500,
        "pitch": "Rust-proof stainless 304, sharp thread, no pilot hole needed for wood or sheet metal.",
    },
}

# Any single deal above this total value needs owner approval even if the
# discount is within bounds.
BIG_ORDER_THRESHOLD = 25000

# Languages the agent will happily converse in (it mirrors the customer).
SUPPORTED_LANGUAGES = "Hindi, Telugu, Tamil, English — including mixed/romanized script"

# Gemini model. Override with env var GEMINI_MODEL.
DEFAULT_MODEL = "gemini-2.5-flash-lite"
