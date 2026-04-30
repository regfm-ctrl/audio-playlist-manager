'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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

  async function loadSchedules() {
    setLoading(true);
    const res = await fetch('/api/schedules');
    if (res.ok) setSchedules(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadSchedules(); }, []);

  async function toggleActive(id: number, schedule: Schedule) {
    await fetch('/api/schedules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...schedule, id, is_active: !schedule.is_active }),
    });
    loadSchedules();
  }

  async function deleteSchedule(id: number) {
    await fetch('/api/schedules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setConfirmDelete(null);
    loadSchedules();
  }

  async function runNow() {
    setRunLoading(true);
    setRunMsg('');
    try {
      const tokenKey = Object.keys(localStorage).find(k => k.includes('access_token') || k.includes('google'));
      const accessToken = tokenKey ? localStorage.getItem(tokenKey) : null;
      if (!accessToken) {
        setRunMsg('⚠️ Please log in to the main app first to connect Google Drive, then return here.');
        return;
      }
      const res = await fetch('/api/schedules/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      const data = await res.json();
      const success = data.results?.filter((r: any) => r.status === 'success').length ?? 0;
      const skipped = data.results?.filter((r: any) => r.status === 'skipped').length ?? 0;
      const failed = data.results?.filter((r: any) => r.status === 'error').length ?? 0;
      setRunMsg(`✅ Run complete — ${success} added, ${skipped} skipped, ${failed} failed.${data.processed === 0 ? ' No schedules were due.' : ''}`);
      loadSchedules();
    } catch {
      setRunMsg('❌ Failed to run schedules');
    } finally {
      setRunLoading(false);
    }
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

  function scheduleTypeBadge(s: Schedule) {
    const map: Record<string, string> = {
      expiry_only: 'bg-gray-100 text-gray-600',
      once: 'bg-orange-100 text-orange-700',
      recurring: 'bg-blue-100 text-blue-700',
    };
    const label: Record<string, string> = {
      expiry_only: 'Expiry only',
      once: 'One-time',
      recurring: 'Recurring',
    };
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[s.schedule_type] ?? 'bg-gray-100 text-gray-600'}`}>
        {label[s.schedule_type] ?? s.schedule_type}
      </span>
    );
  }

  function statusBadge(s: Schedule) {
    if (s.is_active) return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>;
    if (s.expires_at && new Date(s.expires_at) < new Date()) return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">Expired</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Paused</span>;
  }

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <div className="mx-auto px-6 py-8" style={{ maxWidth: '100%' }}>

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Scheduled Additions</h1>
            <p className="text-sm text-gray-500 mt-0.5">Automatically add audio files to playlists on a schedule</p>
          </div>
          <div className="flex gap-3">
            <button onClick={runNow} disabled={runLoading}
              className="text-sm px-5 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">
              {runLoading ? 'Running...' : '▶ Run Now'}
            </button>
            <button onClick={() => router.push('/')}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 whitespace-nowrap">
              ← Back to App
            </button>
          </div>
        </div>

        {/* Run message */}
        {runMsg && (
          <div className="mb-4 px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm">
            {runMsg}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-medium">All Schedules ({schedules.length})</h2>
          </div>

          {loading ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">Loading...</div>
          ) : schedules.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">
              No schedules yet. Use the 🕐 or ⏰ buttons on any audio file in the main app.
            </div>
          ) : (
            <table className="w-full text-sm" style={{ minWidth: '1100px' }}>
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Audio File</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Directory</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Playlist</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Position</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Type</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Schedule</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Next Run</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Last Run</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Expires</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-medium">
                      {s.audio_file_name.replace(/\.[^/.]+$/, '')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                      {s.audio_directory_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.playlist_name.replace(/\.m3u8$/i, '')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                      {s.position >= 0 ? `Position ${s.position + 1}` : 'End'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {scheduleTypeBadge(s)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {formatSchedule(s)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                      {s.schedule_type === 'expiry_only' ? '—' : fmt(s.next_run_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                      {s.last_run_at ? fmt(s.last_run_at) : 'Never'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs">
                      {s.expires_at ? (
                        <span className={new Date(s.expires_at) < new Date() ? 'text-red-400' : 'text-gray-400'}>
                          {fmt(s.expires_at)}
                        </span>
                      ) : (
                        <span className="text-gray-300">No expiry</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {statusBadge(s)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-3">
                        <button onClick={() => toggleActive(s.id, s)}
                          className="text-xs text-blue-500 hover:underline">
                          {s.is_active ? 'Pause' : 'Resume'}
                        </button>
                        <button onClick={() => deleteSchedule(s.id)}
                          className="text-xs text-red-400 hover:underline">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {/* Delete confirmation dialog */}
      {confirmDelete !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="font-semibold text-lg mb-2">Delete Schedule</h2>
            <p className="text-sm text-gray-600 mb-6">Are you sure you want to delete this schedule? This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSchedule(confirmDelete)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
