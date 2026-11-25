
from mcp_client import call
from datetime import date, timedelta
import json

tests = [
    ("Inbox", "inbox", "search_emails", {"query": "SK-88421"}),
    ("Ledger", "ledger", "detect_possible_duplicates", {}),
    ("Subscription Traps", "ledger", "detect_subscription_traps", {}),
    ("Transactions", "ledger", "get_recent_transactions", {"days": 30}),
    ("Policy", "policy", "fetch_refund_policy", {
        "merchant_name": "ShopKart",
        "issue_type": "delayed_delivery"
    }),
    ("Approved draft", "inbox", "record_approved_draft", {
        "order_id": "DEMO-ORDER",
        "recipient": "merchant-support@example.test",
        "subject": "ClaimPilot demo approval",
        "body": "Demo-only approval test; no email is sent."
    }),
    ("Calendar", "calendar", "create_reminder", {
        "title": "Follow up on refund",
        "due_date": (date.today() + timedelta(days=1)).isoformat(),
        "notes": "Check refund status"
    }),
    ("Warranty Vault", "vault", "save_warranty", {
        "product": "Laptop",
        "expiry_date": "2027-11-25",
        "serial_number": "LAP12345",
        "file_name": "warranty.pdf"
    })
]

failures = []

for name, server, tool, arguments in tests:
    print(f"\n--- Testing {name} MCP ---")
    try:
        result = call(server, tool, arguments)
        payload = json.loads(result)
        if not isinstance(payload, dict) or "error" in payload:
            raise AssertionError(f"Unexpected tool response: {payload}")
        print(json.dumps(payload, indent=2))
        print("STATUS: SUCCESS")
    except Exception as error:
        print("STATUS: FAILED")
        print(str(error))
        failures.append(name)

if failures:
    raise SystemExit(
        f"MCP integration tests failed: {', '.join(failures)}"
    )
