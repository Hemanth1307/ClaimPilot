import asyncio
import sys
from pathlib import Path
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

HERE = Path(__file__).resolve().parent / "mcp_servers"
FILES = {
    "inbox": "inbox_mcp.py",
    "ledger": "ledger_mcp.py",
    "policy": "policy_mcp.py",
    "calendar": "calendar_mcp.py",
    "vault": "vault_mcp.py"
}


async def _call(server, tool, args, event_callback=None):
    if server not in FILES:
        raise ValueError(f"Unknown MCP server: {server}")

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(HERE / FILES[server])],
        env=None
    )

    async with AsyncExitStack() as stack:
        reader, writer = await stack.enter_async_context(
            stdio_client(params)
        )
        session = await stack.enter_async_context(
            ClientSession(reader, writer)
        )
        await session.initialize()

        if event_callback:
            event_callback("server_connected", {})

        discovered = await session.list_tools()
        tool_names = [item.name for item in discovered.tools]

        if event_callback:
            event_callback("tools_discovered", {"tools": tool_names})

        if tool not in tool_names:
            if event_callback:
                event_callback(
                    "tool_discovery_failed",
                    {"requested_tool": tool}
                )
            raise ValueError(f"MCP tool not found: {tool}")

        if event_callback:
            event_callback(
                "tool_invocation_started",
                {"requested_tool": tool}
            )

        result = await session.call_tool(tool, args)
        if getattr(result, "isError", False):
            if event_callback:
                event_callback("tool_invocation_failed", {})
            raise RuntimeError("MCP server reported a tool error.")

        text = "\n".join(
            item.text
            for item in result.content
            if getattr(item, "text", None)
        )

        if event_callback:
            event_callback(
                "tool_result_received",
                {"character_count": len(text)}
            )

        return text


def call(server, tool, args=None, event_callback=None):
    return asyncio.run(
        _call(server, tool, args or {}, event_callback)
    )


async def _discover_tools(server):
    if server not in FILES:
        raise ValueError(f"Unknown MCP server: {server}")

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(HERE / FILES[server])],
        env=None
    )

    async with AsyncExitStack() as stack:
        reader, writer = await stack.enter_async_context(
            stdio_client(params)
        )
        session = await stack.enter_async_context(
            ClientSession(reader, writer)
        )
        await session.initialize()
        discovered = await session.list_tools()
        return [
            {
                "name": item.name,
                "description": (item.description or "").strip()
            }
            for item in discovered.tools
        ]


def discover_tools(server):
    return asyncio.run(_discover_tools(server))
