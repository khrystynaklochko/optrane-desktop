from __future__ import annotations

from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
checks: list[tuple[str, bool]] = []


def text(path: str) -> str:
    return (ROOT / path).read_text()


def check(name: str, condition: bool) -> None:
    checks.append((name, bool(condition)))

agent = text("cloud-agent/optrane_agent/agent.py")
deploy = text("cloud-agent/deploy.py")
docker = text("clickhouse-mcp/Dockerfile")
runtime = text("backend/lovable/supabase/functions/_shared/agent_runtime.ts")
analysis = text("backend/lovable/supabase/functions/_shared/analysis.ts")
env = text("backend/lovable/supabase/functions/_shared/env.ts")
api = text("backend/lovable/supabase/functions/optrane-api/index.ts")
schema = text("backend/lovable/clickhouse/schema.sql")
desktop_env = text(".env.example")
settings = text("src/pages/SettingsPage.tsx")

check("Google ADK Agent imported", "from google.adk.agents import Agent" in agent)
check("ADK native McpToolset imported", "McpToolset" in agent and "StreamableHTTPConnectionParams" in agent)
check("Only ClickHouse run_query exposed", 'tool_filter=["run_query"]' in agent)
check("Gemini 3.5 Flash default", 'gemini-3.5-flash' in agent)
check("Agent Runtime deployment uses AdkApp", "agent_engines.AdkApp" in deploy)
check("Agent Runtime deployment uses Agent Identity", "IdentityType.AGENT_IDENTITY" in deploy)
check("Agent Runtime deployment passes MCP endpoint", '"OPTRANE_MCP_URL"' in deploy)
check("Official mcp-clickhouse package installed", "mcp-clickhouse" in docker)
check("MCP writes disabled", "CLICKHOUSE_ALLOW_WRITE_ACCESS=false" in docker)
check("Lovable calls reasoningEngine streamQuery", ":streamQuery?alt=sse" in runtime)
check("Lovable verifies run_query function call", "toolCallObserved" in runtime and "run_query" in runtime)
check("Lovable verifies run_query function response", "toolResponseObserved" in runtime)
check("Lovable restricts evidence SQL to SELECT", "SELECT-only" in runtime)
check("Analysis prefers Agent Runtime", "queryClickHouseViaAgentRuntime" in analysis)
check("Strict Agent Runtime flag", "OPTRANE_REQUIRE_AGENT_RUNTIME" in env)
check("Strict MCP flag", "OPTRANE_REQUIRE_MCP" in env)
check("ClickHouse namespace is optrane", "CREATE DATABASE IF NOT EXISTS optrane" in schema)
check("Integration health route exists", "/api/system/integrations" in api)
check("Desktop displays Agent Runtime health", "Google Agent Runtime / ADK" in settings)
check("Desktop does not contain Google service account secret", "GOOGLE_SERVICE_ACCOUNT_JSON" not in desktop_env)
check("Desktop does not contain ClickHouse password", "CLICKHOUSE_PASSWORD" not in desktop_env)
check("Desktop does not contain MCP token", "CLICKHOUSE_MCP_TOKEN" not in desktop_env)

failed = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
print(f"\n{len(checks)-len(failed)}/{len(checks)} integration checks passed")
if failed:
    sys.exit(1)
