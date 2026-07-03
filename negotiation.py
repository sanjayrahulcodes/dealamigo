"""
Negotiation engine: a deterministic state machine wrapped around Gemini.

Gemini handles language — understanding the customer and phrasing replies.
This module owns every number: the current discount step, the next allowed
price, the floor, and the auto-close / needs-approval decision. The model is
told each turn exactly what price it may offer, and its claimed action is
validated here before it takes effect, so a persuasive customer can't talk
the LLM below the floor.
"""

import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

from config import CURRENCY_SYMBOL, DEFAULT_MODEL
from store import get_catalog, get_profile
from system_prompt import build_system_prompt

load_dotenv()

DEALS_LOG = Path(__file__).parent / "output" / "deals.json"


def _small_min() -> int:
    return int(get_profile().get("small_order_min", 5))


def _big_threshold() -> float:
    return float(get_profile().get("big_order_threshold", 15000))


@dataclass
class DealState:
    product_id: str | None = None
    quantity: int | None = None
    step_index: int = 0          # index into the product's discount_steps
    status: str = "negotiating"  # negotiating | pending_approval | closed | lost
    pending_ask_pct: float | None = None  # discount the customer wants, awaiting owner
    agreed_price: float | None = None
    events: list = field(default_factory=list)  # negotiation trail for the log

    # --- price helpers -------------------------------------------------
    def product(self):
        return get_catalog().get(self.product_id) if self.product_id else None

    def price_at(self, step: int) -> float | None:
        p = self.product()
        if not p:
            return None
        steps = p["discount_steps"]
        step = min(step, len(steps) - 1)
        return round(p["list_price"] * (1 - steps[step] / 100), 2)

    def current_price(self) -> float | None:
        return self.price_at(self.step_index)

    def discount_allowed(self) -> bool:
        """Discounts only apply at or above the product's bulk minimum."""
        p = self.product()
        if not p:
            return False
        return self.quantity is None or self.quantity >= p["moq"]

    def next_price(self) -> float | None:
        p = self.product()
        if not p or not self.discount_allowed():
            return None
        if self.step_index >= len(p["discount_steps"]) - 1:
            return None  # already at floor
        return self.price_at(self.step_index + 1)

    def floor_price(self) -> float | None:
        p = self.product()
        return self.price_at(len(p["discount_steps"]) - 1) if p else None

    def max_auto_discount(self) -> float | None:
        p = self.product()
        return p["discount_steps"][-1] if p else None

    def log(self, kind: str, detail: str):
        self.events.append({"t": datetime.now().isoformat(timespec="seconds"),
                            "event": kind, "detail": detail})


def state_briefing(state: DealState) -> str:
    """The per-turn injection that tells the model exactly what it may offer."""
    if not state.product():
        return ("CURRENT NEGOTIATION STATE: no product identified yet. "
                "Find out what the customer needs. Quote only list prices.")

    p = state.product()
    lines = [
        "CURRENT NEGOTIATION STATE:",
        f"- Product: {p['name']} (id {state.product_id}), MOQ {p['moq']} pcs",
        f"- Quantity so far: {state.quantity or 'not stated'}",
        f"- Price currently on the table: {CURRENCY_SYMBOL}{state.current_price()}/pc "
        f"(step {state.step_index + 1} of {len(p['discount_steps'])})",
    ]
    if state.quantity is not None and p.get("stock") is not None and state.quantity > p["stock"]:
        lines.append(f"- STOCK LIMIT: only {p['stock']} available right now — the customer wants "
                     f"{state.quantity}. Offer what you can supply; never promise more.")
    qty = state.quantity
    small_min = _small_min()
    if qty is not None and qty < small_min:
        lines.append(f"- QUANTITY {qty} IS BELOW THE SHOP MINIMUM OF {small_min}. "
                     f"You cannot close this order yourself — say you'll check with the "
                     f"owner and set action \"escalate\".")
    elif not state.discount_allowed():
        lines.append(f"- Quantity {qty} is below the bulk-discount minimum of {p['moq']}. "
                     f"NO DISCOUNT at this size — hold list price {CURRENCY_SYMBOL}{p['list_price']}/pc "
                     f"firmly. You may mention discounts start from {p['moq']} pcs.")
    else:
        nxt = state.next_price()
        if nxt is not None:
            lines.append(f"- If the customer pushes back, your NEXT ALLOWED price is "
                         f"{CURRENCY_SYMBOL}{nxt}/pc. Offer nothing lower. Quote it EXACTLY "
                         f"as written — do not round it (say {CURRENCY_SYMBOL}{nxt}, not an approximation).")
        else:
            lines.append(f"- You are AT YOUR FLOOR ({CURRENCY_SYMBOL}{state.current_price()}/pc). "
                         f"You may not concede again. Anything lower => action \"escalate\".")
        lines.append(f"- Hard floor: {CURRENCY_SYMBOL}{state.floor_price()}/pc "
                     f"(max {state.max_auto_discount()}% off). Below this, escalate.")
    lines.append(f"- Orders above {CURRENCY_SYMBOL}{_big_threshold():,.0f} total also escalate.")
    lines.append("- Before closing, always repeat the math (qty × rate = total) and get a "
                 "clear yes. If the customer names a lump-sum total, compute per-piece = "
                 "total ÷ qty, confirm it with them first, and put that exact rate in "
                 "agreed_unit_price when closing.")
    return "\n".join(lines)


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _generate(prompt: str) -> dict:
    """One OpenRouter call with JSON output; retries transient 5xx/429 errors
    so a momentary capacity blip doesn't kill a live demo."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set (env or .env)")
    model = os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)

    last_err = None
    for attempt in range(4):
        try:
            r = requests.post(
                OPENROUTER_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": build_system_prompt()},
                        {"role": "user", "content": prompt},
                    ],
                    "response_format": {"type": "json_object"},
                    "max_tokens": 1024,
                },
                timeout=60,
            )
            data = r.json()
            if "choices" not in data:
                raise RuntimeError(f"OpenRouter error: {data.get('error', data)}")
            raw = data["choices"][0]["message"]["content"].strip().strip("`")
            if raw.startswith("json"):
                raw = raw[4:].strip()
            return json.loads(raw)
        except Exception as e:
            last_err = e
            msg = str(e)
            # Malformed JSON from the model is as retryable as a 5xx.
            transient = isinstance(e, json.JSONDecodeError) or any(
                t in msg for t in ("429", "500", "502", "503", "timed out", "timeout"))
            if not transient or attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    raise last_err


def _call_model(messages: list[dict], state: DealState, extra: str = "") -> dict:
    """messages: [{'role': 'customer'|'agent', 'text': str}, ...]"""
    convo = "\n".join(f"{m['role'].upper()}: {m['text']}" for m in messages)
    extra_block = f"\n\n{extra}" if extra else ""
    prompt = (f"{state_briefing(state)}{extra_block}\n\nCONVERSATION SO FAR:\n{convo}\n\n"
              f"Respond with ONLY the JSON object.")
    return _generate(prompt)


def process_turn(messages: list[dict], state: DealState) -> str:
    """Run one customer turn. Mutates state, returns the agent's reply text."""
    result = _call_model(messages, state)

    # Adopt the model's reading of the conversation (facts, not prices).
    if result.get("product_id") in get_catalog():
        state.product_id = result["product_id"]
    if isinstance(result.get("quantity"), (int, float)) and result["quantity"]:
        state.quantity = int(result["quantity"])

    # The briefing the model saw was built before this turn's quantity was
    # extracted. If the new quantity is below the shop minimum and the model
    # didn't escalate, give it one corrected pass with the updated briefing.
    if (state.quantity and state.quantity < _small_min()
            and result.get("action") != "escalate"):
        result = _call_model(messages, state)

    action = result.get("action", "reply")
    asked = result.get("requested_discount_pct")
    qty = state.quantity or 0

    # The model's arithmetic can be wrong (e.g. calling 9.2 "below" a floor
    # of 8.5). If it escalated but the customer's implied rate is actually
    # within bounds, send it back one corrected pass — Python does the math.
    p = state.product()
    if action == "escalate" and asked is not None and p:
        implied = round(p["list_price"] * (1 - asked / 100), 2)
        min_allowed = p["list_price"] if not state.discount_allowed() else state.floor_price()
        if (implied >= min_allowed
                and (not qty or qty >= _small_min())
                and implied * qty <= _big_threshold()):
            correction = (
                f"CORRECTION — read carefully: the customer's proposed rate of "
                f"{CURRENCY_SYMBOL}{implied}/pc is NOT below your minimum allowed "
                f"{CURRENCY_SYMBOL}{min_allowed}/pc ({implied} >= {min_allowed}). Owner approval "
                f"is NOT needed. Accept it (action close_deal, agreed_unit_price {implied}) "
                f"if the customer has confirmed, or counter-offer. Do not mention the owner.")
            result = _call_model(messages, state, extra=correction)
            action = result.get("action", "reply")
            asked = result.get("requested_discount_pct")

    # --- validate the action against the state machine -----------------

    if action == "concede":
        if qty and qty < _small_min():
            action = "escalate"  # tiny orders always go to the owner
        elif state.next_price() is not None:
            state.step_index += 1
            state.log("concede", f"moved to {CURRENCY_SYMBOL}{state.current_price()}/pc")
        else:
            # Model tried to concede past the floor / below the bulk minimum.
            action = "escalate"

    if action == "close_deal":
        p = state.product()
        list_price = p["list_price"] if p else 0

        # The rate the customer actually confirmed (falls back to the price
        # on the table). Never bill above list.
        unit = result.get("agreed_unit_price")
        if not isinstance(unit, (int, float)) or unit <= 0:
            unit = state.current_price() or list_price
        unit = round(min(float(unit), list_price), 2)

        # Below the bulk minimum only list price is allowed; otherwise the floor.
        min_allowed = list_price if not state.discount_allowed() else (state.floor_price() or 0)
        total = unit * qty

        if qty and qty < _small_min():
            action = "escalate"
            state.log("small_order", f"qty {qty} below shop minimum {_small_min()}")
        elif unit < min_allowed:
            action = "escalate"
            asked = asked or (round((1 - unit / list_price) * 100, 1) if list_price else None)
        elif total > _big_threshold():
            action = "escalate"
            asked = asked or state.max_auto_discount()
        else:
            state.status = "closed"
            state.agreed_price = unit
            state.log("closed", f"{qty} pcs @ {CURRENCY_SYMBOL}{unit}/pc")
            _save_deal(state, messages)

    if action == "escalate":
        state.status = "pending_approval"
        state.pending_ask_pct = asked
        state.log("escalated", f"customer asked ~{asked}% (max auto {state.max_auto_discount()}%)")

    state.log("turn", f"action={action}")
    return result.get("reply", "…")


def resolve_approval(approved: bool, messages: list[dict], state: DealState) -> str:
    """Owner clicked Approve/Reject. Generate the agent's follow-up message."""
    p = state.product()
    if approved and p:
        if state.pending_ask_pct is not None:
            final_price = round(p["list_price"] * (1 - state.pending_ask_pct / 100), 2)
        else:
            # Escalation without a discount ask (e.g. below-minimum quantity):
            # approval means "sell at the price already on the table".
            final_price = state.current_price() or p["list_price"]
        state.agreed_price = final_price
        state.status = "closed"
        state.log("owner_approved", f"=> {CURRENCY_SYMBOL}{final_price}/pc")
        instruction = (f"OWNER DECISION: APPROVED. You may now confirm the deal at "
                       f"{CURRENCY_SYMBOL}{final_price}/pc. Repeat the final math "
                       f"(qty × rate = total) and confirm warmly in the customer's language.")
    else:
        state.status = "negotiating"
        state.pending_ask_pct = None
        # The agent now offers the floor as its final price, so the state
        # must sit at the last step — otherwise a subsequent close_deal
        # would log the pre-escalation price instead of the floor.
        if p:
            state.step_index = len(p["discount_steps"]) - 1
        state.log("owner_rejected", f"holding at floor {CURRENCY_SYMBOL}{state.floor_price()}/pc")
        instruction = (f"OWNER DECISION: REJECTED. Politely tell the customer the best you can "
                       f"do is {CURRENCY_SYMBOL}{state.floor_price()}/pc — final price. Stay warm, "
                       f"remind them of quality/stock, invite them to confirm.")

    convo = "\n".join(f"{m['role'].upper()}: {m['text']}" for m in messages)
    result = _generate(
        f"{state_briefing(state)}\n\n{instruction}\n\nCONVERSATION SO FAR:\n{convo}\n\n"
        f"Reply with ONLY the JSON object (action \"close_deal\" if approved, else \"reply\")."
    )
    reply = result.get("reply", "…")

    if state.status == "closed":
        _save_deal(state, messages)
    return reply


def _save_deal(state: DealState, messages: list[dict]):
    DEALS_LOG.parent.mkdir(exist_ok=True)
    deals = []
    if DEALS_LOG.exists():
        deals = json.loads(DEALS_LOG.read_text(encoding="utf-8"))
    p = state.product()
    deals.append({
        "closed_at": datetime.now().isoformat(timespec="seconds"),
        "product": p["name"] if p else None,
        "quantity": state.quantity,
        "unit_price": state.agreed_price,
        "total": round((state.agreed_price or 0) * (state.quantity or 0), 2),
        "negotiation_trail": state.events,
        "transcript": messages,
    })
    DEALS_LOG.write_text(json.dumps(deals, indent=2, ensure_ascii=False), encoding="utf-8")
