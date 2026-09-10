# OPTRANE Google Cloud Agent Runtime

This package is the compliance-critical agent runtime used by OPTRANE. It uses Google ADK + Gemini and connects to the official `mcp-clickhouse` server through ADK's native `McpToolset`.

Runtime path:

```
Lovable/Supabase Edge Function
  -> Google Cloud Agent Runtime reasoningEngine:streamQuery
  -> google-adk Agent (Gemini)
  -> McpToolset
  -> official mcp-clickhouse /mcp
  -> ClickHouse Cloud
```

## Deploy

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

gcloud auth application-default login
gcloud services enable aiplatform.googleapis.com storage.googleapis.com

export GOOGLE_CLOUD_PROJECT=...
export GOOGLE_CLOUD_LOCATION=us-central1
export GOOGLE_CLOUD_STAGING_BUCKET=gs://...
export OPTRANE_MCP_URL=https://.../mcp
export OPTRANE_MCP_TOKEN=...
export OPTRANE_AGENT_MODEL=gemini-3.5-flash

python deploy.py
```

Copy the printed `GOOGLE_AGENT_ENGINE_RESOURCE` into the Lovable backend secrets.

## Verify

```bash
export GOOGLE_AGENT_ENGINE_RESOURCE=projects/.../reasoningEngines/...
python test_remote.py
```

The smoke test fails unless the remote ADK event stream contains both a `run_query` function call and its function response.
