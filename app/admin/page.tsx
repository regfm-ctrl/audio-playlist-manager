'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type User = {
  id: number;
  username: string;
  role: string;
  created_at: string;
};

type Log = {
  id: number;
  username: string;
  action: string;
  path: string;
  created_at: string;
};

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [tab, setTab] = useState<'users' | 'logs'>('users');

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [createMsg, setCreateMsg] = useState('');
  const [createError, setCreateError] = useState('');

  // Change password form
  const [changePwId, setChangePwId] = useState<number | null>(null);
  const [changePwValue, setChangePwValue] = useState('');

  // Log filter
  const [logFilter, setLogFilter] = useState('');

  async function loadData() {
    const [u, l] = await Promise.all([
      fetch('/api/admin/users').then((r) => r.json()),
      fetch('/api/admin/logs').then((r) => r.json()),
    ]);
    if (Array.isArray(u)) setUsers(u);
    if (Array.isArray(l)) setLogs(l);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function createUser() {
    setCreateMsg('');
    setCreateError('');
    if (!newUsername || !newPassword) {
      setCreateError('Username and password are required');
      return;
    }
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
    });
    if (res.ok) {
      setCreateMsg(`User "${newUsername}" created successfully`);
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      loadData();
    } else {
      const data = await res.json();
      setCreateError(data.error ?? 'Failed to create user');
    }
  }

  async function deleteUser(id: number, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadData();
  }

  async function changePassword(id: number) {
    if (!changePwValue) return;
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password: changePwValue }),
    });
    setChangePwId(null);
    setChangePwValue('');
    alert('Password updated');
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const filteredLogs = logFilter
    ? logs.filter((l) => l.username?.toLowerCase().includes(logFilter.toLowerCase()))
    : logs;

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage users and review activity</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/')}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              ← App
            </button>
            <button
              onClick={logout}
              className="text-sm px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-800"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white border border-gray-200 rounded-lg p-1 w-fit">
          {(['users', 'logs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                tab === t ? 'bg-black text-white' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {t} {t === 'users' ? `(${users.length})` : `(${logs.length})`}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div className="space-y-6">
            {/* Create User */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-medium mb-4">Create New User</h2>
              {createMsg && (
                <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg mb-3">{createMsg}</p>
              )}
              {createError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{createError}</p>
              )}
              <div className="flex gap-2 flex-wrap">
                <input
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
                <input
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  type="password"
                  placeholder="Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <select
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={createUser}
                  className="bg-black text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
                >
                  Create User
                </button>
              </div>
            </div>

            {/* Users Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-medium">All Users</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
                    <th className="px-5 py-3 font-medium">Username</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-5 py-3 font-medium">{u.username}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            u.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-400">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {changePwId === u.id ? (
                            <div className="flex gap-2 items-center">
                              <input
                                className="border border-gray-200 rounded px-2 py-1 text-xs w-32"
                                type="password"
                                placeholder="New password"
                                value={changePwValue}
                                onChange={(e) => setChangePwValue(e.target.value)}
                              />
                              <button
                                onClick={() => changePassword(u.id)}
                                className="text-xs text-green-600 hover:underline"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setChangePwId(null)}
                                className="text-xs text-gray-400 hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setChangePwId(u.id)}
                              className="text-xs text-blue-500 hover:underline"
                            >
                              Change password
                            </button>
                          )}
                          <button
                            onClick={() => deleteUser(u.id, u.username)}
                            className="text-xs text-red-400 hover:text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'logs' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
              <h2 className="font-medium">Activity Log</h2>
              <input
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 w-48"
                placeholder="Filter by username…"
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
              />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Path</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-3 font-medium">{l.username}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 font-mono text-xs">{l.path}</td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-gray-400 text-sm">
                      No activity logs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
