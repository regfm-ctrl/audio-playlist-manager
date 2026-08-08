'use client';

import { useState } from 'react';

type PhantomItem = { playlistId: string; playlistName: string; path: string; fileName: string };
type ReconcileResult = { scanned: number; added: string[]; phantoms: PhantomItem[]; errors: string[] };
type ReconcilePage = { totalPlaylists: number; pageScanned: number; nextOffset: number | null; added: string[]; phantoms: PhantomItem[]; errors: string[] };
type CategoryConflict = { playlistId: string; playlistName: string; category: string; sponsors: { scheduleId: number; campaignId: number; sponsorName: string; createdAt: string }[] };
type RebalanceMove = { scheduleId: number; sponsorName: string; audioFileName: string; audioLocalPath: string; fromPlaylistId: string; fromPlaylistName: string; toPlaylistId: string; toPlaylistName: string };
type RebalanceSkipped = { scheduleId: number; sponsorName: string; playlistName: string; reason: string };
type FixPlan = { overloadedPlaylists: number; moves: RebalanceMove[]; skipped: RebalanceSkipped[] };

const PAGE_SIZE = 30;

export default function AuditPage() {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<CategoryConflict[] | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [fixPlan, setFixPlan] = useState<FixPlan | null>(null);
  const [computingFix, setComputingFix] = useState(false);
  const [applyingFix, setApplyingFix] = useState(false);
  const [fixApplyResult, setFixApplyResult] = useState<{ succeeded: number; failed: string[]; total: number } | null>(null);

  async function checkCategoryConflicts() {
    setCheckingConflicts(true);
    setConflicts(null);
    setFixPlan(null);
    setFixApplyResult(null);
    try {
      const res = await fetch('/api/audit/category-conflicts');
      const data = await res.json();
      setConflicts(data.conflicts || []);
    } finally {
      setCheckingConflicts(false);
    }
  }

  async function computeFixPlan() {
    setComputingFix(true);
    setFixPlan(null);
    setFixApplyResult(null);
    try {
      const res = await fetch('/api/audit/category-conflicts/fix-plan');
      const data = await res.json();
      setFixPlan(data);
    } finally {
      setComputingFix(false);
    }
  }

  async function applyFixPlan() {
    if (!fixPlan || fixPlan.moves.length === 0) return;
    setApplyingFix(true);
    try {
      const res = await fetch('/api/rebalance/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moves: fixPlan.moves }),
      });
      const data = await res.json();
      setFixApplyResult(data);
      setFixPlan(null);
      setConflicts(null); // stale now — re-check to confirm
    } finally {
      setApplyingFix(false);
    }
  }

  async function runAudit() {
    setLoading(true);
    setResult(null);
    setRemoved(new Set());
    setProgress(null);

    const accumulated: ReconcileResult = { scanned: 0, added: [], phantoms: [], errors: [] };
    try {
      let offset = 0;
      while (true) {
        const res = await fetch(`/api/audit/reconcile?offset=${offset}&limit=${PAGE_SIZE}`);
        if (!res.ok) {
          accumulated.errors.push(`Page at offset ${offset} failed: ${res.status}`);
          break;
        }
        const page: ReconcilePage = await res.json();
        accumulated.scanned += page.pageScanned;
        accumulated.added.push(...page.added);
        accumulated.phantoms.push(...page.phantoms);
        accumulated.errors.push(...page.errors);
        setProgress({ done: accumulated.scanned, total: page.totalPlaylists });
        setResult({ ...accumulated }); // show results incrementally as pages complete

        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
    } finally {
      setLoading(false);
    }
  }

  async function removePhantom(item: PhantomItem) {
    const key = `${item.playlistId}:${item.path}`;
    setRemoving(key);
    try {
      await fetch('/api/audit/remove-phantom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId: item.playlistId, path: item.path }),
      });
      setRemoved(prev => new Set(prev).add(key));
    } finally {
      setRemoving(null);
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
          <a href="/audit" style={S.navItemActive}><IconAudit /> Audit</a>
          <a href="/rebalance" style={S.navItem}><IconRebalance /> Rebalance</a>
          <a href="/admin" style={S.navItem}><IconAdmin /> Admin</a>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={S.main}>
        <div style={{ padding: '20px 28px', borderBottom: '0.5px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Audit</h1>
            <p style={{ fontSize: 13, color: '#888', margin: '3px 0 0' }}>Compares every playlist file against what the database expects</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={checkCategoryConflicts} disabled={checkingConflicts}
              style={{ padding: '8px 18px', background: 'white', color: '#0071e3', border: '0.5px solid #0071e3', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: checkingConflicts ? 0.6 : 1 }}>
              {checkingConflicts ? 'Checking...' : 'Check Category Conflicts'}
            </button>
            <button onClick={runAudit} disabled={loading}
              style={{ padding: '8px 18px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
              {loading ? (progress ? `Scanning... ${progress.done}/${progress.total}` : 'Starting...') : 'Run Audit'}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {conflicts !== null && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 800 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px', color: '#1a1a1a' }}>Category Conflicts</p>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                Breaks currently holding more than one active campaign from the same business category — this should never happen.
              </p>
              {conflicts.length === 0 ? (
                <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>None found — every break is clean.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {conflicts.map((c, i) => (
                      <div key={i} style={{ padding: '10px 12px', background: '#fdecec', border: '0.5px solid #f5b8b8', borderRadius: 7 }}>
                        <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 4px', color: '#a02020' }}>
                          {c.playlistName.replace(/\.m3u8$/i, '')} — "{c.category}"
                        </p>
                        {c.sponsors.map(s => (
                          <p key={s.scheduleId} style={{ fontSize: 11, color: '#666', margin: '2px 0' }}>
                            {s.sponsorName} (schedule #{s.scheduleId}, campaign #{s.campaignId}, placed {new Date(s.createdAt).toLocaleDateString('en-AU')})
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                  <button onClick={computeFixPlan} disabled={computingFix}
                    style={{ padding: '7px 16px', background: '#a02020', color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: computingFix ? 0.6 : 1 }}>
                    {computingFix ? 'Computing fix...' : 'Compute Fix Plan'}
                  </button>
                </>
              )}
            </div>
          )}

          {fixApplyResult && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 800 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>
                Fix applied: {fixApplyResult.succeeded} of {fixApplyResult.total} moved successfully
              </p>
              {fixApplyResult.failed.length > 0 && fixApplyResult.failed.map((f, i) => (
                <p key={i} style={{ fontSize: 12, color: '#a02020', margin: '4px 0 0' }}>{f}</p>
              ))}
            </div>
          )}

          {fixPlan && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 800 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>
                  Fix Plan — keeps the oldest campaign in each conflicted break, moves the newer one(s) out
                </p>
                {fixPlan.moves.length > 0 && (
                  <button onClick={applyFixPlan} disabled={applyingFix}
                    style={{ padding: '7px 16px', background: '#0a6e46', color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: applyingFix ? 0.6 : 1 }}>
                    {applyingFix ? 'Applying...' : `Apply ${fixPlan.moves.length} Move${fixPlan.moves.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
              {fixPlan.moves.length === 0 && fixPlan.skipped.length === 0 && (
                <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>Nothing to fix.</p>
              )}
              {fixPlan.moves.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: '#f5f9f7', borderRadius: 7, fontSize: 12, marginBottom: 6 }}>
                  <span style={{ fontWeight: 500 }}>{m.sponsorName}</span>
                  <span style={{ color: '#666' }}>{m.fromPlaylistName.replace(/\.m3u8$/i, '')} <span style={{ color: '#0a6e46' }}>→</span> {m.toPlaylistName.replace(/\.m3u8$/i, '')}</span>
                </div>
              ))}
              {fixPlan.skipped.map((s, i) => (
                <div key={i} style={{ padding: '8px 10px', background: '#faf6ea', borderRadius: 7, marginBottom: 6 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{s.sponsorName} — {s.playlistName.replace(/\.m3u8$/i, '')}</p>
                  <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0' }}>{s.reason}</p>
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
                {progress ? `Scanning playlist ${progress.done} of ${progress.total}...` : 'Starting scan...'} This can take several minutes for a large folder — results below fill in as it goes.
              </p>
              <div style={{ width: '100%', height: 6, background: '#e5e5e5', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: progress ? `${(progress.done / progress.total) * 100}%` : '3%', height: '100%', background: '#0071e3', borderRadius: 3, transition: 'width 0.3s ease-out' }} />
              </div>
            </div>
          )}

          {!loading && !result && (
            <p style={{ color: '#888', textAlign: 'center', padding: 40, fontSize: 13 }}>Run an audit to check whether the playlist files match what's scheduled.</p>
          )}

          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 800 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 24, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{result.scanned}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>Playlists scanned</p>
                </div>
                <div style={{ flex: 1, background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 24, fontWeight: 500, margin: 0, color: '#0a6e46' }}>{result.added.length}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>Missing items auto-added</p>
                </div>
                <div style={{ flex: 1, background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 24, fontWeight: 500, margin: 0, color: '#a06000' }}>{result.phantoms.length}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>Untracked items found</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div style={{ background: '#fdecec', border: '0.5px solid #f5b8b8', borderRadius: 10, padding: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: '#a02020', margin: '0 0 6px' }}>{result.errors.length} error(s)</p>
                  {result.errors.map((e, i) => <p key={i} style={{ fontSize: 12, color: '#a02020', margin: '2px 0' }}>{e}</p>)}
                </div>
              )}

              {result.added.length > 0 && (
                <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px', color: '#1a1a1a' }}>Added ({result.added.length})</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {result.added.map((a, i) => <p key={i} style={{ fontSize: 12, color: '#555', margin: 0 }}>{a}</p>)}
                  </div>
                </div>
              )}

              <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px', color: '#1a1a1a' }}>Untracked content</p>
                <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                  These are sitting in a break with no matching active schedule — could be a manual addition, or leftover from something deleted. Review and remove individually as needed.
                </p>
                {result.phantoms.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>Nothing untracked — every file matches the database.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.phantoms.map((p, i) => {
                      const key = `${p.playlistId}:${p.path}`;
                      const isRemoved = removed.has(key);
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: isRemoved ? '#f0f0f0' : '#faf6ea', borderRadius: 7, opacity: isRemoved ? 0.5 : 1 }}>
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{p.playlistName.replace(/\.m3u8$/i, '')}</p>
                            <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{p.fileName}</p>
                          </div>
                          <button
                            onClick={() => removePhantom(p)}
                            disabled={isRemoved || removing === key}
                            style={{ padding: '5px 12px', background: isRemoved ? '#ccc' : '#cc0000', color: 'white', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: isRemoved ? 'default' : 'pointer' }}>
                            {isRemoved ? 'Removed' : removing === key ? 'Removing...' : 'Remove'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
