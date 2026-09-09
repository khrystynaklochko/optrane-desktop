#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?required}"
: "${GOOGLE_CLOUD_REGION:?required}"
: "${CLICKHOUSE_HOST:?required}"
: "${CLICKHOUSE_USER:?required}"
: "${CLICKHOUSE_PASSWORD:?required}"
: "${CLICKHOUSE_MCP_AUTH_TOKEN:?required}"

SERVICE=${MCP_SERVICE_NAME:-optrane-clickhouse-mcp}

gcloud run deploy "$SERVICE" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$GOOGLE_CLOUD_REGION" \
  --source . \
  --allow-unauthenticated \
  --set-env-vars "CLICKHOUSE_HOST=$CLICKHOUSE_HOST,CLICKHOUSE_PORT=${CLICKHOUSE_PORT:-8443},CLICKHOUSE_USER=$CLICKHOUSE_USER,CLICKHOUSE_PASSWORD=$CLICKHOUSE_PASSWORD,CLICKHOUSE_DATABASE=${CLICKHOUSE_DATABASE:-optrane},CLICKHOUSE_SECURE=true,CLICKHOUSE_ALLOW_WRITE_ACCESS=false,CLICKHOUSE_MCP_SERVER_TRANSPORT=http,CLICKHOUSE_MCP_BIND_HOST=0.0.0.0,CLICKHOUSE_MCP_BIND_PORT=8080,CLICKHOUSE_MCP_AUTH_TOKEN=$CLICKHOUSE_MCP_AUTH_TOKEN"

SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$GOOGLE_CLOUD_PROJECT" --region "$GOOGLE_CLOUD_REGION" --format='value(status.url)')
HOST=${SERVICE_URL#https://}

gcloud run services update "$SERVICE" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$GOOGLE_CLOUD_REGION" \
  --update-env-vars "CLICKHOUSE_MCP_ALLOWED_HOSTS=$HOST"

echo "MCP endpoint: $SERVICE_URL/mcp"
echo "Health endpoint: $SERVICE_URL/health"
echo "The Cloud Run URL is public, but mcp-clickhouse itself requires the static bearer token."
