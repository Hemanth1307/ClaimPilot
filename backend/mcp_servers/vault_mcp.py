
from mcp.server.fastmcp import FastMCP
from datetime import date
import json

m = FastMCP("ClaimPilot Warranty Vault MCP")


@m.tool()
def save_warranty(
    product: str,
    expiry_date: str,
    serial_number: str = "",
    file_name: str = ""
) -> str:
    """Validate warranty details for the ClaimPilot demo."""

    if not product.strip():
        return json.dumps({
            "prepared": False,
            "error": "Product name is required."
        })

    try:
        parsed_date = date.fromisoformat(expiry_date)
    except (ValueError, TypeError):
        return json.dumps({
            "prepared": False,
            "error": "Expiry date must use YYYY-MM-DD format."
        })

    if len(serial_number) > 100:
        return json.dumps({
            "prepared": False,
            "error": "Serial number is too long."
        })

    if len(file_name) > 255:
        return json.dumps({
            "prepared": False,
            "error": "File name is too long."
        })

    return json.dumps({
        "prepared": True,
        "mode": "demo_only",
        "product": product.strip(),
        "expiry_date": parsed_date.isoformat(),
        "serial_number": serial_number.strip(),
        "file_name": file_name.strip(),
        "message": "Warranty details validated successfully."
    })


if __name__ == "__main__":
    m.run()
