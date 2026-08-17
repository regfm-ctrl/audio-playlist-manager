'use client';

import { useEffect, useState } from 'react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

type User = { id: number; username: string; role: string; created_at: string; };
type Log = { id: number; username: string; action: string; path: string; details: string | null; created_at: string; };

const S: Record<string, React.CSSProperties> = {
  app: { display: 'flex', height: '100vh', background: '#2a2a2c', fontFamily: 'var(--font-sans)', overflow: 'hidden' },
  sidebar: { width: 260, minWidth: 260, maxWidth: 260, background: '#2a2a2c', borderRight: '0.5px solid #3a3a3c', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
  navItem: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, marginBottom: 2, color: '#777', cursor: 'pointer', fontSize: 13, textDecoration: 'none' as const },
  navItemActive: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: '#0071e3', borderRadius: 8, marginBottom: 2, color: 'white', fontSize: 13, textDecoration: 'none' as const },
  card: { background: 'white', borderRadius: 12, border: '0.5px solid #ddd', overflow: 'hidden', marginBottom: 16 },
  input: { padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: 7, fontSize: 13, outline: 'none' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  dialog: { background: '#3a3a3c', borderRadius: 14, padding: 24, width: '100%' },
};

const IconBreaks = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/></svg>;
const IconSchedule = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v3.5l2 1.5"/></svg>;
const IconAdmin = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>;
const IconCampaign = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h2l2-5 4 10 2-5h2"/></svg>;
const IconOverview = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="5.5" y1="2.5" x2="5.5" y2="4.5"/><line x1="10.5" y1="2.5" x2="10.5" y2="4.5"/></svg>;
const IconAudit = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l5.5 2.5v4c0 3.5-2.3 5.9-5.5 7-3.2-1.1-5.5-3.5-5.5-7v-4z"/><path d="M6 8l1.5 1.5L10.5 6.5"/></svg>;
const IconRebalance = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h7M8 3l2 2-2 2"/><path d="M13 11H6M8 13l-2-2 2-2"/></svg>;

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [tab, setTab] = useState<'users' | 'logs'>('users');
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [createMsg, setCreateMsg] = useState('');
  const [createError, setCreateError] = useState('');
  const [changePwId, setChangePwId] = useState<number | null>(null);
  const [changePwValue, setChangePwValue] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const [testingReshuffle, setTestingReshuffle] = useState(false);
  const [confirmTestReshuffle, setConfirmTestReshuffle] = useState(false);
  const [reshuffleTestResult, setReshuffleTestResult] = useState<{ processed: number; totalEligible: number; details: string[] } | null>(null);

  const [renewalEmails, setRenewalEmails] = useState<string[]>(['', '', '', '']);
  const [renewalDaysInput, setRenewalDaysInput] = useState('');
  const [savingRenewalSettings, setSavingRenewalSettings] = useState(false);
  const [renewalSettingsMsg, setRenewalSettingsMsg] = useState('');

  async function loadRenewalSettings() {
    try {
      const res = await fetch('/api/admin/renewal-settings');
      if (!res.ok) return;
      const data = await res.json();
      const emails = [...(data.emails || []), '', '', '', ''].slice(0, 4);
      setRenewalEmails(emails);
      setRenewalDaysInput((data.days || []).join(', '));
    } catch {}
  }

  async function saveRenewalSettings() {
    setSavingRenewalSettings(true);
    setRenewalSettingsMsg('');
    try {
      const days = renewalDaysInput.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
      const res = await fetch('/api/admin/renewal-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: renewalEmails, days }),
      });
      if (res.ok) {
        setRenewalSettingsMsg('Saved');
        setTimeout(() => setRenewalSettingsMsg(''), 2500);
      }
    } finally {
      setSavingRenewalSettings(false);
    }
  }

  type BlockedWindow = { day: number; startTime: string; endTime: string; label?: string };
  const [blockedWindows, setBlockedWindows] = useState<BlockedWindow[]>([]);
  const [newWindowDay, setNewWindowDay] = useState(4);
  const [newWindowStart, setNewWindowStart] = useState('18:00');
  const [newWindowEnd, setNewWindowEnd] = useState('19:00');
  const [newWindowLabel, setNewWindowLabel] = useState('');
  const [savingBlockedWindows, setSavingBlockedWindows] = useState(false);
  const [blockedWindowsMsg, setBlockedWindowsMsg] = useState('');

  async function loadBlockedWindows() {
    try {
      const res = await fetch('/api/admin/blocked-windows');
      if (!res.ok) return;
      const data = await res.json();
      setBlockedWindows(data.windows || []);
    } catch {}
  }

  function addBlockedWindow() {
    if (!newWindowStart || !newWindowEnd || newWindowStart >= newWindowEnd) return;
    setBlockedWindows((prev) => [...prev, { day: newWindowDay, startTime: newWindowStart, endTime: newWindowEnd, label: newWindowLabel }]);
    setNewWindowLabel('');
  }

  async function saveBlockedWindows() {
    setSavingBlockedWindows(true);
    setBlockedWindowsMsg('');
    try {
      const res = await fetch('/api/admin/blocked-windows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windows: blockedWindows }),
      });
      if (res.ok) {
        setBlockedWindowsMsg('Saved');
        setTimeout(() => setBlockedWindowsMsg(''), 2500);
      }
    } finally {
      setSavingBlockedWindows(false);
    }
  }


  async function runTestReshuffle() {
    setTestingReshuffle(true);
    setConfirmTestReshuffle(false);
    setReshuffleTestResult(null);
    try {
      const res = await fetch('/api/admin/test-weekly-reshuffle', { method: 'POST' });
      const data = await res.json();
      setReshuffleTestResult(data);
    } finally {
      setTestingReshuffle(false);
    }
  }

  async function loadData() {
    setLoading(true);
    const [u, l] = await Promise.all([
      fetch('/api/admin/users').then(r => r.ok ? r.json() : []),
      fetch('/api/admin/logs').then(r => r.ok ? r.json() : []),
    ]);
    if (Array.isArray(u)) setUsers(u);
    if (Array.isArray(l)) setLogs(l);
    setLoading(false);
  }

  useEffect(() => {
    // Get current user from token
    const token = document.cookie.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUser({ username: payload.username, role: payload.role });
      } catch {}
    }
    loadData();
    loadRenewalSettings();
    loadBlockedWindows();
  }, []);

  async function createUser() {
    setCreateMsg(''); setCreateError('');
    if (!newUsername || !newPassword) { setCreateError('Username and password required'); return; }
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }) });
    if (res.ok) { setCreateMsg(`User "${newUsername}" created`); setNewUsername(''); setNewPassword(''); setNewRole('user'); loadData(); }
    else { const d = await res.json(); setCreateError(d.error ?? 'Failed'); }
  }

  async function deleteUser(id: number, username: string) {
    if (!confirm(`Delete user "${username}"?`)) return;
    await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    loadData();
  }

  async function changePassword(id: number) {
    if (!changePwValue) return;
    await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password: changePwValue }) });
    setChangePwId(null); setChangePwValue('');
    setCreateMsg('Password updated');
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const filteredLogs = logFilter ? logs.filter(l => l.username?.toLowerCase().includes(logFilter.toLowerCase())) : logs;

  return (
    <div style={S.app}>
      {/* Sidebar */}
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
        <div style={{ padding: '8px 12px', borderTop: '0.5px solid #3a3a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white', fontWeight: 500 }}>
            {currentUser?.username?.[0]?.toUpperCase() ?? 'A'}
          </div>
          <span style={{ color: '#666', fontSize: 13, flex: 1 }}>{currentUser?.username ?? 'admin'}</span>
          <button onClick={logout} title="Logout" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 0, display: 'flex', alignItems: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>
              <path d="M10 11l4-3-4-3"/><line x1="14" y1="8" x2="6" y2="8"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={S.main}>
        {/* Toolbar */}
        <div style={{ padding: '12px 20px', background: '#e8e8ed', borderBottom: '0.5px solid #ccc' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            <a href="/admin" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500, color: 'white', textDecoration: 'none', background: '#0071e3' }}>Users</a>
            <a href="/admin/audit" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500, color: '#666', textDecoration: 'none', background: '#d8d8dc' }}>Audit &amp; Diagnostics</a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 500, margin: 0, color: '#1d1d1f' }}>Admin</h1>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Manage users and review activity</p>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'white', border: '0.5px solid #ddd', borderRadius: 8, padding: 3 }}>
            {(['users', 'logs'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: '5px 14px', borderRadius: 6, fontSize: 13, border: 'none', cursor: 'pointer', background: tab === t ? '#1d1d1f' : 'transparent', color: tab === t ? 'white' : '#666', fontWeight: tab === t ? 500 : 400 }}>
                {t === 'users' ? `Users (${users.length})` : `Logs (${logs.length})`}
              </button>
            ))}
          </div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 16, maxWidth: 700 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px', color: '#1a1a1a' }}>Weekly Reshuffle — Manual Trigger</p>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
              Runs the real weekly reshuffle right now, for every campaign with Randomize Weekly enabled — the same code that runs automatically every Monday, just triggered on demand. This isn't a preview; it actually reshuffles live campaigns.
            </p>
            {testingReshuffle ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f5f0fa', border: '0.5px solid #d5c0ea', borderRadius: 8, padding: '12px 14px' }}>
                <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite', color: '#8a3ec9', flexShrink: 0 }} />
                <p style={{ fontSize: 12, color: '#6a2e9c', margin: 0, fontWeight: 500 }}>
                  Running — reshuffling every eligible campaign now, this can take a minute or two for a large batch. Don't navigate away.
                </p>
              </div>
            ) : !confirmTestReshuffle ? (
              <button onClick={() => setConfirmTestReshuffle(true)}
                style={{ padding: '8px 18px', background: 'white', color: '#8a3ec9', border: '0.5px solid #8a3ec9', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Run Weekly Reshuffle Now
              </button>
            ) : (
              <div style={{ background: '#f5f0fa', border: '0.5px solid #d5c0ea', borderRadius: 8, padding: 12 }}>
                <p style={{ fontSize: 12, color: '#6a2e9c', margin: '0 0 10px', fontWeight: 500 }}>
                  This will actually reshuffle every eligible campaign's real placements right now. Are you sure?
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmTestReshuffle(false)} style={{ padding: '7px 14px', background: '#4a4a4c', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={runTestReshuffle}
                    style={{ padding: '7px 14px', background: '#8a3ec9', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    Yes, run it now
                  </button>
                </div>
              </div>
            )}
            {reshuffleTestResult && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #eee' }}>
                <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 8px', color: '#1a1a1a' }}>
                  Processed {reshuffleTestResult.processed} of {reshuffleTestResult.totalEligible} eligible campaign(s)
                  {reshuffleTestResult.totalEligible > reshuffleTestResult.processed && ` — the rest are capped for this run and will process on the next trigger`}
                </p>
                <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {reshuffleTestResult.details.map((d, i) => (
                    <p key={i} style={{ fontSize: 11, color: d.includes('FAILED') || d.includes('failed') ? '#a02020' : '#555', margin: 0 }}>{d}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 16, maxWidth: 700 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px', color: '#1a1a1a' }}>Renewal Reminders</p>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
              Sends an email a set number of days before a campaign's end date, so a renewal conversation can happen before it actually lapses. Checked once daily by the scheduler script.
            </p>
            <label style={{ ...S.label, color: '#ddd', display: 'block', marginBottom: 6 }}>Recipient emails (up to 4)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {[0, 1, 2, 3].map((i) => (
                <input key={i} type="email" placeholder={`Email ${i + 1}${i === 0 ? ' (required)' : ' (optional)'}`}
                  value={renewalEmails[i] || ''}
                  onChange={(e) => setRenewalEmails((prev) => { const next = [...prev]; next[i] = e.target.value; return next; })}
                  style={{ padding: '8px 12px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13 }} />
              ))}
            </div>
            <label style={{ ...S.label, color: '#ddd', display: 'block', marginBottom: 6 }}>Remind this many days before the end date</label>
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>Comma-separated — e.g. "7, 3" sends two separate reminders, one a week out and one three days out.</p>
            <input type="text" placeholder="e.g. 7, 3" value={renewalDaysInput}
              onChange={(e) => setRenewalDaysInput(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13, marginBottom: 14, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={saveRenewalSettings} disabled={savingRenewalSettings}
                style={{ padding: '8px 18px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: savingRenewalSettings ? 0.6 : 1 }}>
                {savingRenewalSettings ? 'Saving...' : 'Save Settings'}
              </button>
              {renewalSettingsMsg && <span style={{ fontSize: 12, color: '#0a6e46' }}>{renewalSettingsMsg}</span>}
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 10, border: '0.5px solid #ddd', padding: 16, marginBottom: 16, maxWidth: 700 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px', color: '#1a1a1a' }}>Blocked Time Windows</p>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 14px' }}>
              Breaks in these day/time windows are permanently off-limits to every campaign — for shows that don't carry sponsorship breaks. Applies everywhere a break gets picked: creating or editing a campaign, weekly reshuffle, and rebalance.
            </p>

            {blockedWindows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {blockedWindows.map((w, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f7f8fa', borderRadius: 7 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#1a1a1a', minWidth: 40 }}>{DAY_NAMES[w.day]}</span>
                    <span style={{ fontSize: 12, color: '#555' }}>{w.startTime} – {w.endTime}</span>
                    {w.label && <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>({w.label})</span>}
                    <button onClick={() => setBlockedWindows((prev) => prev.filter((_, idx) => idx !== i))}
                      style={{ marginLeft: 'auto', padding: '3px 8px', background: 'white', color: '#a02020', border: '0.5px solid #a02020', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <label style={{ ...S.label, color: '#ddd', display: 'block', marginBottom: 4, fontSize: 11 }}>Day</label>
                <select value={newWindowDay} onChange={(e) => setNewWindowDay(Number(e.target.value))}
                  style={{ padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13 }}>
                  {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...S.label, color: '#ddd', display: 'block', marginBottom: 4, fontSize: 11 }}>From</label>
                <input type="time" value={newWindowStart} onChange={(e) => setNewWindowStart(e.target.value)}
                  style={{ padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13 }} />
              </div>
              <div>
                <label style={{ ...S.label, color: '#ddd', display: 'block', marginBottom: 4, fontSize: 11 }}>To</label>
                <input type="time" value={newWindowEnd} onChange={(e) => setNewWindowEnd(e.target.value)}
                  style={{ padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13 }} />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ ...S.label, color: '#ddd', display: 'block', marginBottom: 4, fontSize: 11 }}>Label (optional)</label>
                <input type="text" placeholder="e.g. Sunday Morning show" value={newWindowLabel} onChange={(e) => setNewWindowLabel(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <button onClick={addBlockedWindow}
                style={{ padding: '8px 16px', background: 'white', color: '#0071e3', border: '0.5px solid #0071e3', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                + Add Window
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={saveBlockedWindows} disabled={savingBlockedWindows}
                style={{ padding: '8px 18px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: savingBlockedWindows ? 0.6 : 1 }}>
                {savingBlockedWindows ? 'Saving...' : 'Save Windows'}
              </button>
              {blockedWindowsMsg && <span style={{ fontSize: 12, color: '#0a6e46' }}>{blockedWindowsMsg}</span>}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: '#0071e3', margin: '0 auto 8px' }} />
            </div>
          ) : tab === 'users' ? (
            <>
              {/* Create user */}
              <div style={S.card}>
                <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #eee' }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Create New User</span>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  {createMsg && <p style={{ fontSize: 13, color: '#1a7a35', background: '#d4f1dc', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>{createMsg}</p>}
                  {createError && <p style={{ fontSize: 13, color: '#cc0000', background: '#fde8e8', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>{createError}</p>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                    <input style={S.input} placeholder="Username" value={newUsername} onChange={e => setNewUsername(e.target.value)} />
                    <input style={S.input} type="password" placeholder="Password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                    <select style={{ ...S.input, background: 'white' }} value={newRole} onChange={e => setNewRole(e.target.value)}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={createUser} style={{ padding: '8px 16px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Create User</button>
                  </div>
                </div>
              </div>

              {/* Users table */}
              <div style={S.card}>
                <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #eee' }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>All Users</span>
                </div>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9f9f9' }}>
                      {['Username', 'Role', 'Created', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', fontSize: 11, color: '#888', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #eee', letterSpacing: '0.04em' }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 16px', fontWeight: 500 }}>{u.username}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: u.role === 'admin' ? '#f0e8ff' : '#f0f0f0', color: u.role === 'admin' ? '#6600cc' : '#666' }}>{u.role}</span>
                        </td>
                        <td style={{ padding: '10px 16px', color: '#888' }}>{new Date(u.created_at).toLocaleDateString('en-AU')}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {changePwId === u.id ? (
                              <>
                                <input type="password" placeholder="New password" value={changePwValue} onChange={e => setChangePwValue(e.target.value)}
                                  style={{ ...S.input, padding: '5px 8px', fontSize: 12, width: 130 }} />
                                <button onClick={() => changePassword(u.id)} style={{ fontSize: 12, color: '#1a7a35', background: 'none', border: 'none', cursor: 'pointer' }}>Save</button>
                                <button onClick={() => setChangePwId(null)} style={{ fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                              </>
                            ) : (
                              <button onClick={() => setChangePwId(u.id)} style={{ fontSize: 12, color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer' }}>Change password</button>
                            )}
                            <button onClick={() => deleteUser(u.id, u.username)} style={{ fontSize: 12, color: '#cc0000', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            /* Logs table */
            <div style={S.card}>
              <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #eee', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>Activity Log</span>
                <input placeholder="Filter by username..." value={logFilter} onChange={e => setLogFilter(e.target.value)}
                  style={{ ...S.input, width: 200 }} />
              </div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f9f9f9' }}>
                    {['User', 'Action', 'Details', 'Time'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: 11, color: '#888', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #eee', letterSpacing: '0.04em' }}>{h.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: '30px 0', textAlign: 'center', color: '#aaa', fontSize: 13 }}>No activity logs found</td></tr>
                  ) : filteredLogs.map((l, i) => (
                    <tr key={l.id} style={{ borderBottom: '0.5px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#f9f9f9' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 500, verticalAlign: 'top' }}>{l.username}</td>
                      <td style={{ padding: '10px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '2px 8px', background: '#e8f0fb', color: '#0055cc', borderRadius: 8, fontSize: 11, fontWeight: 500 }}>{l.action}</span>
                      </td>
                      <td style={{ padding: '10px 16px', color: '#666', fontSize: 12, maxWidth: 480, verticalAlign: 'top' }}>{l.details || <span style={{ color: '#bbb', fontFamily: 'monospace' }}>{l.path}</span>}</td>
                      <td style={{ padding: '10px 16px', color: '#888', whiteSpace: 'nowrap', fontSize: 12, verticalAlign: 'top' }}>
                        {new Date(l.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
