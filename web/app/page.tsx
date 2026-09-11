'use client';

import { useEffect, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Capabilities = {
  ready: boolean;
  claude: boolean;
  git: boolean;
  npx: boolean;
};

type JobEvent = { seq: number; type: string; text: string };

export default function Home() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [url, setUrl] = useState('');
  const [context, setContext] = useState('');
  const [seedFile, setSeedFile] = useState('');
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [existingPlanFile, setExistingPlanFile] = useState('');
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [plans, setPlans] = useState<string[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [planContent, setPlanContent] = useState('');
  const sinceRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadHealth() {
    try {
      const r = await fetch(`${API_BASE}/health`);
      const j = await r.json();
      setCaps(j.capabilities);
    } catch {
      setCaps(null);
    }
  }

  async function loadPlans() {
    try {
      const r = await fetch(`${API_BASE}/api/qa/plans`);
      const j = await r.json();
      setPlans(j.plans ?? []);
    } catch {
      setPlans([]);
    }
  }

  useEffect(() => {
    loadHealth();
    loadPlans();
  }, []);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await fetch(`${API_BASE}/api/qa/job-events?since=${sinceRef.current}`);
      const j = await r.json();
      if (j.events?.length) {
        setEvents((prev) => [...prev, ...j.events]);
        sinceRef.current = j.seq;
      }
      setRunning(Boolean(j.running));
      if (!j.running) {
        if (pollRef.current) clearInterval(pollRef.current);
        loadPlans();
      }
    }, 1500);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleGeneratePlan(e: React.FormEvent) {
    e.preventDefault();
    setStatusMsg('');
    setEvents([]);
    sinceRef.current = 0;

    const r = await fetch(`${API_BASE}/api/qa/generate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        context: context || undefined,
        seedFile: seedFile || undefined,
        name: name || undefined,
        fileName: fileName || undefined,
        existingPlanFile: existingPlanFile || undefined,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      setStatusMsg(j.message ?? 'Failed to start plan generation.');
      return;
    }
    setRunning(true);
    startPolling();
  }

  async function handleCancel() {
    await fetch(`${API_BASE}/api/qa/cancel`, { method: 'POST' });
    if (pollRef.current) clearInterval(pollRef.current);
    setRunning(false);
  }

  async function viewPlan(file: string) {
    setSelectedPlan(file);
    const r = await fetch(`${API_BASE}/api/qa/plans/${encodeURIComponent(file)}`);
    setPlanContent(r.ok ? await r.text() : 'Could not load plan.');
  }

  const badge = (label: string, ok: boolean) => (
    <span style={{
      padding: '2px 8px', borderRadius: 6, fontSize: 12, marginRight: 8,
      background: ok ? '#173d2b' : '#3d1717', color: ok ? '#7ee2a8' : '#e27e7e',
      border: `1px solid ${ok ? '#2d6b4a' : '#6b2d2d'}`,
    }}>{label}: {ok ? 'ok' : 'missing'}</span>
  );

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 20px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>QA Workbench</h1>
      <p style={{ color: '#9aa0aa', marginTop: 0 }}>Agentic QA Automation Platform - Phase 1: Plan Generation</p>

      <section style={{ margin: '16px 0' }}>
        {caps ? (
          <div>
            {badge('claude CLI', caps.claude)}
            {badge('git', caps.git)}
            {badge('npx/Playwright', caps.npx)}
            {!caps.ready && (
              <div style={{ marginTop: 8, color: '#e2a97e', fontSize: 13 }}>
                Workbench routes will return 501 until all tooling above is available on this machine.
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#9aa0aa' }}>Checking backend at {API_BASE}...</div>
        )}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h2 style={{ fontSize: 16 }}>Generate Test Plan</h2>
          <form onSubmit={handleGeneratePlan} style={{ display: 'grid', gap: 8 }}>
            <input placeholder="Target application URL *" value={url} onChange={(e) => setUrl(e.target.value)} required style={inputStyle} />
            <textarea placeholder="Pasted context / notes (optional)" value={context} onChange={(e) => setContext(e.target.value)} rows={4} style={inputStyle} />
            <input placeholder="Seed file path (optional, e.g. seeds/login.json)" value={seedFile} onChange={(e) => setSeedFile(e.target.value)} style={inputStyle} />
            <input placeholder="Plan name (optional)" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            <input placeholder="Plan fileName (optional, e.g. app-plan.md)" value={fileName} onChange={(e) => setFileName(e.target.value)} style={inputStyle} />
            <select value={existingPlanFile} onChange={(e) => setExistingPlanFile(e.target.value)} style={inputStyle}>
              <option value="">New plan (no baseline)</option>
              {plans.map((p) => <option key={p} value={p}>Incremental from: {p}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={running || !caps?.ready} style={btnStyle}>
                {running ? 'Running...' : 'Generate Plan'}
              </button>
              <button type="button" onClick={handleCancel} disabled={!running} style={{ ...btnStyle, background: '#3d1717' }}>
                Cancel
              </button>
            </div>
          </form>
          {statusMsg && <p style={{ color: '#e27e7e' }}>{statusMsg}</p>}
        </div>

        <div>
          <h2 style={{ fontSize: 16 }}>Saved Plans</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {plans.length === 0 && <li style={{ color: '#9aa0aa' }}>No plans yet.</li>}
            {plans.map((p) => (
              <li key={p}>
                <button onClick={() => viewPlan(p)} style={{ ...btnStyle, background: 'transparent', border: '1px solid #2a2f3a', width: '100%', textAlign: 'left', marginBottom: 6 }}>
                  {p}
                </button>
              </li>
            ))}
          </ul>
          {selectedPlan && (
            <pre style={{ background: '#12151b', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
              {planContent}
            </pre>
          )}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>Job Output</h2>
        <div style={{ background: '#12151b', borderRadius: 8, padding: 12, height: 320, overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {events.length === 0 && <div style={{ color: '#9aa0aa' }}>No output yet.</div>}
          {events.map((e) => (
            <div key={e.seq} style={{ color: e.type === 'error' ? '#e27e7e' : e.type === 'warn' ? '#e2c07e' : '#c7cbd1' }}>
              {e.text}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#12151b', color: '#e6e8eb', border: '1px solid #2a2f3a', borderRadius: 6, padding: '8px 10px', fontSize: 14,
};

const btnStyle: React.CSSProperties = {
  background: '#26406b', color: '#e6e8eb', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: 'pointer',
};
