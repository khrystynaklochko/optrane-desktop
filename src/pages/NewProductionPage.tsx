import { useState } from 'react';
import { api } from '../api/client';
import { useOptraneState } from '../state/OptraneState';

export function NewProductionPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [title, setTitle] = useState('');
  const [shootStart, setShootStart] = useState('');
  const [shootEnd, setShootEnd] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title || !shootStart || !shootEnd || !file) return onToast('Complete all fields and choose a PDF screenplay.');
    setBusy(true);
    try {
      const created = await api.createProduction({ title, shoot_start: shootStart, shoot_end: shootEnd });
      await api.uploadScript(created.production_id, file, 'BASELINE', setProgress);
      const dashboard = await api.getDashboard(created.production_id);
      state.setActiveProductionId(created.production_id);
      state.setActiveRevisionVersion(dashboard.currentScriptVersion);
      state.setProduction(dashboard);
      state.setAudit((await api.getAudit(created.production_id)).events);
      state.setScreen('control');
      onToast('Production created and baseline screenplay uploaded.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Production creation failed'); }
    finally { setBusy(false); }
  }

  return <section className="page narrow">
    <span className="eyebrow">NEW PRODUCTION</span><h1>Create a production baseline.</h1><p className="lede">OPTRANE versions the screenplay first, then builds production memory around scenes and operational dependencies.</p>
    <div className="form-grid"><label>Production title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="NIGHTFALL"/></label><label>Shoot start<input type="date" value={shootStart} onChange={(e) => setShootStart(e.target.value)}/></label><label>Shoot end<input type="date" value={shootEnd} onChange={(e) => setShootEnd(e.target.value)}/></label></div>
    <label className="dropzone compact"><input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/><div className="clapper">▰</div><b>{file?.name ?? 'Choose baseline screenplay PDF'}</b><span>{file ? `${(file.size/1024/1024).toFixed(1)} MB` : 'Version 1 will be immutable'}</span></label>
    {busy && <div className="upload-progress"><i style={{ width: `${progress}%` }}/><span>{progress}%</span></div>}
    <button className="primary wide" disabled={busy} onClick={create}>{busy ? 'Creating production…' : 'Create Production'}</button>
  </section>;
}
