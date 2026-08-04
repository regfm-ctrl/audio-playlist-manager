'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

type User = { id: number; username: string; role: string; created_at: string; };
type Log = { id: number; username: string; action: string; path: string; created_at: string; };

const S: Record<string, React.CSSProperties> = {
  app: { display: 'flex', height: '100vh', background: '#2a2a2c', fontFamily: 'var(--font-sans)', overflow: 'hidden' },
  sidebar: { width: 260, background: '#2a2a2c', borderRight: '0.5px solid #3a3a3c', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, marginBottom: 2, color: '#888', cursor: 'pointer', fontSize: 14, textDecoration: 'none' },
  navItemActive: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#0071e3', borderRadius: 6, marginBottom: 2, color: 'white', fontSize: 14, textDecoration: 'none' },
  card: { background: 'white', borderRadius: 12, border: '0.5px solid #ddd', overflow: 'hidden', marginBottom: 16 },
  input: { padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: 7, fontSize: 13, outline: 'none' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  dialog: { background: '#3a3a3c', borderRadius: 14, padding: 24, width: '100%' },
};

const IconBreaks = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/></svg>;
const IconSchedule = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v3.5l2 1.5"/></svg>;
const IconAdmin = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>;
const IconCampaign = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h2l2-5 4 10 2-5h2"/></svg>;

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
        <div style={{ padding: '10px 8px 4px' }}>
          <span style={{ fontSize: 10, color: '#555', padding: '0 8px', marginBottom: 6, letterSpacing: '0.05em', display: 'block' }}>LIBRARY</span>
          <a href="/" style={S.navItem}><IconBreaks /> Sponsorship Breaks</a>
        </div>
        <div style={{ padding: '4px 8px' }}>
          <a href="/schedules" style={S.navItem}><IconSchedule /> Schedules</a>
          <a href="/campaigns" style={S.navItem}><IconCampaign /> Campaigns</a>
          <a href="/admin" style={S.navItemActive}><IconAdmin /> Admin</a>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '10px 14px', borderTop: '0.5px solid #3a3a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <div style={{ padding: '12px 20px', background: '#e8e8ed', borderBottom: '0.5px solid #ccc', display: 'flex', alignItems: 'center', gap: 10 }}>
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

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
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
                    {['User', 'Action', 'Path', 'Time'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', fontSize: 11, color: '#888', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #eee', letterSpacing: '0.04em' }}>{h.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: '30px 0', textAlign: 'center', color: '#aaa', fontSize: 13 }}>No activity logs found</td></tr>
                  ) : filteredLogs.map((l, i) => (
                    <tr key={l.id} style={{ borderBottom: '0.5px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#f9f9f9' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 500 }}>{l.username}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ padding: '2px 8px', background: '#e8f0fb', color: '#0055cc', borderRadius: 8, fontSize: 11, fontWeight: 500 }}>{l.action}</span>
                      </td>
                      <td style={{ padding: '10px 16px', color: '#888', fontFamily: 'monospace', fontSize: 12 }}>{l.path}</td>
                      <td style={{ padding: '10px 16px', color: '#888', whiteSpace: 'nowrap', fontSize: 12 }}>
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
