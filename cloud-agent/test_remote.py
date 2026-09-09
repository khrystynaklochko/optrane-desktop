"""Smoke-test an already deployed OPTRANE Agent Runtime resource."""
from __future__ import annotations

import asyncio
import os

import vertexai


async def main() -> None:
    project = os.environ["GOOGLE_CLOUD_PROJECT"]
    location = os.environ["GOOGLE_CLOUD_LOCATION"]
    resource = os.environ["GOOGLE_AGENT_ENGINE_RESOURCE"]
    client = vertexai.Client(project=project, location=location)
    agent = client.agent_engines.get(name=resource)
    message = """OPTRANE_EVIDENCE_QUERY
production_id=smoke-test
You MUST call run_query exactly once with this SELECT:
SELECT 1 AS ok
"""
    saw_call = False
    saw_response = False
    async for event in agent.async_stream_query(user_id="optrane-smoke-test", message=message):
        print(event)
        text = str(event)
        saw_call = saw_call or ("function_call" in text and "run_query" in text)
        saw_response = saw_response or ("function_response" in text and "run_query" in text)
    if not (saw_call and saw_response):
        raise SystemExit("Smoke test failed: run_query call/response was not observed")
    print("PASS: Agent Runtime invoked ClickHouse MCP run_query")


if __name__ == "__main__":
    asyncio.run(main())
