from mcp.server.fastmcp import FastMCP
from datetime import date
import json
m=FastMCP("ClaimPilot Policy MCP")
@m.tool()
def fetch_refund_policy(merchant_name:str,issue_type:str="delayed_delivery")->str:
    """Return illustrative demo policy guidance, not official terms."""
    return json.dumps({"mode":"illustrative_demo_policy","merchant":merchant_name,"issue_type":issue_type,"source":"Sample policy text created for this prototype — not official merchant policy","retrieved_at":date.today().isoformat(),"guidance":"Contact support with the order ID and promised delivery date. Ask for the current status and available resolution under the merchant's actual terms.","disclaimer":"Verify the merchant's current official policy."})
if __name__=="__main__": m.run()
