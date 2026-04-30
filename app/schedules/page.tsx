'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Schedule = {
  id: number;
  audio_file_name: string;
  audio_directory_name: string;
  playlist_name: string;
  position: number;
  schedule_type: string;
  days_of_week: string | null;
  specific_dates: string | null;
  time_of_day: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string;
};

const fmt = (dt: string | null) =>
  dt ? new Date(dt).toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }) : '—';

export default function SchedulesPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [runMsg, setRunMsg] = useState('');
  const [runLoading, setRunLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  async function loadSchedules() {
    setLoading(true);
    const res = await fetch('/api/schedules');
    if (res.ok) setSchedules(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadSchedules(); }, []);

  async function toggleActive(id: number, schedule: Schedule) {
    await fetch('/api/schedules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...schedule, id, is_active: !schedule.is_active }) });
    loadSchedules();
  }

  async function deleteSchedule(id: number) {
    await fetch('/api/schedules', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setConfirmDelete(null);
    loadSchedules();
  }

  async function runNow() {
    setRunLoading(true); setRunMsg('');
    try {
      const tokenKey = Object.keys(localStorage).find(k => k.includes('access_token') || k.includes('google'));
      const accessToken = tokenKey ? localStorage.getItem(tokenKey) : null;
      if (!accessToken) { setRunMsg('⚠️ Please log in to the main app first to connect Google Drive.'); return; }
      const res = await fetch('/api/schedules/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken }) });
      const data = await res.json();
      const success = data.results?.filter((r: any) => r.status === 'success').length ?? 0;
      const skipped = data.results?.filter((r: any) => r.status === 'skipped').length ?? 0;
      const failed = data.results?.filter((r: any) => r.status === 'error').length ?? 0;
      setRunMsg(`✅ ${success} added, ${skipped} skipped, ${failed} failed.${data.processed === 0 ? ' No schedules were due.' : ''}`);
      loadSchedules();
    } catch { setRunMsg('❌ Failed to run schedules'); } finally { setRunLoading(false); }
  }

  function formatSchedule(s: Schedule) {
    if (s.schedule_type === 'expiry_only') return '—';
    if (s.schedule_type === 'once') {
      const d = s.specific_dates ? new Date(s.specific_dates.trim()).toLocaleDateString('en-AU') : '?';
      return `${d} @ ${s.time_of_day}`;
    }
    if (s.schedule_type === 'recurring' && s.days_of_week) {
      const days = s.days_of_week.split(',').map(d => DAYS[parseInt(d)]).join(', ');
      return `${days} @ ${s.time_of_day}`;
    }
    return s.time_of_day;
  }

  const filtered = filter
    ? schedules.filter(s => s.audio_file_name.toLowerCase().includes(filter.toLowerCase()) || s.playlist_name.toLowerCase().includes(filter.toLowerCase()))
    : schedules;

  const S: Record<string, React.CSSProperties> = {
    app: { display: 'flex', height: '100vh', background: '#1d1d1f', fontFamily: 'var(--font-sans)', overflow: 'hidden' },
    sidebar: { width: 260, background: '#1d1d1f', borderRight: '0.5px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0 },
    main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
    sidebarHeader: { padding: '18px 16px 12px', borderBottom: '0.5px solid #333' },
    sidebarLogo: { width: 40, height: 40, borderRadius: 10, background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, marginBottom: 2, color: '#888', cursor: 'pointer', fontSize: 14, textDecoration: 'none' },
    navItemActive: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#0071e3', borderRadius: 6, marginBottom: 2, color: 'white', fontSize: 14, textDecoration: 'none' },
    toolbar: { padding: '12px 20px', background: '#e8e8ed', borderBottom: '0.5px solid #ccc', display: 'flex', alignItems: 'center', gap: 10 },
    badge: { padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 500 },
    overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
    dialog: { background: 'white', borderRadius: 14, padding: 24, width: '100%' },
  };

  const IconBreaks = () => <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/></svg>;
  const IconSchedule = () => <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v3.5l2 1.5"/></svg>;
  const IconAdmin = () => <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>;

  return (
    <div style={S.app}>

      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={S.sidebarLogo}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5">
                <circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5" fill="white" stroke="none"/>
              </svg>
            </div>
            <div>
              <div style={{ color: 'white', fontSize: 14, fontWeight: 500 }}>REGFM</div>
              <div style={{ color: '#666', fontSize: 12 }}>Sponsorship Scheduler</div>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 10px 6px' }}>
          <span style={{ fontSize: 11, color: '#555', padding: '0 8px', marginBottom: 6, letterSpacing: '0.05em', display: 'block' }}>LIBRARY</span>
          <a href="/" style={S.navItem}><IconBreaks /> Sponsorship Breaks</a>
        </div>
        <div style={{ padding: '4px 10px' }}>
          <a href="/schedules" style={S.navItemActive}><IconSchedule /> Schedules</a>
          <a href="/admin" style={S.navItem}><IconAdmin /> Admin</a>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '10px 14px', borderTop: '0.5px solid #333', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white', fontWeight: 500 }}>A</div>
          <span style={{ color: '#666', fontSize: 13 }}>admin</span>
        </div>
      </div>

      {/* Main */}
      <div style={S.main}>
        {/* Toolbar */}
        <div style={S.toolbar}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 500, margin: 0, color: '#1d1d1f' }}>Schedules</h1>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Automatically add audio files to sponsorship breaks</p>
          </div>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter schedules..."
            style={{ padding: '7px 12px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13, background: 'white', outline: 'none', width: 200 }}
          />
          <button
            onClick={runNow}
            disabled={runLoading}
            style={{ padding: '8px 18px', background: '#34c759', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: runLoading ? 0.7 : 1, whiteSpace: 'nowrap' }}
          >
            {runLoading ? '⟳ Running...' : '▶ Run Now'}
          </button>
        </div>

        {/* Run message */}
        {runMsg && (
          <div style={{ margin: '0 20px', padding: '10px 14px', background: 'white', border: '0.5px solid #ddd', borderRadius: 8, fontSize: 13, marginTop: 12 }}>
            {runMsg}
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          <div style={{ background: 'white', borderRadius: 12, border: '0.5px solid #ddd', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: '#1d1d1f' }}>All Schedules</span>
              <span style={{ ...S.badge, background: '#e8e8ed', color: '#666' }}>{filtered.length}</span>
            </div>

            {loading ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: '#0071e3', margin: '0 auto 8px' }} />
                <p style={{ color: '#888', fontSize: 13 }}>Loading schedules...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#aaa', fontSize: 14 }}>
                {schedules.length === 0 ? 'No schedules yet. Use the 🕐 button on any audio file in the main app.' : 'No schedules match your filter.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: '#f9f9f9', textAlign: 'left' }}>
                      {['Audio File', 'Directory', 'Playlist', 'Position', 'Type', 'Schedule', 'Next Run', 'Last Run', 'Expires', 'Status', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontWeight: 500, letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '0.5px solid #eee' }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => {
                      const isExpired = !s.is_active && s.expires_at && new Date(s.expires_at) < new Date();
                      return (
                        <tr key={s.id} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap', color: '#1d1d1f' }}>{s.audio_file_name.replace(/\.[^/.]+$/, '')}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#888', fontSize: 12 }}>{s.audio_directory_name}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#444' }}>{s.playlist_name.replace(/\.m3u8$/i, '')}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#666' }}>{s.position >= 0 ? `Position ${s.position + 1}` : 'End'}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <span style={{ ...S.badge, background: s.schedule_type === 'expiry_only' ? '#f0f0f0' : s.schedule_type === 'once' ? '#fff3e0' : '#e8f0fb', color: s.schedule_type === 'expiry_only' ? '#666' : s.schedule_type === 'once' ? '#b35c00' : '#0055cc' }}>
                              {s.schedule_type === 'expiry_only' ? 'Expiry only' : s.schedule_type === 'once' ? 'One-time' : 'Recurring'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#444' }}>{formatSchedule(s)}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#888', fontSize: 12 }}>{s.schedule_type === 'expiry_only' ? '—' : fmt(s.next_run_at)}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#888', fontSize: 12 }}>{s.last_run_at ? fmt(s.last_run_at) : 'Never'}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 12 }}>
                            {s.expires_at
                              ? <span style={{ color: new Date(s.expires_at) < new Date() ? '#cc0000' : '#666' }}>{fmt(s.expires_at)}</span>
                              : <span style={{ color: '#ccc' }}>No expiry</span>}
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <span style={{ ...S.badge, background: s.is_active ? '#d4f1dc' : isExpired ? '#fde8e8' : '#f0f0f0', color: s.is_active ? '#1a7a35' : isExpired ? '#cc0000' : '#666' }}>
                              {s.is_active ? 'Active' : isExpired ? 'Expired' : 'Paused'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: 12 }}>
                              <button onClick={() => toggleActive(s.id, s)} style={{ fontSize: 13, color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                {s.is_active ? 'Pause' : 'Resume'}
                              </button>
                              <button onClick={() => setConfirmDelete(s.id)} style={{ fontSize: 13, color: '#cc0000', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirm dialog */}
      {confirmDelete !== null && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 360 }}>
            <h2 style={{ fontSize: 17, fontWeight: 500, margin: '0 0 8px' }}>Delete Schedule</h2>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 24 }}>Are you sure you want to delete this schedule? This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: '10px 0', background: 'white', border: '0.5px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => deleteSchedule(confirmDelete)} style={{ flex: 1, padding: '10px 0', background: '#cc0000', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
