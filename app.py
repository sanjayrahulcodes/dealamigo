"""
DealAmigo — AI sales agent for small businesses.
Customer view: product list + negotiation chat.
Business view: profile, inventory, discount limits, approvals, deal history.
Run locally:  streamlit run app.py
"""

import html
import json
import os
from pathlib import Path
from urllib.parse import quote

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

import store
from billing import generate_bill
from config import APP_NAME, CURRENCY_SYMBOL
from negotiation import DEALS_LOG, DealState, process_turn, resolve_approval

st.set_page_config(page_title=APP_NAME, layout="centered",
                   initial_sidebar_state="expanded")

# Streamlit Cloud stores the key in st.secrets; locally .env is used.
try:
    if "OPENROUTER_API_KEY" in st.secrets:
        os.environ.setdefault("OPENROUTER_API_KEY", st.secrets["OPENROUTER_API_KEY"])
except Exception:
    pass

# --- global styles --------------------------------------------------------
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

html, body, [class*="css"] { font-family: 'Inter', -apple-system, sans-serif; }
#MainMenu, footer, header[data-testid="stHeader"] { visibility: hidden; }
.block-container { padding-top: 1.2rem; max-width: 760px; }

.shop-header {
    background: #1f6f54;
    color: #fff;
    border-radius: 12px;
    padding: 18px 22px 14px;
    margin-bottom: 6px;
}
.shop-header .shop-name { font-size: 1.45rem; font-weight: 700; letter-spacing: 0.5px; }
.shop-header .shop-tagline { font-size: 0.85rem; opacity: 0.85; margin-top: 2px; }
.shop-header .brand { float: right; font-size: 0.72rem; opacity: 0.7;
                      border: 1px solid rgba(255,255,255,0.4); border-radius: 20px;
                      padding: 2px 10px; margin-top: 4px; }

.product-card {
    border: 1px solid #e3e3e3;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 10px;
    background: #fbfbf9;
}
.product-card .p-name { font-weight: 600; font-size: 0.92rem; color: #222; }
.product-card .p-price { color: #1f6f54; font-weight: 700; font-size: 1.05rem; margin-top: 2px; }
.product-card .p-meta { color: #888; font-size: 0.78rem; margin-top: 2px; }

.chat-wrap {
    background: #efe7dd;
    border-radius: 12px;
    padding: 14px 12px 6px;
    margin-top: 4px;
}
.chat-row { display: flex; margin: 3px 0 8px; }
.chat-row.customer { justify-content: flex-end; }
.chat-row.agent { justify-content: flex-start; }
.bubble {
    max-width: 78%;
    padding: 7px 12px 8px;
    font-size: 0.92rem;
    line-height: 1.45;
    box-shadow: 0 1px 1px rgba(0,0,0,0.1);
    word-wrap: break-word;
}
.bubble.customer { background: #d9fdd3; color: #111; border-radius: 12px 12px 3px 12px; }
.bubble.agent { background: #ffffff; color: #111; border-radius: 12px 12px 12px 3px; }
.bubble .who { font-size: 0.68rem; color: #1f6f54; font-weight: 600; margin-bottom: 1px; }
</style>
""", unsafe_allow_html=True)


def bubble(role: str, text: str, shop_name: str):
    who = "You" if role == "customer" else shop_name
    safe = html.escape(text).replace("\n", "<br>")
    st.markdown(
        f'<div class="chat-row {role}"><div class="bubble {role}">'
        f'<div class="who">{who}</div>{safe}</div></div>',
        unsafe_allow_html=True,
    )


# --- session state ---------------------------------------------------------
if "messages" not in st.session_state:
    st.session_state.messages = []
    st.session_state.deal = DealState()

messages: list = st.session_state.messages
deal: DealState = st.session_state.deal

data = store.load()
profile = data["profile"]
catalog = store.get_catalog()

# --- sidebar: mode switch ----------------------------------------------------
with st.sidebar:
    st.markdown(f"## {APP_NAME}")
    st.caption("AI sales agent that negotiates in your customer's language — "
               "within limits you control.")
    mode = st.radio("View", ["Customer", "Business"], label_visibility="collapsed")
    st.divider()
    if mode == "Customer":
        st.caption("You are chatting as a customer. The agent negotiates for the shop.")
    else:
        st.caption("Owner console: set up your shop, control discounts, approve deals.")
    if deal.status == "pending_approval":
        st.warning("A deal is waiting for owner approval — open the Business view.")


# ============================ CUSTOMER VIEW =================================
if mode == "Customer":
    st.markdown(
        f'<div class="shop-header"><span class="brand">{APP_NAME}</span>'
        f'<div class="shop-name">{html.escape(profile["business_name"])}</div>'
        f'<div class="shop-tagline">{html.escape(profile.get("tagline", ""))}</div></div>',
        unsafe_allow_html=True,
    )

    with st.expander("Products we offer", expanded=not messages):
        if not catalog:
            st.info("The owner hasn't added products yet — check back soon.")
        cols = st.columns(2)
        for i, p in enumerate(catalog.values()):
            with cols[i % 2]:
                st.markdown(
                    f'<div class="product-card"><div class="p-name">{html.escape(p["name"])}</div>'
                    f'<div class="p-price">{CURRENCY_SYMBOL}{p["list_price"]:g} / {p["unit"]}</div>'
                    f'<div class="p-meta">Bulk pricing from {p["moq"]}+ {p["unit"]}s — ask in chat</div></div>',
                    unsafe_allow_html=True,
                )

    # chat history
    st.markdown('<div class="chat-wrap">', unsafe_allow_html=True)
    if not messages:
        bubble("agent", f"Namaste! Welcome to {profile['business_name']}. "
                        f"Tell me what you need — any language works.", profile["business_name"])
    for m in messages:
        bubble(m["role"], m["text"], profile["business_name"])
    st.markdown('</div>', unsafe_allow_html=True)

    # closed: bill + delivery / pickup via WhatsApp
    if deal.status == "closed":
        total = round((deal.agreed_price or 0) * (deal.quantity or 0), 2)
        p = deal.product()
        st.success(f"Order confirmed — {deal.quantity} × {CURRENCY_SYMBOL}{deal.agreed_price}"
                   f"{' of ' + p['name'] if p else ''} = {CURRENCY_SYMBOL}{total:,}")

        if "bill" not in st.session_state:
            st.session_state.bill = generate_bill(deal)
        bill_html, bill_path = st.session_state.bill
        bill_no = bill_path.stem

        with st.expander("Your receipt", expanded=True):
            components.html(bill_html, height=520, scrolling=True)
            st.download_button("Download receipt", data=bill_html,
                               file_name=bill_path.name, mime="text/html",
                               use_container_width=True)

        st.markdown("**How would you like to get your order?**")
        wa = "".join(c for c in profile.get("whatsapp", "") if c.isdigit())
        order_line = (f"Order {bill_no}: {deal.quantity} x {p['name'] if p else 'item'} @ "
                      f"{CURRENCY_SYMBOL}{deal.agreed_price} = {CURRENCY_SYMBOL}{total:,}")
        col1, col2 = st.columns(2)
        if wa:
            delivery_msg = (f"Hello {profile['business_name']}! {order_line}. "
                            f"I would like HOME DELIVERY please. My address: ")
            pickup_msg = (f"Hello {profile['business_name']}! {order_line}. "
                          f"I will PICK UP from the store. When can I collect it?")
            col1.link_button("Get it delivered (WhatsApp)",
                             f"https://wa.me/{wa}?text={quote(delivery_msg)}",
                             use_container_width=True)
            col2.link_button("Pick up at store (WhatsApp)",
                             f"https://wa.me/{wa}?text={quote(pickup_msg)}",
                             use_container_width=True)
        else:
            st.info("Owner hasn't set a WhatsApp number yet (Business view → Profile).")

        if st.button("Start a new order"):
            st.session_state.messages = []
            st.session_state.deal = DealState()
            st.session_state.pop("bill", None)
            st.rerun()

    # input
    if deal.status == "negotiating":
        if prompt := st.chat_input("Message the shop… any language"):
            messages.append({"role": "customer", "text": prompt})
            with st.spinner("typing…"):
                try:
                    reply = process_turn(messages, deal)
                except Exception as e:
                    reply = f"(connection hiccup — please resend) {e}"
            messages.append({"role": "agent", "text": reply})
            st.rerun()
    elif deal.status == "pending_approval":
        st.info("The shop is checking with the owner about your request — one moment.")
        st.chat_input("Waiting for the shop…", disabled=True)


# ============================ BUSINESS VIEW =================================
else:
    st.markdown(
        f'<div class="shop-header"><span class="brand">{APP_NAME} · owner console</span>'
        f'<div class="shop-name">{html.escape(profile["business_name"])}</div>'
        f'<div class="shop-tagline">Manage your shop, limits and approvals</div></div>',
        unsafe_allow_html=True,
    )

    n_pending = 1 if deal.status == "pending_approval" else 0
    tab_appr, tab_inv, tab_prof, tab_deals = st.tabs(
        [f"Approvals ({n_pending})", "Inventory", "Business profile", "Deal history"])

    # ---- approvals ----
    with tab_appr:
        if deal.status == "pending_approval":
            p = deal.product()
            ask = deal.pending_ask_pct
            with st.container(border=True):
                st.markdown("**Deal waiting for your decision**")
                detail = (f"Customer wants about **{ask}% off**" if ask
                          else "Customer request is outside the agent's authority")
                if p:
                    detail += (f" on **{p['name']}**. Agent's own limit: "
                               f"{deal.max_auto_discount()}% (floor {CURRENCY_SYMBOL}{deal.floor_price()}/pc).")
                if deal.quantity:
                    detail += f" Quantity: **{deal.quantity}**."
                if ask is not None and p:
                    asked_price = round(p["list_price"] * (1 - ask / 100), 2)
                    detail += (f" Approving sells at {CURRENCY_SYMBOL}{asked_price}/pc = "
                               f"{CURRENCY_SYMBOL}{round(asked_price * (deal.quantity or 0), 2):,} total.")
                st.markdown(detail)
                c1, c2 = st.columns(2)
                if c1.button("Approve deal", type="primary", use_container_width=True):
                    with st.spinner("Agent is confirming with the customer…"):
                        reply = resolve_approval(True, messages, deal)
                    messages.append({"role": "agent", "text": reply})
                    st.rerun()
                if c2.button("Reject — hold my floor price", use_container_width=True):
                    with st.spinner("Agent is replying to the customer…"):
                        reply = resolve_approval(False, messages, deal)
                    messages.append({"role": "agent", "text": reply})
                    st.rerun()
            with st.expander("Conversation so far"):
                for m in messages:
                    st.markdown(f"**{'Customer' if m['role'] == 'customer' else 'Agent'}:** {m['text']}")
        else:
            st.caption("No deals waiting for approval. The agent escalates here when a "
                       "customer asks for more than your limits allow.")

    # ---- inventory ----
    with tab_inv:
        st.caption("Your products, exactly as the agent knows them. The agent will never "
                   "discount below the max discount you set here (capped further by the "
                   "global limit in Business profile).")
        inv_df = pd.DataFrame(data["inventory"] or [{
            "name": "", "unit": "piece", "list_price": 0.0,
            "max_discount_pct": 0.0, "moq": 1, "stock": 0, "pitch": ""}])
        edited = st.data_editor(
            inv_df,
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "name": st.column_config.TextColumn("Product", required=True),
                "unit": st.column_config.TextColumn("Unit", help="piece / ream / box / kg"),
                "list_price": st.column_config.NumberColumn(f"List price ({CURRENCY_SYMBOL})",
                                                            min_value=0.0, format="%.2f"),
                "max_discount_pct": st.column_config.NumberColumn("Max discount %",
                                                                  min_value=0.0, max_value=90.0),
                "moq": st.column_config.NumberColumn("Bulk-discount min qty", min_value=1),
                "stock": st.column_config.NumberColumn("Stock", min_value=0),
                "pitch": st.column_config.TextColumn("Selling points (agent uses these)"),
            },
        )
        if st.button("Save inventory", type="primary"):
            rows = [r for r in edited.to_dict("records")
                    if str(r.get("name", "")).strip() and r.get("list_price")]
            data["inventory"] = rows
            store.save(data)
            st.success(f"Saved {len(rows)} products. The agent now sells exactly this list.")
            st.rerun()

    # ---- profile ----
    with tab_prof:
        with st.form("profile_form"):
            st.markdown("**Business details** — these appear on the bill letterhead "
                        "and in the agent's introduction.")
            name = st.text_input("Business name", profile["business_name"])
            tagline = st.text_input("Tagline", profile.get("tagline", ""))
            address = st.text_input("Address", profile.get("address", ""))
            c1, c2 = st.columns(2)
            phone = c1.text_input("Phone", profile.get("phone", ""))
            email = c2.text_input("Email", profile.get("email", ""))
            whatsapp = st.text_input("WhatsApp number (digits with country code, e.g. 9198xxxxxxxx)",
                                     profile.get("whatsapp", ""))
            st.markdown("**Negotiation limits** — the agent can never cross these.")
            c3, c4, c5 = st.columns(3)
            max_disc = c3.number_input("Global max discount %", 0.0, 90.0,
                                       float(profile.get("max_discount_pct", 15)), step=1.0)
            small_min = c4.number_input("Min order qty (below → approval)", 1, 1000,
                                        int(profile.get("small_order_min", 5)))
            big_thresh = c5.number_input(f"Big-order limit ({CURRENCY_SYMBOL})", 1000, 10_000_000,
                                         int(profile.get("big_order_threshold", 15000)), step=1000)
            if st.form_submit_button("Save profile", type="primary"):
                profile.update({
                    "business_name": name.strip() or "My Shop",
                    "tagline": tagline.strip(),
                    "address": address.strip(),
                    "phone": phone.strip(),
                    "email": email.strip(),
                    "whatsapp": "".join(c for c in whatsapp if c.isdigit()),
                    "max_discount_pct": max_disc,
                    "small_order_min": int(small_min),
                    "big_order_threshold": int(big_thresh),
                })
                store.save(data)
                st.success("Saved. Letterhead, agent introduction and limits all updated.")
                st.rerun()

    # ---- deal history ----
    with tab_deals:
        if DEALS_LOG.exists():
            deals = json.loads(Path(DEALS_LOG).read_text(encoding="utf-8"))
            if deals:
                df = pd.DataFrame([{
                    "Closed": d.get("closed_at", ""),
                    "Product": d.get("product", ""),
                    "Qty": d.get("quantity", 0),
                    f"Rate ({CURRENCY_SYMBOL})": d.get("unit_price", 0),
                    f"Total ({CURRENCY_SYMBOL})": d.get("total", 0),
                } for d in reversed(deals)])
                st.dataframe(df, use_container_width=True, hide_index=True)
            else:
                st.caption("No closed deals yet.")
        else:
            st.caption("No closed deals yet — history appears here after the first sale.")
