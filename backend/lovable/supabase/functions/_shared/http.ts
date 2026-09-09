const baseCors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-type',
  'Vary': 'Origin',
};

export function corsHeaders(extra: Record<string, string> = {}) {
  return { ...baseCors, ...extra };
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }),
  });
}

export function noContent(status = 204) {
  return new Response(null, { status, headers: corsHeaders() });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'request_error') {
    super(message);
  }
}

export async function bodyJson<T>(req: Request): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body', 'invalid_json');
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ detail: error.message, code: error.code }, error.status);
  }
  console.error(error);
  return json({ detail: error instanceof Error ? error.message : 'Internal server error', code: 'internal_error' }, 500);
}

export function parseFunctionPath(req: Request) {
  const url = new URL(req.url);
  const marker = '/optrane-api';
  const index = url.pathname.indexOf(marker);
  const suffix = index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname;
  return suffix || '/';
}

export function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: corsHeaders({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    }),
  });
}
