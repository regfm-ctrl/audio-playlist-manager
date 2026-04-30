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
  created_by: string;
  created_at: string;
};

export default function SchedulesPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [runMsg, setRunMsg] = useState('');
  const [runLoading, setRunLoading] = useState(false);

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
    if (!confirm('Delete this schedule?')) return;
    await fetch('/api/schedules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadSchedules();
  }

  async function runNow() {
    setRunLoading(true);
    setRunMsg('');
    try {
      // Get Google token from localStorage
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
      setRunMsg(`✅ Run complete — ${success} added, ${skipped} skipped, ${failed} failed. ${data.processed === 0 ? 'No schedules were due.' : ''}`);
      loadSchedules();
    } catch (err) {
      setRunMsg('❌ Failed to run schedules');
    } finally {
      setRunLoading(false);
    }
  }

  function formatDays(daysStr: string | null) {
    if (!daysStr) return '—';
    return daysStr.split(',').map(d => DAYS[parseInt(d)]).join(', ');
  }

  function formatDates(datesStr: string | null) {
    if (!datesStr) return '—';
    return datesStr.split(',').map(d => new Date(d.trim()).toLocaleDateString('en-AU')).join(', ');
  }

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Scheduled Additions</h1>
            <p className="text-sm text-gray-500 mt-0.5">Automatically add audio files to playlists on a schedule</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={runNow}
              disabled={runLoading}
              className="text-sm px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {runLoading ? 'Running...' : '▶ Run Now'}
            </button>
            <button
              onClick={() => router.push('/')}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              ← Back to App
            </button>
          </div>
        </div>

        {runMsg && (
          <div className="mb-4 px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm">
            {runMsg}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="font-medium">All Schedules ({schedules.length})</h2>
          </div>

          {loading ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">Loading...</div>
          ) : schedules.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">
              No schedules yet. Use the schedule button (🕐) on any audio file in the main app.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
                  <th className="px-5 py-3 font-medium">Audio File</th>
                  <th className="px-5 py-3 font-medium">Playlist</th>
                  <th className="px-5 py-3 font-medium">Position</th>
                  <th className="px-5 py-3 font-medium">Schedule</th>
                  <th className="px-5 py-3 font-medium">Next Run</th>
                  <th className="px-5 py-3 font-medium">Last Run</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">{s.audio_file_name.replace(/\.[^/.]+$/, '')}</div>
                      <div className="text-xs text-gray-400">{s.audio_directory_name}</div>
                    </td>
                    <td className="px-5 py-3">{s.playlist_name.replace(/\.m3u8$/i, '')}</td>
                    <td className="px-5 py-3 text-gray-500">
                      {s.position >= 0 ? `Position ${s.position + 1}` : 'End'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium mr-1 ${
                          s.schedule_type === 'once' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {s.schedule_type === 'once' ? 'One-time' : 'Recurring'}
                        </span>
                        {s.schedule_type === 'recurring'
                          ? formatDays(s.days_of_week)
                          : formatDates(s.specific_dates)}
                        {' @ '}{s.time_of_day}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {s.next_run_at ? new Date(s.next_run_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' }) : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {s.last_run_at ? new Date(s.last_run_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' }) : 'Never'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {s.is_active ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => toggleActive(s.id, s)}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          {s.is_active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => deleteSchedule(s.id)}
                          className="text-xs text-red-400 hover:underline"
                        >
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
    </div>
  );
}

