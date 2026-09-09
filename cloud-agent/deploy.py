"""Deploy OPTRANE's ADK agent to Google Cloud Agent Runtime."""
from __future__ import annotations

import os

import vertexai
from vertexai import agent_engines, types

from optrane_agent.agent import root_agent


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


project = required("GOOGLE_CLOUD_PROJECT")
location = required("GOOGLE_CLOUD_LOCATION")
staging_bucket = required("GOOGLE_CLOUD_STAGING_BUCKET")
mcp_url = required("OPTRANE_MCP_URL")
mcp_token = required("OPTRANE_MCP_TOKEN")
model = os.environ.get("OPTRANE_AGENT_MODEL", "gemini-3.5-flash")

client = vertexai.Client(project=project, location=location)
app = agent_engines.AdkApp(agent=root_agent)

remote_agent = client.agent_engines.create(
    agent=app,
    config={
        "display_name": "OPTRANE Production Evidence Agent",
        "description": "Gemini/ADK agent that retrieves production evidence through official mcp-clickhouse.",
        "requirements": ["google-cloud-aiplatform[agent_engines,adk]>=1.112"],
        "staging_bucket": staging_bucket,
        "identity_type": types.IdentityType.AGENT_IDENTITY,
        "env_vars": {
            "OPTRANE_MCP_URL": mcp_url,
            "OPTRANE_MCP_TOKEN": mcp_token,
            "OPTRANE_AGENT_MODEL": model,
        },
    },
)

resource = getattr(getattr(remote_agent, "api_resource", None), "name", None)
print("GOOGLE_AGENT_ENGINE_RESOURCE=" + (resource or str(remote_agent)))
