"""
DealMitra — AI sales agent chat for small businesses.
Run locally:  streamlit run app.py
"""

import streamlit as st

from config import BUSINESS_NAME, CATALOG, CURRENCY_SYMBOL
from negotiation import DealState, process_turn, resolve_approval

st.set_page_config(page_title="DealMitra", page_icon="🤝", layout="centered")

# Streamlit Cloud stores the key in st.secrets; locally .env is used.
import os
try:
    if "GEMINI_API_KEY" in st.secrets:
        os.environ.setdefault("GEMINI_API_KEY", st.secrets["GEMINI_API_KEY"])
except Exception:
    pass  # no secrets.toml locally — .env via python-dotenv covers it

# --- session state ------------------------------------------------------
if "messages" not in st.session_state:
    st.session_state.messages = []
    st.session_state.deal = DealState()

messages: list = st.session_state.messages
deal: DealState = st.session_state.deal

# --- header -------------------------------------------------------------
st.markdown(f"### 🤝 DealMitra")
st.caption(f"AI sales agent for **{BUSINESS_NAME}** — chat in Hindi, Telugu, Tamil or English. "
           f"It pitches, negotiates step by step, and asks the owner before crossing its limits.")

with st.expander("📦 Catalog & negotiation limits (owner view)"):
    for p in CATALOG.values():
        floor = round(p["list_price"] * (1 - p["discount_steps"][-1] / 100), 2)
        st.markdown(
            f"**{p['name']}** — list {CURRENCY_SYMBOL}{p['list_price']}/{p['unit']}, "
            f"agent may discount in steps {p['discount_steps']}% "
            f"(floor {CURRENCY_SYMBOL}{floor}), MOQ {p['moq']} pcs"
        )

st.divider()

# --- chat history --------------------------------------------------------
for m in messages:
    avatar = "🧑" if m["role"] == "customer" else "🤝"
    with st.chat_message("user" if m["role"] == "customer" else "assistant", avatar=avatar):
        st.markdown(m["text"])

# --- approval gate --------------------------------------------------------
if deal.status == "pending_approval":
    p = deal.product()
    ask = deal.pending_ask_pct
    with st.container(border=True):
        st.markdown("#### ⚠️ Owner approval needed")
        detail = f"Customer wants **~{ask}% off**" if ask else "Customer's ask is outside my limits"
        if p:
            detail += (f" on **{p['name']}**"
                       f" (my max is {deal.max_auto_discount()}%, floor {CURRENCY_SYMBOL}{deal.floor_price()}/pc)")
        if deal.quantity:
            detail += f" — qty {deal.quantity} pcs"
        st.markdown(detail)
        col1, col2 = st.columns(2)
        if col1.button("✅ Approve", use_container_width=True, type="primary"):
            with st.spinner("Confirming with customer…"):
                reply = resolve_approval(True, messages, deal)
            messages.append({"role": "agent", "text": reply})
            st.rerun()
        if col2.button("❌ Reject — hold floor price", use_container_width=True):
            with st.spinner("Replying to customer…"):
                reply = resolve_approval(False, messages, deal)
            messages.append({"role": "agent", "text": reply})
            st.rerun()

# --- closed banner ---------------------------------------------------------
if deal.status == "closed":
    total = round((deal.agreed_price or 0) * (deal.quantity or 0), 2)
    p = deal.product()
    st.success(
        f"**Deal closed** — {deal.quantity} pcs × {CURRENCY_SYMBOL}{deal.agreed_price}/pc"
        f"{' of ' + p['name'] if p else ''} = **{CURRENCY_SYMBOL}{total:,}**. Logged to output/deals.json"
    )
    if st.button("🔄 Start new deal"):
        st.session_state.messages = []
        st.session_state.deal = DealState()
        st.rerun()

# --- input -----------------------------------------------------------------
if deal.status in ("negotiating",):
    if prompt := st.chat_input("Type as the customer… e.g. 'bhai M8 bolt 500 piece, best rate?'"):
        messages.append({"role": "customer", "text": prompt})
        with st.chat_message("user", avatar="🧑"):
            st.markdown(prompt)
        with st.chat_message("assistant", avatar="🤝"):
            with st.spinner("DealMitra is typing…"):
                try:
                    reply = process_turn(messages, deal)
                except Exception as e:
                    reply = f"⚠️ Error talking to the model: {e}"
        messages.append({"role": "agent", "text": reply})
        st.rerun()
elif deal.status == "pending_approval":
    st.chat_input("Waiting for owner approval…", disabled=True)
