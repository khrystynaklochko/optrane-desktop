import { useRef, useState, type DragEvent } from 'react';
import { api } from '../api/client';
import { demoChanges } from '../api/mock';
import { useOptraneState } from '../state/OptraneState';
import { isScriptFile, parseScriptFile } from '../utils/scriptImport';
import type { UploadState } from '../types/optrane';

export function ScriptRevisionPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('IDLE');
  const [progress, setProgress] = useState(0);
  const controller = useRef<AbortController | null>(null);

  function choose(candidate: File | null) {
    if (!candidate) return;
    if (!isScriptFile(candidate)) return onToast('OPTRANE accepts screenplay PDF, plain text (.txt), or Final Draft (.fdx) files.');
    setFile(candidate); setUploadState('SELECTED'); setProgress(0);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); choose(event.dataTransfer.files[0] ?? null); }

  async function upload() {
    if (!file) return onToast('Choose a revised screenplay first.');
    controller.current = new AbortController();
    try {
      setUploadState('UPLOADING');
      const parsed = await parseScriptFile(file);
      const uploaded = parsed.kind === 'pdf' && parsed.file
        ? await api.uploadScript(state.activeProductionId, parsed.file, 'REVISION', setProgress, controller.current.signal)
        : await api.uploadScriptContent(state.activeProductionId, {
          title: parsed.name,
          content: parsed.content ?? '',
          label: 'REVISION',
        }, 'REVISION', setProgress);
      setUploadState('VERIFYING');
      const dashboard = await api.getDashboard(state.activeProductionId);
      setUploadState('READY');
      const revisionVersion = uploaded.version || dashboard.currentScriptVersion || 1;
      state.setActiveRevisionVersion(revisionVersion);
      state.setActiveScriptVersionId(uploaded.scriptVersionId ?? null);
      state.setProduction({ ...dashboard, currentScriptVersion: Math.max(dashboard.currentScriptVersion, revisionVersion) });
      state.setChanges(state.activeProductionId === 'nightfall-demo' ? demoChanges : []);
      state.setScreen('change-review');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { setUploadState('SELECTED'); onToast('Upload cancelled. Your selected file is preserved.'); }
      else { setUploadState('FAILED'); onToast(error instanceof Error ? error.message : 'Revision upload failed'); }
    }
  }

  async function loadDemo() {
    try {
      const result = await api.resetDemo();
      state.setActiveProductionId(result.productionId);
      state.setProduction(result.dashboard);
      state.setActiveRevisionVersion(result.dashboard.currentScriptVersion);
      state.setChanges([]);
      state.setScreen('control');
      onToast('NIGHTFALL demo reset through the OPTRANE gateway.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not reset demo'); }
  }

  const demoEnabled = (import.meta.env.VITE_OPTRANE_DEMO_MODE ?? 'true') !== 'false';

  return <section className="page narrow">
    <span className="eyebrow">SCRIPT REVISION · CURRENT V{state.production.currentScriptVersion}</span><h1>What changed?</h1><p className="lede">Drop the latest screenplay. The file is versioned before any analysis begins; production state is never mutated by detection alone.</p>
    <label className={`dropzone ${uploadState === 'FAILED' ? 'failed-drop' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <input type="file" accept="application/pdf,.pdf,.txt,text/plain,.fdx,application/xml" onChange={(e) => choose(e.target.files?.[0] ?? null)} /><div className="clapper">▰</div><b>{file?.name ?? 'Drop revised screenplay'}</b><span>{file ? `${(file.size/1024/1024).toFixed(1)} MB · ${uploadState}` : 'PDF, .txt, or .fdx — converted to plain text client-side'}</span>
    </label>
    {['SIGNING','UPLOADING','VERIFYING'].includes(uploadState) && <div className="upload-progress"><i style={{ width: `${progress}%` }}/><span>{uploadState} · {progress}%</span></div>}
    <div className="button-row"><button className="primary grow" disabled={!file || ['SIGNING','UPLOADING','VERIFYING'].includes(uploadState)} onClick={upload}>{uploadState === 'FAILED' ? 'Retry Upload' : 'Upload Revision'}</button>{uploadState === 'UPLOADING' && <button className="ghost" onClick={() => controller.current?.abort()}>Cancel</button>}</div>
    {demoEnabled && <button className="ghost wide demo-button" onClick={loadDemo}>Reset NIGHTFALL demo through OPTRANE</button>}
  </section>;
}
