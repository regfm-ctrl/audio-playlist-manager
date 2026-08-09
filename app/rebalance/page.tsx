'use client';

import { useState, useEffect } from 'react';

type RebalanceMove = {
  scheduleId: number;
  sponsorName: string;
  audioFileName: string;
  audioLocalPath: string;
  fromPlaylistId: string;
  fromPlaylistName: string;
  toPlaylistId: string;
  toPlaylistName: string;
};
type RebalanceSkipped = { scheduleId: number; sponsorName: string; playlistName: string; reason: string };
type RebalancePlan = { maxPerPlaylist: number; overloadedPlaylists: number; moves: RebalanceMove[]; skipped: RebalanceSkipped[] };

export default function RebalancePage() {
  const [maxInput, setMaxInput] = useState('2');
  const [plan, setPlan] = useState<RebalancePlan | null>(null);
  const [computing, setComputing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ succeeded: number; failed: string[]; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const token = document.cookie.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
    if (token) {
      try { setIsAdmin(JSON.parse(atob(token.split('.')[1])).role === 'admin'); } catch {}
    }
  }, []);

  async function computePlan() {
    const max = parseInt(maxInput);
    if (!Number.isFinite(max) || max < 1) { setErrorMsg('Enter a valid number of 1 or more.'); return; }
    setComputing(true);
    setErrorMsg('');
    setPlan(null);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/rebalance/plan?max=${max}`);
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || 'Failed to compute plan'); return; }
      setPlan(data);
    } finally {
      setComputing(false);
    }
  }

  async function applyPlan() {
    if (!plan || plan.moves.length === 0) return;
    setApplying(true);
    try {
      const res = await fetch('/api/rebalance/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moves: plan.moves }),
      });
      const data = await res.json();
      setApplyResult(data);
      setPlan(null);
    } finally {
      setApplying(false);
    }
  }

  const IconBreaks = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/></svg>;
  const IconSchedule = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v3.5l2 1.5"/></svg>;
  const IconAdmin = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>;
  const IconCampaign = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h2l2-5 4 10 2-5h2"/></svg>;
  const IconOverview = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="5.5" y1="2.5" x2="5.5" y2="4.5"/><line x1="10.5" y1="2.5" x2="10.5" y2="4.5"/></svg>;
  const IconAudit = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l5.5 2.5v4c0 3.5-2.3 5.9-5.5 7-3.2-1.1-5.5-3.5-5.5-7v-4z"/><path d="M6 8l1.5 1.5L10.5 6.5"/></svg>;
  const IconRebalance = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h7M8 3l2 2-2 2"/><path d="M13 11H6M8 13l-2-2 2-2"/></svg>;

  const S: Record<string, React.CSSProperties> = {
    app: { display: 'flex', height: '100vh', background: '#2a2a2c', fontFamily: 'var(--font-sans)', overflow: 'hidden' },
    sidebar: { width: 260, minWidth: 260, maxWidth: 260, background: '#2a2a2c', borderRight: '0.5px solid #3a3a3c', display: 'flex', flexDirection: 'column', flexShrink: 0 },
    main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
    navItem: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, marginBottom: 2, color: '#777', cursor: 'pointer', fontSize: 13, textDecoration: 'none' as const },
    navItemActive: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: '#0071e3', borderRadius: 8, marginBottom: 2, color: 'white', fontSize: 13, textDecoration: 'none' as const },
  };

  return (
    <div style={S.app}>
      <div style={S.sidebar}>
        <div style={{ padding: '12px 14px 10px', borderBottom: '0.5px solid #3a3a3c' }}>
          <img src="/regfm-logo.png" alt="REGFM" style={{ width: '100%', height: 'auto', borderRadius: 6, display: 'block' }} />
        </div>
        <div style={{ padding: '10px 8px 8px' }}>
          <span style={{ fontSize: 9, color: '#4a4a4c', padding: '0 6px', marginBottom: 5, letterSpacing: '0.1em', fontWeight: 600, display: 'block' }}>MENU</span>
          <a href="/" style={S.navItem}><IconBreaks /> Sponsorship Breaks</a>
          <a href="/schedules" style={S.navItem}><IconSchedule /> Schedules</a>
          <a href="/campaigns" style={S.navItem}><IconCampaign /> Campaigns</a>
          <a href="/schedule-overview" style={S.navItem}><IconOverview /> Weekly Overview</a>
          <a href="/rebalance" style={S.navItemActive}><IconRebalance /> Rebalance</a>
          {isAdmin && <a href="/admin" style={S.navItem}><IconAdmin /> Admin</a>}
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={S.main}>
        <div style={{ padding: '20px 28px', borderBottom: '0.5px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Rebalance</h1>
            <p style={{ fontSize: 13, color: '#888', margin: '3px 0 0' }}>Move excess sponsors out of crowded breaks into emptier ones</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#666' }}>Max per break:</span>
            <input
              value={maxInput}
              onChange={e => setMaxInput(e.target.value.replace(/[^0-9]/g, ''))}
              style={{ width: 50, padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13, textAlign: 'center' }}
            />
            <button onClick={computePlan} disabled={computing}
              style={{ padding: '8px 18px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: computing ? 0.6 : 1 }}>
              {computing ? 'Computing...' : 'Compute Plan'}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {errorMsg && (
            <div style={{ background: '#fdecec', border: '0.5px solid #f5b8b8', borderRadius: 10, padding: 14, marginBottom: 16, color: '#a02020', fontSize: 13 }}>{errorMsg}</div>
          )}

          {applyResult && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 16, maxWidth: 700 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px', color: '#1a1a1a' }}>
                Applied: {applyResult.succeeded} of {applyResult.total} moved successfully
              </p>
              {applyResult.failed.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, color: '#a02020', margin: '8px 0 4px' }}>{applyResult.failed.length} failed:</p>
                  {applyResult.failed.map((f, i) => <p key={i} style={{ fontSize: 12, color: '#a02020', margin: '2px 0' }}>{f}</p>)}
                </div>
              )}
            </div>
          )}

          {!plan && !computing && !applyResult && (
            <p style={{ color: '#888', textAlign: 'center', padding: 40, fontSize: 13 }}>
              Set a max per break and click "Compute Plan" to see what would move — nothing happens until you review it and click Apply.
            </p>
          )}

          {computing && (
            <p style={{ color: '#888', textAlign: 'center', padding: 40, fontSize: 13 }}>Scanning current placements...</p>
          )}

          {plan && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 800 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 24, fontWeight: 500, margin: 0, color: '#a06000' }}>{plan.overloadedPlaylists}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>Breaks over the limit</p>
                </div>
                <div style={{ flex: 1, background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 24, fontWeight: 500, margin: 0, color: '#0a6e46' }}>{plan.moves.length}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>Moves proposed</p>
                </div>
                <div style={{ flex: 1, background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 24, fontWeight: 500, margin: 0, color: '#888' }}>{plan.skipped.length}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>Couldn't move</p>
                </div>
              </div>

              {plan.moves.length === 0 && plan.skipped.length === 0 && (
                <p style={{ fontSize: 13, color: '#0a6e46', textAlign: 'center', padding: 20 }}>Everything's already within the limit — nothing to do.</p>
              )}

              {plan.moves.length > 0 && (
                <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Proposed moves</p>
                    <button onClick={applyPlan} disabled={applying}
                      style={{ padding: '7px 16px', background: '#0a6e46', color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: applying ? 0.6 : 1 }}>
                      {applying ? 'Applying...' : `Apply ${plan.moves.length} Move${plan.moves.length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
                    {plan.moves.map((m, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#f5f9f7', borderRadius: 7, fontSize: 12 }}>
                        <span style={{ fontWeight: 500 }}>{m.sponsorName}</span>
                        <span style={{ color: '#666' }}>
                          {m.fromPlaylistName.replace(/\.m3u8$/i, '')} <span style={{ color: '#0a6e46' }}>→</span> {m.toPlaylistName.replace(/\.m3u8$/i, '')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plan.skipped.length > 0 && (
                <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 12px', color: '#1a1a1a' }}>Couldn't rebalance ({plan.skipped.length})</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                    {plan.skipped.map((s, i) => (
                      <div key={i} style={{ padding: '8px 10px', background: '#faf6ea', borderRadius: 7 }}>
                        <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{s.sponsorName} — {s.playlistName.replace(/\.m3u8$/i, '')}</p>
                        <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0' }}>{s.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
