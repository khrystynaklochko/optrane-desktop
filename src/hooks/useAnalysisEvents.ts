import { useEffect, useRef } from 'react';
import { authorizedFetch } from '../api/client';
import type { AnalysisEvent, ConnectionState } from '../types/optrane';

interface Options {
  url: string | null;
  enabled: boolean;
  onEvent: (event: AnalysisEvent) => void;
  onTerminal: (event: AnalysisEvent) => void;
  onConnection: (state: ConnectionState) => void;
}

function parseSseBlock(block: string): { event: AnalysisEvent | null; id?: string } {
  const lines = block.split('\n');
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim();
  if (!data) return { event: null, id };
  try {
    const raw = JSON.parse(data) as Record<string, any>;
    const type = raw.type ?? raw.eventType ?? raw.event_type ?? 'EVENT';
    const normalizedType = type === 'ANALYSIS_COMPLETED' || type === 'ANALYSIS_COMPLETE' ? 'ANALYSIS_COMPLETE' : type;
    const event: AnalysisEvent = {
      id: raw.id ?? id ?? String(raw.sequence ?? ''),
      type: normalizedType,
      actor: raw.actor ?? raw.agent ?? 'OPTRANE',
      message: raw.message ?? raw.summary ?? normalizedType.replaceAll('_', ' '),
      status: raw.status === 'COMPLETED' ? 'COMPLETE' : (raw.status ?? (normalizedType === 'ANALYSIS_FAILED' ? 'FAILED' : normalizedType === 'ANALYSIS_COMPLETE' ? 'COMPLETE' : 'RUNNING')),
      createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
      payload: raw.payload ?? {},
      sequence: raw.sequence != null ? Number(raw.sequence) : undefined,
    };
    return { event, id };
  } catch { return { event: null, id }; }
}

export function useAnalysisEvents({ url, enabled, onEvent, onTerminal, onConnection }: Options) {
  const seen = useRef(new Set<string>());
  const retries = useRef(0);
  const lastEventId = useRef<string | null>(null);

  useEffect(() => {
    if (!url || !enabled) return;
    let closed = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const connect = async () => {
      if (closed) return;
      controller = new AbortController();
      onConnection(retries.current === 0 ? 'CONNECTING' : 'RECONNECTING');
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (lastEventId.current) headers['Last-Event-ID'] = lastEventId.current;
        const response = await authorizedFetch(url, { signal: controller.signal, headers });
        if (!response.ok || !response.body) throw new Error(`Event stream failed: ${response.status}`);
        retries.current = 0;
        onConnection('CONNECTED');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let terminal = false;
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
            const parsed = parseSseBlock(block);
            const event = parsed.event;
            if (!event) continue;
            const dedupeId = event.id || parsed.id || String(event.sequence ?? '');
            if (dedupeId && seen.current.has(dedupeId)) continue;
            if (dedupeId) seen.current.add(dedupeId);
            lastEventId.current = parsed.id ?? (event.sequence != null ? String(event.sequence) : event.id);
            onEvent(event);
            if (event.type === 'ANALYSIS_COMPLETE' || event.type === 'ANALYSIS_FAILED') {
              terminal = true;
              onConnection(event.type === 'ANALYSIS_COMPLETE' ? 'COMPLETE' : 'FAILED');
              onTerminal(event);
              controller.abort();
              return;
            }
          }
        }
        if (!closed && !terminal) throw new Error('Event stream ended before analysis completed');
      } catch (error) {
        if (closed || (error instanceof DOMException && error.name === 'AbortError')) return;
        retries.current += 1;
        onConnection('RECONNECTING');
        const delay = Math.min(1000 * 2 ** Math.min(retries.current, 5), 12000);
        timer = window.setTimeout(() => void connect(), delay);
      }
    };

    void connect();
    return () => {
      closed = true;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [url, enabled, onEvent, onTerminal, onConnection]);
}
