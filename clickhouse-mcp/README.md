# Official ClickHouse MCP for OPTRANE

This folder deploys the official `mcp-clickhouse` package using Streamable HTTP. The server is explicitly read-only (`CLICKHOUSE_ALLOW_WRITE_ACCESS=false`) and should use a dedicated ClickHouse database user with only SELECT privileges.

The ADK agent connects to:

```
https://YOUR_MCP_HOST/mcp
Authorization: Bearer <CLICKHOUSE_MCP_AUTH_TOKEN>
```

For a quick local test:

```bash
docker build -t optrane-clickhouse-mcp .
docker run --rm -p 8080:8080 --env-file .env optrane-clickhouse-mcp
curl http://localhost:8080/health
```

For production, prefer a private/authenticated ingress path that the Agent Runtime can reach. Do not expose the ClickHouse credentials or MCP token to the desktop application.
