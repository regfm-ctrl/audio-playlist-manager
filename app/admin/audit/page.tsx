'use client';

import { useState } from 'react';

type PhantomItem = { playlistId: string; playlistName: string; path: string; fileName: string };
type ReconcileResult = { scanned: number; added: string[]; phantoms: PhantomItem[]; errors: string[] };
type ReconcilePage = { totalPlaylists: number; pageScanned: number; nextOffset: number | null; added: string[]; phantoms: PhantomItem[]; errors: string[] };
type CategoryConflict = { playlistId: string; playlistName: string; category: string; sponsors: { scheduleId: number; campaignId: number; sponsorName: string; createdAt: string }[] };
type RebalanceMove = { scheduleId: number; sponsorName: string; audioFileName: string; audioLocalPath: string; fromPlaylistId: string; fromPlaylistName: string; toPlaylistId: string; toPlaylistName: string };
type RebalanceSkipped = { scheduleId: number; sponsorName: string; playlistName: string; reason: string };
type FixPlan = { overloadedPlaylists: number; moves: RebalanceMove[]; skipped: RebalanceSkipped[] };
type PathMigCampaign = { id: number; sponsorName: string; oldPath: string; newPath: string; fileCount: number };
type PathMigDriveFile = { playlistId: string; playlistName: string; oldPaths: string[]; newPaths: string[] };
type PathMigrationPreview = { campaignsAffected: PathMigCampaign[]; schedulesAffectedCount: number; driveFilesAffected: PathMigDriveFile[]; driveScanned: number; errors: string[] };

const PAGE_SIZE = 30;

export default function AuditPage() {
  async function logAdminEvent(action: string, details: string) {
    try {
      await fetch('/api/admin/log-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, details, path: '/admin/audit' }),
      });
    } catch {} // logging failure shouldn't disrupt the actual admin action
  }

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
  const [pathMigration, setPathMigration] = useState<PathMigrationPreview | null>(null);
  const [checkingPathMigration, setCheckingPathMigration] = useState(false);
  const [applyingMigration, setApplyingMigration] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ campaignsUpdated: number; schedulesUpdated: number; driveFilesUpdated: number; driveFilesFailed: string[] } | null>(null);
  const [confirmMigration, setConfirmMigration] = useState(false);

  type OrphanedSchedule = { id: number; playlist_id: string; playlist_name: string; audio_file_name: string; audio_local_path: string; campaign_id: number };
  const [orphaned, setOrphaned] = useState<OrphanedSchedule[] | null>(null);
  const [checkingOrphaned, setCheckingOrphaned] = useState(false);
  const [confirmRemoveOrphaned, setConfirmRemoveOrphaned] = useState(false);
  const [removingOrphaned, setRemovingOrphaned] = useState(false);
  const [orphanedResult, setOrphanedResult] = useState<{ succeeded: number; failed: string[]; total: number } | null>(null);

  async function checkOrphanedSchedules() {
    setCheckingOrphaned(true);
    setOrphaned(null);
    setOrphanedResult(null);
    try {
      const res = await fetch('/api/audit/orphaned-schedules');
      const data = await res.json();
      setOrphaned(data.orphaned || []);
    } finally {
      setCheckingOrphaned(false);
    }
  }

  async function removeOrphanedSchedules() {
    if (!orphaned || orphaned.length === 0) return;
    setRemovingOrphaned(true);
    setConfirmRemoveOrphaned(false);
    try {
      const res = await fetch('/api/audit/orphaned-schedules/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleIds: orphaned.map(o => o.id) }),
      });
      const data = await res.json();
      setOrphanedResult(data);
      await logAdminEvent('ORPHANED_SCHEDULES_CLEANED', `${data.succeeded} of ${data.total} removed${data.failed?.length > 0 ? `, ${data.failed.length} failed` : ''}`);
      setOrphaned([]);
    } finally {
      setRemovingOrphaned(false);
    }
  }

  type TopOfHourOutroItem = { playlistId: string; playlistName: string; outroFileName: string };
  const [tohOutros, setTohOutros] = useState<TopOfHourOutroItem[] | null>(null);
  const [tohScanned, setTohScanned] = useState(0);
  const [checkingToh, setCheckingToh] = useState(false);
  const [confirmRemoveToh, setConfirmRemoveToh] = useState(false);
  const [removingToh, setRemovingToh] = useState(false);
  const [tohResult, setTohResult] = useState<{ succeeded: number; failed: string[]; total: number } | null>(null);

  async function checkTopOfHourOutros() {
    setCheckingToh(true);
    setTohOutros(null);
    setTohResult(null);
    try {
      const res = await fetch('/api/audit/top-of-hour-outros');
      const data = await res.json();
      setTohOutros(data.items || []);
      setTohScanned(data.scanned || 0);
    } finally {
      setCheckingToh(false);
    }
  }

  async function removeTopOfHourOutros() {
    if (!tohOutros || tohOutros.length === 0) return;
    setRemovingToh(true);
    setConfirmRemoveToh(false);
    try {
      const res = await fetch('/api/audit/top-of-hour-outros/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: tohOutros }),
      });
      const data = await res.json();
      setTohResult(data);
      setTohOutros([]);
    } finally {
      setRemovingToh(false);
    }
  }

  type StingFormatItem = { playlistId: string; playlistName: string; kind: 'intro' | 'outro'; currentFileName: string };
  const [stingItems, setStingItems] = useState<StingFormatItem[] | null>(null);
  const [stingScanned, setStingScanned] = useState(0);
  const [checkingSting, setCheckingSting] = useState(false);
  const [confirmStingApply, setConfirmStingApply] = useState(false);
  const [applyingSting, setApplyingSting] = useState(false);
  const [stingResult, setStingResult] = useState<{ succeeded: number; failed: string[]; total: number } | null>(null);

  async function checkStingFormat() {
    setCheckingSting(true);
    setStingItems(null);
    setStingResult(null);
    try {
      const res = await fetch('/api/audit/sting-format');
      const data = await res.json();
      setStingItems(data.items || []);
      setStingScanned(data.scanned || 0);
    } finally {
      setCheckingSting(false);
    }
  }

  async function applyStingFormat() {
    if (!stingItems || stingItems.length === 0) return;
    setApplyingSting(true);
    setConfirmStingApply(false);
    try {
      const res = await fetch('/api/audit/sting-format/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: stingItems }),
      });
      const data = await res.json();
      setStingResult(data);
      setStingItems([]);
    } finally {
      setApplyingSting(false);
    }
  }

  type ReformatItem = { playlistId: string; playlistName: string; trackCount: number };
  const [reformatItems, setReformatItems] = useState<ReformatItem[] | null>(null);
  const [reformatScanned, setReformatScanned] = useState(0);
  const [checkingReformat, setCheckingReformat] = useState(false);
  const [confirmReformatApply, setConfirmReformatApply] = useState(false);
  const [applyingReformat, setApplyingReformat] = useState(false);
  const [reformatResult, setReformatResult] = useState<{ succeeded: number; failed: string[]; total: number } | null>(null);

  async function checkReformat() {
    setCheckingReformat(true);
    setReformatItems(null);
    setReformatResult(null);
    try {
      const res = await fetch('/api/audit/reformat-playlists');
      const data = await res.json();
      setReformatItems(data.items || []);
      setReformatScanned(data.scanned || 0);
    } finally {
      setCheckingReformat(false);
    }
  }

  async function applyReformatFix() {
    if (!reformatItems || reformatItems.length === 0) return;
    setApplyingReformat(true);
    setConfirmReformatApply(false);
    try {
      const res = await fetch('/api/audit/reformat-playlists/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: reformatItems }),
      });
      const data = await res.json();
      setReformatResult(data);
      setReformatItems([]);
    } finally {
      setApplyingReformat(false);
    }
  }

  async function applyPathMigration() {
    setApplyingMigration(true);
    setConfirmMigration(false);
    try {
      const res = await fetch('/api/audit/path-migration/apply', { method: 'POST' });
      const data = await res.json();
      setMigrationResult(data);
      await logAdminEvent('PATH_MIGRATION_APPLIED',
        `${data.campaignsUpdated} campaign(s), ${data.schedulesUpdated} schedule(s), ${data.driveFilesUpdated} Drive file(s) updated${data.driveFilesFailed?.length > 0 ? `, ${data.driveFilesFailed.length} failed` : ''}`);
      setPathMigration(null);
    } finally {
      setApplyingMigration(false);
    }
  }

  async function checkPathMigration() {
    setCheckingPathMigration(true);
    setPathMigration(null);
    setMigrationResult(null);
    setConfirmMigration(false);
    try {
      const res = await fetch('/api/audit/path-migration');
      const data = await res.json();
      setPathMigration(data);
    } finally {
      setCheckingPathMigration(false);
    }
  }

  async function checkCategoryConflicts() {
    setCheckingConflicts(true);
    setConflicts(null);
    setFixPlan(null);
    setFixApplyResult(null);
    try {
      const res = await fetch('/api/audit/category-conflicts');
      const data = await res.json();
      setConflicts(data.conflicts || []);
      await logAdminEvent('CATEGORY_CONFLICT_CHECK', (data.conflicts || []).length === 0 ? 'None found — every break is clean' : `${(data.conflicts || []).length} conflicting break(s) found`);
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
      await logAdminEvent('CATEGORY_CONFLICT_FIX_APPLIED', `${data.succeeded} of ${data.total} move(s) applied${data.failed?.length > 0 ? `, ${data.failed.length} failed` : ''}`);
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
    setConfirmRemoveAll(false);
    setRemoveAllResult(null);

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
      await logAdminEvent('AUDIT_RUN',
        `${accumulated.scanned} playlists scanned, ${accumulated.added.length} missing items auto-added, ${accumulated.phantoms.length} untracked items found${accumulated.errors.length > 0 ? `, ${accumulated.errors.length} errors` : ''}`);
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

  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);
  const [removeAllResult, setRemoveAllResult] = useState<{ succeeded: number; failed: string[]; total: number } | null>(null);

  async function removeAllPhantoms() {
    if (!result) return;
    const remaining = result.phantoms.filter(p => !removed.has(`${p.playlistId}:${p.path}`));
    if (remaining.length === 0) return;
    setRemovingAll(true);
    setConfirmRemoveAll(false);
    setRemoveAllResult(null);
    try {
      const res = await fetch('/api/audit/remove-phantom-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: remaining.map(p => ({ playlistId: p.playlistId, path: p.path, fileName: p.fileName, playlistName: p.playlistName })),
        }),
      });
      const data = await res.json();
      setRemoveAllResult(data);
      // Mark everything attempted as removed in the UI — failed ones are
      // listed in the result so they're not silently lost from view
      setRemoved(prev => {
        const next = new Set(prev);
        for (const p of remaining) next.add(`${p.playlistId}:${p.path}`);
        return next;
      });
    } finally {
      setRemovingAll(false);
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
          <a href="/rebalance" style={S.navItem}><IconRebalance /> Rebalance</a>
          <a href="/admin" style={S.navItemActive}><IconAdmin /> Admin</a>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={S.main}>
        <div style={{ padding: '20px 28px', borderBottom: '0.5px solid #ddd', background: 'white' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            <a href="/admin" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500, color: '#666', textDecoration: 'none', background: '#f0f0f0' }}>Users</a>
            <a href="/admin/audit" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500, color: 'white', textDecoration: 'none', background: '#0071e3' }}>Audit &amp; Diagnostics</a>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Audit</h1>
            <p style={{ fontSize: 13, color: '#888', margin: '3px 0 0' }}>Compares every playlist file against what the database expects — admin only</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={checkReformat} disabled={checkingReformat}
              style={{ padding: '8px 18px', background: '#a02020', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: checkingReformat ? 0.6 : 1 }}>
              {checkingReformat ? 'Checking...' : 'Check RadioBOSS Format'}
            </button>
            <button onClick={checkStingFormat} disabled={checkingSting}
              style={{ padding: '8px 18px', background: 'white', color: '#0071e3', border: '0.5px solid #0071e3', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: checkingSting ? 0.6 : 1 }}>
              {checkingSting ? 'Checking...' : 'Check Sting Format (MP3→WAV)'}
            </button>
            <button onClick={checkTopOfHourOutros} disabled={checkingToh}
              style={{ padding: '8px 18px', background: 'white', color: '#0a6e46', border: '0.5px solid #0a6e46', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: checkingToh ? 0.6 : 1 }}>
              {checkingToh ? 'Checking...' : 'Check Top-of-Hour Outros'}
            </button>
            <button onClick={checkOrphanedSchedules} disabled={checkingOrphaned}
              style={{ padding: '8px 18px', background: 'white', color: '#8a3ec9', border: '0.5px solid #8a3ec9', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: checkingOrphaned ? 0.6 : 1 }}>
              {checkingOrphaned ? 'Checking...' : 'Check Orphaned Schedules'}
            </button>
            <button onClick={checkPathMigration} disabled={checkingPathMigration}
              style={{ padding: '8px 18px', background: 'white', color: '#a02020', border: '0.5px solid #a02020', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: checkingPathMigration ? 0.6 : 1 }}>
              {checkingPathMigration ? 'Checking...' : 'Check Path Migration'}
            </button>
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
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {reformatItems !== null && (
            <div style={{ background: 'white', borderRadius: 10, border: '1.5px solid #a02020', padding: 16, marginBottom: 20, maxWidth: 900 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>RadioBOSS Format (critical)</p>
                {reformatItems.length > 0 && (
                  confirmReformatApply ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#a02020' }}>Resave all {reformatItems.length} playlist(s)?</span>
                      <button onClick={() => setConfirmReformatApply(false)} style={{ padding: '4px 10px', background: '#f0f0f0', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={applyReformatFix} disabled={applyingReformat} style={{ padding: '4px 10px', background: '#a02020', color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: applyingReformat ? 0.6 : 1 }}>
                        {applyingReformat ? 'Fixing...' : 'Yes, fix all'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmReformatApply(true)}
                      style={{ padding: '5px 12px', background: '#a02020', color: 'white', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                      Fix All ({reformatItems.length})
                    </button>
                  )
                )}
              </div>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                One-time fix — finds every playlist still written in the old format that was crashing RadioBOSS (unencoded paths, missing #EXTINF line) and resaves it with the exact same content in the correct format. Nothing about which files play changes, only how the file itself is written. Scanned {reformatScanned} playlist(s).
              </p>
              {reformatResult && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: reformatResult.failed.length > 0 ? '#fdecec' : '#f0f8f4', borderRadius: 7 }}>
                  <p style={{ fontSize: 12, margin: 0, color: reformatResult.failed.length > 0 ? '#a02020' : '#0a6e46' }}>
                    Fixed {reformatResult.succeeded} of {reformatResult.total}
                  </p>
                  {reformatResult.failed.map((f, i) => <p key={i} style={{ fontSize: 11, color: '#a02020', margin: '2px 0 0' }}>Failed: {f}</p>)}
                </div>
              )}
              {reformatItems.length === 0 ? (
                <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>None found — every playlist is already in the correct format.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {reformatItems.map((item) => (
                    <div key={item.playlistId} style={{ padding: '8px 10px', background: '#fdecec', borderRadius: 7 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{item.playlistName.replace(/\.m3u8$/i, '')}</p>
                      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{item.trackCount} track(s)</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {stingItems !== null && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 900 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Sting Format (MP3 → WAV)</p>
                {stingItems.length > 0 && (
                  confirmStingApply ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#a02020' }}>Switch all {stingItems.length} to WAV?</span>
                      <button onClick={() => setConfirmStingApply(false)} style={{ padding: '4px 10px', background: '#f0f0f0', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={applyStingFormat} disabled={applyingSting} style={{ padding: '4px 10px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: applyingSting ? 0.6 : 1 }}>
                        {applyingSting ? 'Applying...' : 'Yes, switch all'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmStingApply(true)}
                      style={{ padding: '5px 12px', background: 'white', color: '#0071e3', border: '0.5px solid #0071e3', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                      Switch All to WAV ({stingItems.length})
                    </button>
                  )
                )}
              </div>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                One-time cleanup — finds every break whose current intro or outro is still an MP3 file, and replaces just that sting with a freshly-picked WAV file. Run this before deleting the old MP3 files, so nothing's left pointing at a file that's about to disappear. Scanned {stingScanned} playlist(s).
              </p>
              {stingResult && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: stingResult.failed.length > 0 ? '#fdecec' : '#f0f8f4', borderRadius: 7 }}>
                  <p style={{ fontSize: 12, margin: 0, color: stingResult.failed.length > 0 ? '#a02020' : '#0a6e46' }}>
                    Switched {stingResult.succeeded} of {stingResult.total}
                  </p>
                  {stingResult.failed.map((f, i) => <p key={i} style={{ fontSize: 11, color: '#a02020', margin: '2px 0 0' }}>Failed: {f}</p>)}
                </div>
              )}
              {stingItems.length === 0 ? (
                <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>None found — every break's intro and outro is already a WAV file.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stingItems.map((item, i) => (
                    <div key={`${item.playlistId}-${item.kind}`} style={{ padding: '8px 10px', background: '#eaf2fb', borderRadius: 7 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{item.playlistName.replace(/\.m3u8$/i, '')} — {item.kind}</p>
                      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{item.currentFileName}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tohOutros !== null && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 900 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Top-of-Hour Outros</p>
                {tohOutros.length > 0 && (
                  confirmRemoveToh ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#a02020' }}>Remove all {tohOutros.length} outro(s)?</span>
                      <button onClick={() => setConfirmRemoveToh(false)} style={{ padding: '4px 10px', background: '#f0f0f0', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={removeTopOfHourOutros} disabled={removingToh} style={{ padding: '4px 10px', background: '#a02020', color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: removingToh ? 0.6 : 1 }}>
                        {removingToh ? 'Removing...' : 'Yes, remove all'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmRemoveToh(true)}
                      style={{ padding: '5px 12px', background: 'white', color: '#a02020', border: '0.5px solid #a02020', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                      Remove All ({tohOutros.length})
                    </button>
                  )
                )}
              </div>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                One-time cleanup — top-of-hour breaks (6:00am, 7:00am, etc.) now get an intro only, no outro. This finds any that were already populated before that fix and still have an outro left over. Scanned {tohScanned} top-of-hour break(s).
              </p>
              {tohResult && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: tohResult.failed.length > 0 ? '#fdecec' : '#f0f8f4', borderRadius: 7 }}>
                  <p style={{ fontSize: 12, margin: 0, color: tohResult.failed.length > 0 ? '#a02020' : '#0a6e46' }}>
                    Removed {tohResult.succeeded} of {tohResult.total}
                  </p>
                  {tohResult.failed.map((f, i) => <p key={i} style={{ fontSize: 11, color: '#a02020', margin: '2px 0 0' }}>Failed: {f}</p>)}
                </div>
              )}
              {tohOutros.length === 0 ? (
                <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>None found — every top-of-hour break is already intro-only.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tohOutros.map((item) => (
                    <div key={item.playlistId} style={{ padding: '8px 10px', background: '#f0f8f4', borderRadius: 7 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{item.playlistName.replace(/\.m3u8$/i, '')}</p>
                      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{item.outroFileName}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {orphaned !== null && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 900 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Orphaned Schedules</p>
                {orphaned.length > 0 && (
                  confirmRemoveOrphaned ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#a02020' }}>Remove all {orphaned.length}, including their audio from Drive?</span>
                      <button onClick={() => setConfirmRemoveOrphaned(false)} style={{ padding: '4px 10px', background: '#f0f0f0', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={removeOrphanedSchedules} disabled={removingOrphaned} style={{ padding: '4px 10px', background: '#a02020', color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: removingOrphaned ? 0.6 : 1 }}>
                        {removingOrphaned ? 'Removing...' : 'Yes, remove all'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmRemoveOrphaned(true)}
                      style={{ padding: '5px 12px', background: 'white', color: '#a02020', border: '0.5px solid #a02020', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                      Remove All ({orphaned.length})
                    </button>
                  )
                )}
              </div>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                Schedules left behind by a campaign that was deleted without also removing its schedules — the campaign is gone, but this audio is still live in Drive with nothing left to ever end it.
              </p>
              {orphanedResult && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: orphanedResult.failed.length > 0 ? '#fdecec' : '#f0f8f4', borderRadius: 7 }}>
                  <p style={{ fontSize: 12, margin: 0, color: orphanedResult.failed.length > 0 ? '#a02020' : '#0a6e46' }}>
                    Removed {orphanedResult.succeeded} of {orphanedResult.total}
                  </p>
                  {orphanedResult.failed.map((f, i) => <p key={i} style={{ fontSize: 11, color: '#a02020', margin: '2px 0 0' }}>Failed: {f}</p>)}
                </div>
              )}
              {orphaned.length === 0 ? (
                <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>None found — every schedule belongs to a campaign that still exists.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {orphaned.map((o) => (
                    <div key={o.id} style={{ padding: '8px 10px', background: '#f5f0fa', borderRadius: 7 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>{o.playlist_name.replace(/\.m3u8$/i, '')}</p>
                      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{o.audio_file_name} — deleted campaign #{o.campaign_id}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {pathMigration !== null && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 900 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px', color: '#1a1a1a' }}>Path Migration Preview (read-only — nothing has been changed)</p>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                Scanned {pathMigration.driveScanned} playlists. This is what would change if the old wrong local paths get fixed.
              </p>

              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1, background: '#faf6ea', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 20, fontWeight: 500, margin: 0, color: '#a06000' }}>{pathMigration.campaignsAffected.length}</p>
                  <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0' }}>Campaigns with wrong stored path</p>
                </div>
                <div style={{ flex: 1, background: '#faf6ea', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 20, fontWeight: 500, margin: 0, color: '#a06000' }}>{pathMigration.schedulesAffectedCount}</p>
                  <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0' }}>Schedule rows with wrong path</p>
                </div>
                <div style={{ flex: 1, background: '#faf6ea', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 20, fontWeight: 500, margin: 0, color: '#a06000' }}>{pathMigration.driveFilesAffected.length}</p>
                  <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0' }}>Actual Drive files with wrong path</p>
                </div>
              </div>

              {(pathMigration.campaignsAffected.length > 0 || pathMigration.schedulesAffectedCount > 0 || pathMigration.driveFilesAffected.length > 0) && (
                <div style={{ marginBottom: 14 }}>
                  {!confirmMigration ? (
                    <button onClick={() => setConfirmMigration(true)}
                      style={{ padding: '8px 18px', background: '#a02020', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                      Apply Path Migration
                    </button>
                  ) : (
                    <div style={{ background: '#fdecec', border: '0.5px solid #f5b8b8', borderRadius: 8, padding: 12 }}>
                      <p style={{ fontSize: 12, color: '#a02020', margin: '0 0 10px', fontWeight: 500 }}>
                        This will update {pathMigration.campaignsAffected.length} campaign record(s), {pathMigration.schedulesAffectedCount} schedule row(s), and rewrite {pathMigration.driveFilesAffected.length} live Drive file(s). Are you sure?
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setConfirmMigration(false)} style={{ padding: '7px 14px', background: '#4a4a4c', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={applyPathMigration} disabled={applyingMigration}
                          style={{ padding: '7px 14px', background: '#a02020', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: applyingMigration ? 0.6 : 1 }}>
                          {applyingMigration ? 'Applying — this may take a minute or two...' : 'Yes, apply it'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {pathMigration.errors.length > 0 && (
                <p style={{ fontSize: 12, color: '#a02020', margin: '0 0 10px' }}>{pathMigration.errors.length} read error(s) during scan — see console.</p>
              )}

              {pathMigration.campaignsAffected.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 6px', color: '#1a1a1a' }}>Campaigns (example paths)</p>
                  <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {pathMigration.campaignsAffected.map(c => (
                      <div key={c.id} style={{ fontSize: 11, padding: '6px 10px', background: '#f9f9f9', borderRadius: 6 }}>
                        <div style={{ fontWeight: 500, color: '#1a1a1a' }}>{c.sponsorName} ({c.fileCount} file{c.fileCount === 1 ? '' : 's'})</div>
                        <div style={{ color: '#a02020' }}>− {c.oldPath}</div>
                        <div style={{ color: '#0a6e46' }}>+ {c.newPath}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pathMigration.driveFilesAffected.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 6px', color: '#1a1a1a' }}>Drive files (example paths)</p>
                  <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {pathMigration.driveFilesAffected.slice(0, 30).map((d, i) => (
                      <div key={i} style={{ fontSize: 11, padding: '6px 10px', background: '#f9f9f9', borderRadius: 6 }}>
                        <div style={{ fontWeight: 500, color: '#1a1a1a' }}>{d.playlistName.replace(/\.m3u8$/i, '')}</div>
                        {d.oldPaths.map((p, j) => (
                          <div key={j}>
                            <div style={{ color: '#a02020' }}>− {p}</div>
                            <div style={{ color: '#0a6e46' }}>+ {d.newPaths[j]}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {pathMigration.driveFilesAffected.length > 30 && (
                      <p style={{ fontSize: 11, color: '#888', margin: '4px 0 0' }}>...and {pathMigration.driveFilesAffected.length - 30} more.</p>
                    )}
                  </div>
                </div>
              )}

              {pathMigration.campaignsAffected.length === 0 && pathMigration.schedulesAffectedCount === 0 && pathMigration.driveFilesAffected.length === 0 && (
                <p style={{ fontSize: 12, color: '#0a6e46', margin: 0 }}>Nothing found with the old paths — everything's already correct.</p>
              )}
            </div>
          )}

          {migrationResult && (
            <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 20, maxWidth: 800 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px', color: '#1a1a1a' }}>Path Migration Applied</p>
              <p style={{ fontSize: 12, color: '#0a6e46', margin: '2px 0' }}>{migrationResult.campaignsUpdated} campaign(s) updated</p>
              <p style={{ fontSize: 12, color: '#0a6e46', margin: '2px 0' }}>{migrationResult.schedulesUpdated} schedule row(s) updated</p>
              <p style={{ fontSize: 12, color: '#0a6e46', margin: '2px 0' }}>{migrationResult.driveFilesUpdated} Drive file(s) rewritten</p>
              {migrationResult.driveFilesFailed.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12, color: '#a02020', margin: '0 0 4px' }}>{migrationResult.driveFilesFailed.length} failed — re-run "Check Path Migration" to see what's still outstanding:</p>
                  {migrationResult.driveFilesFailed.map((f, i) => <p key={i} style={{ fontSize: 11, color: '#a02020', margin: '2px 0' }}>{f}</p>)}
                </div>
              )}
            </div>
          )}

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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#1a1a1a' }}>Untracked content</p>
                  {result.phantoms.filter(p => !removed.has(`${p.playlistId}:${p.path}`)).length > 0 && (
                    confirmRemoveAll ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#a02020' }}>Remove all {result.phantoms.filter(p => !removed.has(`${p.playlistId}:${p.path}`)).length}?</span>
                        <button onClick={() => setConfirmRemoveAll(false)} style={{ padding: '4px 10px', background: '#f0f0f0', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={removeAllPhantoms} disabled={removingAll} style={{ padding: '4px 10px', background: '#a02020', color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: removingAll ? 0.6 : 1 }}>
                          {removingAll ? 'Removing...' : 'Yes, remove all'}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmRemoveAll(true)}
                        style={{ padding: '5px 12px', background: 'white', color: '#a02020', border: '0.5px solid #a02020', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                        Remove All ({result.phantoms.filter(p => !removed.has(`${p.playlistId}:${p.path}`)).length})
                      </button>
                    )
                  )}
                </div>
                <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
                  These are sitting in a break with no matching active schedule — could be a manual addition, or leftover from something deleted. Review individually, or remove all at once if you're confident they're all safe to clear.
                </p>
                {removeAllResult && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: removeAllResult.failed.length > 0 ? '#fdecec' : '#f0f8f4', borderRadius: 7 }}>
                    <p style={{ fontSize: 12, margin: 0, color: removeAllResult.failed.length > 0 ? '#a02020' : '#0a6e46' }}>
                      Removed {removeAllResult.succeeded} of {removeAllResult.total}
                    </p>
                    {removeAllResult.failed.map((f, i) => <p key={i} style={{ fontSize: 11, color: '#a02020', margin: '2px 0 0' }}>Failed: {f}</p>)}
                  </div>
                )}
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
