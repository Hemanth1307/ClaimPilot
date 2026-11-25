from datetime import date, timedelta
import json

from mcp.server.fastmcp import FastMCP


m = FastMCP("ClaimPilot Inbox MCP")


@m.tool()
def search_emails(query: str) -> str:
    """Search seeded order messages and delivery details."""
    samples = [{
        "id": "MAIL-101",
        "subject": "Order confirmation SK-88421",
        "body": (
            "ShopKart order SK-88421, headphones, INR 3050; "
            "the order has not been delivered."
        ),
        "expected_delivery_date": (
            date.today() - timedelta(days=4)
        ).isoformat(),
        "delivery_status": "not_delivered"
    }]
    return json.dumps({
        "mode": "seeded_demo",
        "matches": [
            item
            for item in samples
            if query.lower() in json.dumps(item).lower()
        ]
    })


@m.tool()
def record_approved_draft(
    order_id: str,
    recipient: str,
    subject: str,
    body: str
) -> str:
    """Record user approval in demo; does not send email."""
    return json.dumps({
        "recorded": True,
        "mode": "demo_only",
        "order_id": order_id,
        "message": "Approval recorded. No real email was sent."
    })


if __name__ == "__main__":
    m.run()
