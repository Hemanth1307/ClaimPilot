
from mcp.server.fastmcp import FastMCP
from datetime import date, timedelta
import json

m = FastMCP("ClaimPilot Ledger MCP")

# Seeded transactions for the ClaimPilot MVP demo.
today = date.today()
TRANSACTIONS = [
    {
        "id": "TX-7001",
        "merchant": "StreamFlix",
        "amount": 499,
        "date": (today - timedelta(days=1)).isoformat()
    },
    {
        "id": "TX-7002",
        "merchant": "StreamFlix",
        "amount": 499,
        "date": (today - timedelta(days=1)).isoformat()
    },
    {
        "id": "TX-7003",
        "merchant": "CloudDrive Pro",
        "amount": 699,
        "date": (today - timedelta(days=4)).isoformat()
    },
    {
        "id": "TX-7004",
        "merchant": "ShopKart",
        "amount": 3050,
        "date": (today - timedelta(days=6)).isoformat()
    }
]


@m.tool()
def get_recent_transactions(days: int = 30) -> str:
    """Return sample transactions within the requested number of days."""

    if days < 1 or days > 365:
        return json.dumps({
            "error": "Days must be between 1 and 365."
        })

    today = date.today()
    start_date = today - timedelta(days=days)

    filtered = []

    for transaction in TRANSACTIONS:
        transaction_date = date.fromisoformat(
            transaction["date"]
        )

        if start_date <= transaction_date <= today:
            filtered.append(transaction)

    return json.dumps({
        "mode": "seeded_demo",
        "days": days,
        "transactions": filtered
    })


@m.tool()
def detect_possible_duplicates() -> str:
    """Detect matching merchant, amount and date for human review."""

    groups = {}

    for transaction in TRANSACTIONS:
        key = (
            transaction["merchant"].strip().lower(),
            float(transaction["amount"]),
            transaction["date"]
        )

        groups.setdefault(key, []).append(transaction)

    alerts = []

    for (merchant, amount, transaction_date), matches in groups.items():
        if len(matches) > 1:
            alerts.append({
                "merchant": matches[0]["merchant"],
                "amount": amount,
                "date": transaction_date,
                "transaction_ids": [
                    item["id"] for item in matches
                ],
                "label": "Possible duplicate — verify first"
            })

    return json.dumps({
        "mode": "seeded_demo",
        "total_transactions": len(TRANSACTIONS),
        "duplicate_groups": len(alerts),
        "alerts": alerts
    })


@m.tool()
def detect_subscription_traps(extra_transactions_json: str = "[]") -> str:
    """Analyze transactions for recurring subscription traps and renewal risks."""
    try:
        extra = json.loads(extra_transactions_json or "[]")
        if not isinstance(extra, list):
            extra = []
    except json.JSONDecodeError:
        extra = []

    combined = list(TRANSACTIONS)
    seen_ids = {str(item.get("id", "")) for item in combined}
    for item in extra:
        if isinstance(item, dict) and str(item.get("id", "")) not in seen_ids:
            combined.append(item)
            seen_ids.add(str(item.get("id", "")))

    subscription_keywords = (
        "flix", "cloud", "drive", "pro", "plus", "prime", "sub", "music", "stream", "plan"
    )
    by_merchant = {}
    for tx in combined:
        merchant = str(tx.get("merchant", "")).strip()
        amount = float(tx.get("amount", 0) or 0)
        if not merchant or amount <= 0:
            continue
        by_merchant.setdefault(merchant.lower(), []).append(tx)

    traps = []
    for merchant_key, items in by_merchant.items():
        merchant_name = items[0]["merchant"]
        is_keyword_match = any(kw in merchant_key for kw in subscription_keywords)
        is_repeated = len(items) >= 2
        if not (is_keyword_match or is_repeated):
            continue

        latest = sorted(items, key=lambda x: str(x.get("date", "")))[-1]
        monthly_amount = float(latest.get("amount", 0) or 0)
        last_date = date.fromisoformat(str(latest.get("date", date.today().isoformat())))
        next_renewal = (last_date + timedelta(days=30)).isoformat()
        risk = "High" if is_repeated else "Medium"
        reason = (
            f"Multiple charges ({len(items)}) detected on {latest.get('date')} — possible auto-renewal or double billing."
            if is_repeated
            else "Recurring subscription pattern detected; verify if still needed before next renewal."
        )
        traps.append({
            "merchant": merchant_name,
            "monthly_cost": round(monthly_amount, 2),
            "annual_exposure": round(monthly_amount * 12, 2),
            "charge_count": len(items),
            "last_charged": latest.get("date"),
            "estimated_next_renewal": next_renewal,
            "risk_level": risk,
            "reason": reason,
            "transaction_ids": [str(i.get("id", "")) for i in items],
        })

    total_annual = round(sum(t["annual_exposure"] for t in traps), 2)
    return json.dumps({
        "mode": "seeded_demo",
        "analyzed_transactions": len(combined),
        "traps_found": len(traps),
        "total_annual_exposure": total_annual,
        "traps": traps,
    })


if __name__ == "__main__":
    m.run()
