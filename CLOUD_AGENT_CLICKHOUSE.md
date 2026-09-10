# OPTRANE — Google Cloud Agent Builder + ClickHouse MCP

This repository now contains a complete runtime path for the ClickHouse track:

```text
OPTRANE React/Tauri client
        |
        v
Lovable / Supabase Edge Function (`backend/lovable`)
        |
        | Google OAuth service-account call
        v
Google Cloud Agent Runtime / Vertex AI Agent Builder
        |
        | Google ADK + Gemini
        v
ADK `McpToolset`
        |
        | Streamable HTTP, Bearer auth, `run_query` only
        v
official `mcp-clickhouse` service (`clickhouse-mcp`)
        |
        | SELECT-only ClickHouse user
        v
ClickHouse Cloud (`optrane.production_facts`)
```

## 1. Create ClickHouse objects

Apply:

```bash
clickhouse-client --queries-file backend/lovable/clickhouse/schema.sql
```

Use two credentials in production:

- `optrane_writer`: backend fact/event mirroring only.
- `optrane_mcp_reader`: SELECT-only user used by `mcp-clickhouse`.

Example grants (adapt to your ClickHouse Cloud account policy):

```sql
GRANT SELECT, INSERT ON optrane.* TO optrane_writer;
GRANT SELECT ON optrane.* TO optrane_mcp_reader;
```

The MCP database user should not have write privileges.

## 2. Deploy official mcp-clickhouse

```bash
cd clickhouse-mcp

export GOOGLE_CLOUD_PROJECT=...
export GOOGLE_CLOUD_REGION=us-central1
export CLICKHOUSE_HOST=...
export CLICKHOUSE_USER=optrane_mcp_reader
export CLICKHOUSE_PASSWORD=...
export CLICKHOUSE_DATABASE=optrane
export CLICKHOUSE_MCP_AUTH_TOKEN=$(openssl rand -hex 32)

./deploy-cloud-run.sh
```

The script prints:

```text
https://SERVICE.run.app/mcp
```

Save the URL and bearer token. `CLICKHOUSE_ALLOW_WRITE_ACCESS=false` is set in the container and deployment configuration.

## 3. Deploy the Google ADK agent

```bash
cd ../cloud-agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

gcloud auth application-default login

gcloud services enable aiplatform.googleapis.com storage.googleapis.com

export GOOGLE_CLOUD_PROJECT=...
export GOOGLE_CLOUD_LOCATION=us-central1
export GOOGLE_CLOUD_STAGING_BUCKET=gs://YOUR_BUCKET
export OPTRANE_MCP_URL=https://SERVICE.run.app/mcp
export OPTRANE_MCP_TOKEN=$CLICKHOUSE_MCP_AUTH_TOKEN
export OPTRANE_AGENT_MODEL=gemini-3.5-flash

python deploy.py
```

The script prints a resource name like:

```text
GOOGLE_AGENT_ENGINE_RESOURCE=projects/.../locations/us-central1/reasoningEngines/...
```

The deployed agent uses:

```python
Agent(..., model="gemini-3.5-flash", tools=[McpToolset(...)])
```

and `McpToolset` filters the official server to the `run_query` tool.

## 4. Smoke-test the deployed Agent Runtime

```bash
export GOOGLE_AGENT_ENGINE_RESOURCE=projects/.../reasoningEngines/...
python test_remote.py
```

PASS requires the remote event stream to contain:

```text
function_call: run_query
function_response: run_query
```

## 5. Configure Lovable/Supabase

Deploy the migration and Edge Function from `backend/lovable` and set these server-only secrets:

```text
GEMINI_PROVIDER=vertex
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_CLOUD_PROJECT=...
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_SERVICE_ACCOUNT_JSON=...
GOOGLE_AGENT_ENGINE_RESOURCE=projects/.../reasoningEngines/...

CLICKHOUSE_HTTP_URL=https://CLICKHOUSE_HOST:8443
CLICKHOUSE_USER=optrane_writer
CLICKHOUSE_PASSWORD=...

CLICKHOUSE_MCP_URL=https://SERVICE.run.app/mcp
CLICKHOUSE_MCP_TOKEN=...

OPTRANE_REQUIRE_MCP=true
OPTRANE_REQUIRE_AGENT_RUNTIME=true
```

The Google service account used by the Edge Function must be allowed to query the deployed reasoning engine. Keep its JSON server-side only.

## 6. What happens during analysis

In strict mode:

1. OPTRANE persists the production/revision transactionally in Postgres.
2. The backend mirrors current production facts into ClickHouse.
3. The backend calls the deployed Agent Runtime `:streamQuery` operation.
4. Gemini/ADK invokes `run_query` through `McpToolset`.
5. The Edge Function inspects the returned ADK events.
6. Both the `run_query` function call and function response must be present.
7. Returned ClickHouse rows become the evidence input for deterministic impact rules.
8. If Agent Runtime, MCP, the mirror, or the expected ClickHouse evidence is missing, analysis fails.

The model does not write production state. Human-approved changes continue through the deterministic backend mutation path.

## 7. Desktop proof

Open **Settings & Integrations**. It now reports separately:

- Google Agent Runtime / ADK
- Gemini / Vertex
- ClickHouse
- ClickHouse MCP

During revision analysis the event timeline records:

```text
AGENT_RUNTIME_STARTED
MCP_QUERY_STARTED
AGENT_RUNTIME_COMPLETE
MCP_QUERY_COMPLETE
```

This makes the runtime integration visible in the demo rather than leaving it only in configuration files.
