import { env } from './env.ts';

export interface McpQueryResult {
  rows: Record<string, unknown>[];
  raw: unknown;
}

function parseSse(text: string): unknown {
  const chunks = text.split(/\n\n+/);
  for (const chunk of chunks.reverse()) {
    const data = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!data) continue;
    try { return JSON.parse(data); } catch { /* continue */ }
  }
  throw new Error(`MCP returned unparseable SSE: ${text.slice(0, 500)}`);
}

function extractRows(payload: any): Record<string, unknown>[] {
  if (payload?.error) throw new Error(`MCP JSON-RPC error: ${JSON.stringify(payload.error)}`);
  const result = payload?.result;
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (item?.type !== 'text' || typeof item?.text !== 'string') continue;
    try {
      const parsed = JSON.parse(item.text);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.rows)) return parsed.rows;
      if (Array.isArray(parsed?.data)) return parsed.data;
    } catch { /* another content item may be structured */ }
  }
  if (Array.isArray(result?.structuredContent?.rows)) return result.structuredContent.rows;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

export function mcpConfigured() {
  return Boolean(env.mcpUrl && env.mcpToken);
}

export async function runClickHouseMcpQuery(query: string): Promise<McpQueryResult> {
  if (!mcpConfigured()) throw new Error('CLICKHOUSE_MCP_URL / CLICKHOUSE_MCP_TOKEN are not configured');
  const id = crypto.randomUUID();
  const body = {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: 'run_query',
      arguments: { query },
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'optrane-lovable-backend', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
  const response = await fetch(env.mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.mcpToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'run_query',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`mcp-clickhouse ${response.status}: ${text.slice(0, 1000)}`);
  const payload = response.headers.get('content-type')?.includes('text/event-stream') ? parseSse(text) : JSON.parse(text);
  return { rows: extractRows(payload), raw: payload };
}
