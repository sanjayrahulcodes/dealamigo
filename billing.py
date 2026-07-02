"""
Bill / receipt generation for closed deals: a clean printable HTML bill with
the shop letterhead. Saved to output/bills/ and offered as a download in the UI.
"""

from datetime import datetime
from pathlib import Path

from config import BUSINESS_NAME, CURRENCY_SYMBOL

BILLS_DIR = Path(__file__).parent / "output" / "bills"

# Letterhead details — edit for your shop.
SHOP_ADDRESS = "Shop No. 12, Main Bazaar Road, Hyderabad — 500001"
SHOP_PHONE = "+91 98xxx xxxxx"
SHOP_EMAIL = "orders@crossword.example"
SHOP_TAGLINE = "Books · Stationery · Office Supplies"


def generate_bill(state, customer_note: str = "") -> tuple[str, Path]:
    """Build the HTML bill for a closed deal. Returns (html, saved_path)."""
    p = state.product()
    now = datetime.now()
    bill_no = f"CW-{now:%Y%m%d-%H%M%S}"
    qty = state.quantity or 0
    rate = state.agreed_price or 0
    list_price = p["list_price"] if p else 0
    line_total = round(qty * rate, 2)
    discount_pct = round((1 - rate / list_price) * 100, 1) if list_price else 0

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Bill {bill_no} — {BUSINESS_NAME}</title>
<style>
  body {{ font-family: Georgia, 'Times New Roman', serif; color: #222; max-width: 700px;
         margin: 40px auto; padding: 0 24px; }}
  .letterhead {{ text-align: center; border-bottom: 3px double #1a3c6e; padding-bottom: 14px; }}
  .letterhead h1 {{ margin: 0; font-size: 30px; letter-spacing: 6px; color: #1a3c6e; }}
  .letterhead .tagline {{ font-style: italic; color: #555; margin: 4px 0; }}
  .letterhead .contact {{ font-size: 12px; color: #666; }}
  .meta {{ display: flex; justify-content: space-between; margin: 22px 0 8px; font-size: 14px; }}
  h2 {{ font-size: 16px; letter-spacing: 2px; color: #1a3c6e; margin: 18px 0 8px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
  th {{ background: #1a3c6e; color: #fff; padding: 8px 10px; text-align: left; }}
  td {{ border-bottom: 1px solid #ddd; padding: 8px 10px; }}
  .num {{ text-align: right; }}
  .total-row td {{ border-top: 2px solid #1a3c6e; border-bottom: none;
                   font-weight: bold; font-size: 16px; }}
  .note {{ font-size: 12px; color: #666; margin-top: 10px; }}
  .footer {{ margin-top: 36px; text-align: center; font-size: 12px; color: #888;
             border-top: 1px solid #ddd; padding-top: 12px; }}
  .sign {{ margin-top: 48px; text-align: right; font-size: 13px; }}
  .sign .line {{ display: inline-block; border-top: 1px solid #444; padding-top: 4px;
                 width: 200px; text-align: center; }}
</style>
</head>
<body>
  <div class="letterhead">
    <h1>{BUSINESS_NAME}</h1>
    <div class="tagline">{SHOP_TAGLINE}</div>
    <div class="contact">{SHOP_ADDRESS}<br>{SHOP_PHONE} · {SHOP_EMAIL}</div>
  </div>

  <div class="meta">
    <div><strong>Bill No:</strong> {bill_no}</div>
    <div><strong>Date:</strong> {now:%d %b %Y, %I:%M %p}</div>
  </div>

  <h2>RECEIPT</h2>
  <table>
    <tr><th>Item</th><th class="num">Qty</th><th class="num">List Price</th>
        <th class="num">Agreed Rate</th><th class="num">Amount</th></tr>
    <tr>
      <td>{p['name'] if p else '—'}</td>
      <td class="num">{qty}</td>
      <td class="num">{CURRENCY_SYMBOL}{list_price:,.2f}</td>
      <td class="num">{CURRENCY_SYMBOL}{rate:,.2f}</td>
      <td class="num">{CURRENCY_SYMBOL}{line_total:,.2f}</td>
    </tr>
    <tr class="total-row">
      <td colspan="4">Grand Total</td>
      <td class="num">{CURRENCY_SYMBOL}{line_total:,.2f}</td>
    </tr>
  </table>
  <div class="note">Negotiated discount: {discount_pct}% off list price.
    {('Note: ' + customer_note) if customer_note else ''}</div>

  <div class="sign"><span class="line">Authorised Signatory<br>{BUSINESS_NAME}</span></div>

  <div class="footer">
    This is a computer-generated receipt issued by the {BUSINESS_NAME} sales agent.<br>
    Goods once sold in good condition. Thank you for your business!
  </div>
</body>
</html>"""

    BILLS_DIR.mkdir(parents=True, exist_ok=True)
    path = BILLS_DIR / f"{bill_no}.html"
    path.write_text(html, encoding="utf-8")
    return html, path
