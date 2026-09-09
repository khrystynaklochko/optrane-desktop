FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CLICKHOUSE_MCP_SERVER_TRANSPORT=http \
    CLICKHOUSE_MCP_BIND_HOST=0.0.0.0 \
    CLICKHOUSE_MCP_BIND_PORT=8080 \
    CLICKHOUSE_ALLOW_WRITE_ACCESS=false

RUN pip install --no-cache-dir mcp-clickhouse

EXPOSE 8080
CMD ["python", "-m", "mcp_clickhouse.main"]
