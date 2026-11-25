from mcp.server.fastmcp import FastMCP
from datetime import date
import json

m = FastMCP("ClaimPilot Calendar MCP")


@m.tool()
def create_reminder(
    title: str,
    due_date: str,
    notes: str = ""
) -> str:
    """Validate and prepare a reminder for the ClaimPilot demo."""

    if not title.strip():
        return json.dumps({
            "created": False,
            "error": "Reminder title is required."
        })

    try:
        parsed_date = date.fromisoformat(due_date)
    except (ValueError, TypeError):
        return json.dumps({
            "created": False,
            "error": "Date must use YYYY-MM-DD format."
        })

    if parsed_date < date.today():
        return json.dumps({
            "created": False,
            "error": "Reminder date cannot be in the past."
        })

    return json.dumps({
        "created": True,
        "mode": "demo_only",
        "title": title.strip(),
        "due_date": due_date,
        "notes": notes.strip(),
        "message": "Reminder validated successfully."
    })


if __name__ == "__main__":
    m.run()