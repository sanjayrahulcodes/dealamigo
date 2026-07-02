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

from config import CATALOG, CURRENCY_SYMBOL, BIG_ORDER_THRESHOLD, DEFAULT_MODEL
from system_prompt import build_system_prompt

load_dotenv()

DEALS_LOG = Path(__file__).parent / "output" / "deals.json"


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
        return CATALOG.get(self.product_id) if self.product_id else None

    def price_at(self, step: int) -> float | None:
        p = self.product()
        if not p:
            return None
        steps = p["discount_steps"]
        step = min(step, len(steps) - 1)
        return round(p["list_price"] * (1 - steps[step] / 100), 2)

    def current_price(self) -> float | None:
        return self.price_at(self.step_index)

    def next_price(self) -> float | None:
        p = self.product()
        if not p or self.step_index >= len(p["discount_steps"]) - 1:
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
    nxt = state.next_price()
    if nxt is not None:
        lines.append(f"- If the customer pushes back, your NEXT ALLOWED price is "
                     f"{CURRENCY_SYMBOL}{nxt}/pc. Offer nothing lower.")
    else:
        lines.append(f"- You are AT YOUR FLOOR ({CURRENCY_SYMBOL}{state.current_price()}/pc). "
                     f"You may not concede again. Anything lower => action \"escalate\".")
    lines.append(f"- Hard floor: {CURRENCY_SYMBOL}{state.floor_price()}/pc "
                 f"(max {state.max_auto_discount()}% off). Below this, escalate.")
    lines.append(f"- Orders above {CURRENCY_SYMBOL}{BIG_ORDER_THRESHOLD:,} total also escalate.")
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
            transient = any(t in msg for t in ("429", "500", "502", "503", "timed out", "timeout"))
            if not transient or attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    raise last_err


def _call_model(messages: list[dict], state: DealState) -> dict:
    """messages: [{'role': 'customer'|'agent', 'text': str}, ...]"""
    convo = "\n".join(f"{m['role'].upper()}: {m['text']}" for m in messages)
    prompt = f"{state_briefing(state)}\n\nCONVERSATION SO FAR:\n{convo}\n\nRespond with ONLY the JSON object."
    return _generate(prompt)


def process_turn(messages: list[dict], state: DealState) -> str:
    """Run one customer turn. Mutates state, returns the agent's reply text."""
    result = _call_model(messages, state)

    # Adopt the model's reading of the conversation (facts, not prices).
    if result.get("product_id") in CATALOG:
        state.product_id = result["product_id"]
    if isinstance(result.get("quantity"), (int, float)) and result["quantity"]:
        state.quantity = int(result["quantity"])

    action = result.get("action", "reply")
    asked = result.get("requested_discount_pct")

    # --- validate the action against the state machine -----------------
    if action == "concede":
        if state.next_price() is not None:
            state.step_index += 1
            state.log("concede", f"moved to {CURRENCY_SYMBOL}{state.current_price()}/pc")
        else:
            # Model tried to concede past the floor — force escalation.
            action = "escalate"

    if action == "close_deal":
        total = (state.current_price() or 0) * (state.quantity or 0)
        if total > BIG_ORDER_THRESHOLD:
            action = "escalate"
            asked = asked or state.max_auto_discount()
        else:
            state.status = "closed"
            state.agreed_price = state.current_price()
            state.log("closed", f"{state.quantity} pcs @ {CURRENCY_SYMBOL}{state.agreed_price}/pc")
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
    if approved and state.pending_ask_pct is not None and p:
        final_price = round(p["list_price"] * (1 - state.pending_ask_pct / 100), 2)
        state.agreed_price = final_price
        state.status = "closed"
        state.log("owner_approved", f"{state.pending_ask_pct}% => {CURRENCY_SYMBOL}{final_price}/pc")
        instruction = (f"OWNER DECISION: APPROVED. You may now confirm the deal at "
                       f"{CURRENCY_SYMBOL}{final_price}/pc ({state.pending_ask_pct}% off). "
                       f"Confirm quantity, price and total warmly in the customer's language.")
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
