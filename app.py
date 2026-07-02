"""
DealMitra — AI sales agent chat for small businesses.
Run locally:  streamlit run app.py
"""

import html
import os

import streamlit as st

from config import BUSINESS_NAME, CATALOG, CURRENCY_SYMBOL
from negotiation import DealState, process_turn, resolve_approval

st.set_page_config(page_title="DealMitra", layout="centered")

# Streamlit Cloud stores the key in st.secrets; locally .env is used.
try:
    if "OPENROUTER_API_KEY" in st.secrets:
        os.environ.setdefault("OPENROUTER_API_KEY", st.secrets["OPENROUTER_API_KEY"])
except Exception:
    pass  # no secrets.toml locally — .env via python-dotenv covers it

# --- WhatsApp-style bubbles ----------------------------------------------
st.markdown("""
<style>
.chat-row { display: flex; margin: 3px 0; }
.chat-row.customer { justify-content: flex-end; }
.chat-row.agent { justify-content: flex-start; }
.bubble {
    max-width: 78%;
    padding: 8px 13px;
    font-size: 0.95rem;
    line-height: 1.45;
    box-shadow: 0 1px 1px rgba(0,0,0,0.08);
    word-wrap: break-word;
}
.bubble.customer {
    background: #d9fdd3;
    color: #111;
    border-radius: 14px 14px 3px 14px;
}
.bubble.agent {
    background: #ffffff;
    color: #111;
    border: 1px solid #e6e6e6;
    border-radius: 14px 14px 14px 3px;
}
.bubble .who {
    font-size: 0.7rem;
    color: #667781;
    margin-bottom: 2px;
}
</style>
""", unsafe_allow_html=True)


def bubble(role: str, text: str):
    who = "You (customer)" if role == "customer" else BUSINESS_NAME
    safe = html.escape(text).replace("\n", "<br>")
    st.markdown(
        f'<div class="chat-row {role}"><div class="bubble {role}">'
        f'<div class="who">{who}</div>{safe}</div></div>',
        unsafe_allow_html=True,
    )


# --- session state ------------------------------------------------------
if "messages" not in st.session_state:
    st.session_state.messages = []
    st.session_state.deal = DealState()

messages: list = st.session_state.messages
deal: DealState = st.session_state.deal

# --- header -------------------------------------------------------------
st.markdown(f"### DealMitra · {BUSINESS_NAME}")
st.caption("AI sales agent. Chat in Hindi, Telugu, Tamil or English — it pitches, "
           "negotiates step by step, and asks the owner before crossing its limits.")

with st.expander("Catalog and negotiation limits (owner view)"):
    for p in CATALOG.values():
        floor = round(p["list_price"] * (1 - p["discount_steps"][-1] / 100), 2)
        st.markdown(
            f"**{p['name']}** — list {CURRENCY_SYMBOL}{p['list_price']}/{p['unit']}, "
            f"discount steps {p['discount_steps']}% "
            f"(floor {CURRENCY_SYMBOL}{floor}), MOQ {p['moq']}"
        )

st.divider()

# --- chat history --------------------------------------------------------
for m in messages:
    bubble(m["role"], m["text"])

# --- approval gate --------------------------------------------------------
if deal.status == "pending_approval":
    p = deal.product()
    ask = deal.pending_ask_pct
    with st.container(border=True):
        st.markdown("**Owner approval needed**")
        detail = f"Customer wants about {ask}% off" if ask else "Customer's ask is outside the agent's limits"
        if p:
            detail += (f" on {p['name']} "
                       f"(agent's max is {deal.max_auto_discount()}%, floor {CURRENCY_SYMBOL}{deal.floor_price()})")
        if deal.quantity:
            detail += f" — quantity {deal.quantity}"
        st.markdown(detail)
        col1, col2 = st.columns(2)
        if col1.button("Approve", use_container_width=True, type="primary"):
            with st.spinner("Confirming with customer…"):
                reply = resolve_approval(True, messages, deal)
            messages.append({"role": "agent", "text": reply})
            st.rerun()
        if col2.button("Reject — hold floor price", use_container_width=True):
            with st.spinner("Replying to customer…"):
                reply = resolve_approval(False, messages, deal)
            messages.append({"role": "agent", "text": reply})
            st.rerun()

# --- closed banner ---------------------------------------------------------
if deal.status == "closed":
    total = round((deal.agreed_price or 0) * (deal.quantity or 0), 2)
    p = deal.product()
    st.success(
        f"Deal closed — {deal.quantity} × {CURRENCY_SYMBOL}{deal.agreed_price}"
        f"{' of ' + p['name'] if p else ''} = {CURRENCY_SYMBOL}{total:,}. Logged to output/deals.json"
    )
    if st.button("Start new deal"):
        st.session_state.messages = []
        st.session_state.deal = DealState()
        st.rerun()

# --- input -----------------------------------------------------------------
if deal.status == "negotiating":
    if prompt := st.chat_input("Type as the customer… e.g. 'bhai 50 notebook chahiye, best rate?'"):
        messages.append({"role": "customer", "text": prompt})
        bubble("customer", prompt)
        with st.spinner("typing…"):
            try:
                reply = process_turn(messages, deal)
            except Exception as e:
                reply = f"Error talking to the model: {e}"
        messages.append({"role": "agent", "text": reply})
        st.rerun()
elif deal.status == "pending_approval":
    st.chat_input("Waiting for owner approval…", disabled=True)
