"""
Static app configuration. Everything the owner can edit (business profile,
inventory, discount caps, thresholds) lives in the Business view and persists
via store.py — not here.
"""

APP_NAME = "DealAmigo"

CURRENCY_SYMBOL = "₹"

SUPPORTED_LANGUAGES = "Hindi, Telugu, Tamil, English — including mixed/romanized script"

# OpenRouter model. Override with env var OPENROUTER_MODEL.
# google/gemini-2.5-flash-lite: best Indic-language quality per rupee.
# Fallback that also works well: openai/gpt-4o-mini
DEFAULT_MODEL = "google/gemini-2.5-flash-lite"
