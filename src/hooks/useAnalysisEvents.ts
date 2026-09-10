import { useEffect, useRef } from 'react';
import { apiBase, authorizedFetch, usesHostedGateway } from '../api/client';
import type { AnalysisEvent, ConnectionState } from '../types/optrane';

interface Options {
  url: string | null;
  enabled: boolean;
  onEvent: (event: AnalysisEvent) => void;
  onTerminal: (event: AnalysisEvent) => void;
  onConnection: (state: ConnectionState) => void;
}

const STAGE_ACTORS: Record<string, string> = {
  ingest: 'Change Agent',
  breakdown: 'Change Agent',
  diff: 'Change Agent',
  impact: 'Impact Agent',
  recovery: 'Recovery Agent',
};

function normalizeEventType(raw: Record<string, unknown>, sseEvent?: string): string {
  const explicit = raw.type ?? raw.eventType ?? raw.event_type;
  if (typeof explicit === 'string' && explicit.length > 0) {
    const upper = explicit.toUpperCase();
    if (upper === 'ANALYSIS_COMPLETED' || upper === 'ANALYSIS_COMPLETE') return 'ANALYSIS_COMPLETE';
    return upper;
  }

  const sse = (sseEvent ?? '').toLowerCase();
  if (sse === 'done') {
    const status = String(raw.status ?? '').toLowerCase();
    return status === 'failed' || status === 'error' ? 'ANALYSIS_FAILED' : 'ANALYSIS_COMPLETE';
  }

  const stage = String(raw.stage ?? sseEvent ?? 'EVENT').toLowerCase();
  if (stage === 'recovery' && Number(raw.progress ?? 0) >= 100) return 'RECOVERY_COMPLETE';
  return stage.toUpperCase();
}

function rawToAnalysisEvent(raw: Record<string, any>, sseEvent?: string, id?: string): AnalysisEvent {
  const normalizedType = normalizeEventType(raw, sseEvent);
  const stage = String(raw.stage ?? sseEvent ?? '').toLowerCase();
  const actor = raw.actor ?? raw.agent ?? STAGE_ACTORS[stage] ?? 'OPTRANE';
  return {
    id: raw.id ?? id ?? `${normalizedType}-${raw.created_at ?? Date.now()}`,
    type: normalizedType,
    actor,
    message: raw.message ?? raw.summary ?? normalizedType.replaceAll('_', ' '),
    status: raw.status === 'COMPLETED' || raw.status === 'succeeded' || normalizedType === 'ANALYSIS_COMPLETE' || normalizedType === 'RECOVERY_COMPLETE'
      ? 'COMPLETE'
      : (raw.status === 'FAILED' || raw.status === 'failed' || normalizedType === 'ANALYSIS_FAILED' ? 'FAILED' : 'RUNNING'),
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    payload: raw.payload ?? raw,
    sequence: raw.sequence != null ? Number(raw.sequence) : raw.progress != null ? Number(raw.progress) : undefined,
  };
}

function parseSseBlock(block: string): { event: AnalysisEvent | null; id?: string } {
  const lines = block.split('\n');
  const sseEvent = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim();
  if (!data) return { event: null, id };

  try {
    const raw = JSON.parse(data) as Record<string, any>;
    return { event: rawToAnalysisEvent(raw, sseEvent, id), id };
  } catch {
    return { event: null, id };
  }
}

function analysisTerminalStatus(body: Record<string, any>): 'COMPLETE' | 'FAILED' | 'RUNNING' | null {
  const analysis = body.analysis && typeof body.analysis === 'object' ? body.analysis : body;
  const status = String(analysis.status ?? body.status ?? '').toLowerCase();
  if (status === 'succeeded' || status === 'complete' || status === 'completed') return 'COMPLETE';
  if (status === 'failed' || status === 'error') return 'FAILED';
  if (Number(analysis.progress ?? body.progress ?? 0) >= 100 && status !== 'running' && status !== 'in_progress') return 'COMPLETE';
  if (status === 'running' || status === 'in_progress' || status === 'processing' || status === 'queued') return 'RUNNING';
  return null;
}

async function fetchAnalysisSnapshot(analysisId: string): Promise<Record<string, any>> {
  const response = await authorizedFetch(`${apiBase()}/analyses/${analysisId}`);
  if (!response.ok) throw new Error(`Analysis status failed: ${response.status}`);
  return await response.json() as Record<string, any>;
}

function terminalEvent(analysisId: string, type: 'ANALYSIS_COMPLETE' | 'ANALYSIS_FAILED', message: string): AnalysisEvent {
  return {
    id: `${type.toLowerCase()}-${analysisId}`,
    type,
    actor: 'Production Director',
    message,
    status: type === 'ANALYSIS_COMPLETE' ? 'COMPLETE' : 'FAILED',
    createdAt: new Date().toISOString(),
    payload: {},
  };
}

export function useAnalysisEvents({ url, enabled, onEvent, onTerminal, onConnection }: Options) {
  const seen = useRef(new Set<string>());
  const retries = useRef(0);
  const lastEventId = useRef<string | null>(null);

  useEffect(() => {
    if (!url || !enabled) return;
    const analysisId = url.match(/\/analyses\/([^/]+)\/events/)?.[1] ?? null;
    if (!analysisId) return;

    let closed = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const finishTerminal = (event: AnalysisEvent) => {
      onConnection(event.type === 'ANALYSIS_COMPLETE' ? 'COMPLETE' : 'FAILED');
      onTerminal(event);
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };

    const emitSnapshot = (body: Record<string, any>) => {
      const events = (body.events ?? body.analysis?.events ?? []) as Record<string, any>[];
      let lastEvent: AnalysisEvent | null = null;
      for (const raw of events) {
        const event = rawToAnalysisEvent(raw, raw.stage);
        const dedupeId = event.id || String(event.sequence ?? '');
        if (dedupeId && seen.current.has(dedupeId)) continue;
        if (dedupeId) seen.current.add(dedupeId);
        lastEvent = event;
        onEvent(event);
      }
      return lastEvent;
    };

    const pollHostedAnalysis = async () => {
      if (closed) return;
      onConnection(retries.current === 0 ? 'CONNECTING' : 'RECONNECTING');
      try {
        const body = await fetchAnalysisSnapshot(analysisId);
        retries.current = 0;
        onConnection('CONNECTED');
        const lastEvent = emitSnapshot(body);
        const terminal = analysisTerminalStatus(body);
        if (terminal === 'COMPLETE') {
          finishTerminal(terminalEvent(
            analysisId,
            'ANALYSIS_COMPLETE',
            lastEvent?.message ?? 'Analysis complete',
          ));
          return;
        }
        if (terminal === 'FAILED') {
          const analysis = body.analysis ?? body;
          finishTerminal(terminalEvent(
            analysisId,
            'ANALYSIS_FAILED',
            String(analysis.error ?? 'Analysis failed'),
          ));
          return;
        }
        if (lastEvent?.type === 'RECOVERY_COMPLETE') {
          finishTerminal(terminalEvent(analysisId, 'ANALYSIS_COMPLETE', lastEvent.message));
          return;
        }
        timer = window.setTimeout(() => void pollHostedAnalysis(), 1500);
      } catch (error) {
        if (closed) return;
        retries.current += 1;
        if (retries.current > 12) {
          onConnection('FAILED');
          onTerminal(terminalEvent(
            analysisId,
            'ANALYSIS_FAILED',
            error instanceof Error ? error.message : 'Analysis polling failed',
          ));
          return;
        }
        onConnection('RECONNECTING');
        const delay = Math.min(1000 * 2 ** Math.min(retries.current, 4), 8000);
        timer = window.setTimeout(() => void pollHostedAnalysis(), delay);
      }
    };

    const connectSse = async () => {
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
        let lastEvent: AnalysisEvent | null = null;

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
            lastEvent = event;
            onEvent(event);
            if (event.type === 'ANALYSIS_COMPLETE' || event.type === 'ANALYSIS_FAILED') {
              terminal = true;
              finishTerminal(event);
              return;
            }
          }
        }

        if (!closed && !terminal) {
          if (lastEvent?.type === 'RECOVERY_COMPLETE' || (lastEvent?.status === 'COMPLETE' && Number(lastEvent.sequence) >= 100)) {
            finishTerminal(terminalEvent(analysisId, 'ANALYSIS_COMPLETE', lastEvent.message));
            return;
          }
          const body = await fetchAnalysisSnapshot(analysisId);
          emitSnapshot(body);
          const status = analysisTerminalStatus(body);
          if (status === 'COMPLETE') {
            finishTerminal(terminalEvent(analysisId, 'ANALYSIS_COMPLETE', 'Analysis complete'));
            return;
          }
          if (status === 'FAILED') {
            finishTerminal(terminalEvent(analysisId, 'ANALYSIS_FAILED', 'Analysis failed'));
            return;
          }
          throw new Error('Event stream ended before analysis completed');
        }
      } catch (error) {
        if (closed || (error instanceof DOMException && error.name === 'AbortError')) return;
        try {
          const body = await fetchAnalysisSnapshot(analysisId);
          emitSnapshot(body);
          const status = analysisTerminalStatus(body);
          if (status === 'COMPLETE') {
            finishTerminal(terminalEvent(analysisId, 'ANALYSIS_COMPLETE', 'Analysis complete'));
            return;
          }
          if (status === 'FAILED') {
            finishTerminal(terminalEvent(analysisId, 'ANALYSIS_FAILED', 'Analysis failed'));
            return;
          }
        } catch { /* fall through to retry */ }
        retries.current += 1;
        if (retries.current > 8) {
          onConnection('FAILED');
          onTerminal(terminalEvent(analysisId, 'ANALYSIS_FAILED', error instanceof Error ? error.message : 'Analysis stream failed'));
          return;
        }
        onConnection('RECONNECTING');
        const delay = Math.min(1000 * 2 ** Math.min(retries.current, 5), 12000);
        timer = window.setTimeout(() => void connectSse(), delay);
      }
    };

    if (usesHostedGateway()) void pollHostedAnalysis();
    else void connectSse();

    return () => {
      closed = true;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [url, enabled, onEvent, onTerminal, onConnection]);
}
