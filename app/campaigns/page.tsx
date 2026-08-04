'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLAYLIST_FOLDER_ID = process.env.NEXT_PUBLIC_PLAYLIST_FOLDER_ID || '1sPxn5mFxy7DagMtpmGGq4-K1c98BX_-b';

type Campaign = {
  id: number;
  sponsor_name: string;
  audio_file_name: string;
  spots_per_week: number;
  distribution_type: string;
  allowed_days: string | null;
  time_from: string | null;
  time_to: string | null;
  position: number;
  start_date: string;
  end_date: string | null;
  status: string;
  created_at: string;
};

type Playlist = { id: string; name: string };

type PreviewSlot = {
  id: string;
  name: string;
  day: number;
  scheduledFor: string;
};

const fmt = (dt: string) => new Date(dt).toLocaleString('en-AU', {
  timeZone: 'Australia/Melbourne',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
});

const S: Record<string, React.CSSProperties> = {
  app: { display: 'flex', height: '100vh', background: '#2a2a2c', fontFamily: 'var(--font-sans)', overflow: 'hidden' },
  sidebar: { width: 260, background: '#2a2a2c', borderRight: '0.5px solid #3a3a3c', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, marginBottom: 2, color: '#888', cursor: 'pointer', fontSize: 14, textDecoration: 'none' },
  navItemActive: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#0071e3', borderRadius: 6, marginBottom: 2, color: 'white', fontSize: 14, textDecoration: 'none' },
  card: { background: 'white', borderRadius: 12, border: '0.5px solid #ddd', overflow: 'hidden', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: 500, color: '#555', display: 'block', marginBottom: 5 },
  input: { width: '100%', padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' as const, outline: 'none' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  dialog: { background: '#3a3a3c', borderRadius: 14, width: '100%', padding: 24 },
};

const IconBreaks = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/></svg>;
const IconSchedule = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v3.5l2 1.5"/></svg>;
const IconAdmin = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>;
const IconCampaign = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h2l2-5 4 10 2-5h2"/></svg>;

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<PreviewSlot[] | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<any>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  // Form state
  const [form, setForm] = useState({
    sponsor_name: '',
    audio_file_name: '',
    audio_file_id: '',
    audio_directory_name: '',
    audio_local_path: '',
    spots_per_week: 10,
    distribution_type: 'even',
    per_day_counts: { 0: 0, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 0 } as Record<number, number>,
    allowed_days: [1, 2, 3, 4, 5] as number[],
    time_from: '06:00',
    time_to: '18:00',
    allowed_breaks: [] as string[],
    position: -1,
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    use_specific_breaks: false,
  });

  const [breakSearch, setBreakSearch] = useState('');

  useEffect(() => { loadCampaigns(); }, []);

  async function loadCampaigns() {
    setLoading(true);
    const res = await fetch('/api/campaigns');
    if (res.ok) setCampaigns(await res.json());
    setLoading(false);
  }

  async function loadPlaylists() {
    setPlaylistsLoading(true);
    try {
      const tokenKey = Object.keys(localStorage).find(k => k.includes('access_token') || k.includes('google'));
      const token = tokenKey ? localStorage.getItem(tokenKey) : null;
      if (!token) { setMsg('⚠️ Please connect Google Drive in the main app first'); return; }

      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setPlaylists((data.files || []).sort((a: Playlist, b: Playlist) => a.name.localeCompare(b.name)));
      }
    } finally {
      setPlaylistsLoading(false);
    }
  }

  async function generatePreview() {
    if (!form.sponsor_name) { setMsg('Please enter a sponsor name'); return; }
    if (!form.audio_file_name) { setMsg('Please enter an audio file name'); return; }

    if (playlists.length === 0) { setMsg('Loading breaks...'); await loadPlaylists(); }

    const campaign = {
      ...form,
      allowed_days: form.allowed_days.join(','),
      allowed_breaks: form.use_specific_breaks && form.allowed_breaks.length > 0
        ? form.allowed_breaks.join(',')
        : null,
      per_day_counts: form.distribution_type === 'per_day' ? form.per_day_counts : null,
    };

    setMsg('Generating preview...');
    const res = await fetch('/api/campaigns/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign, playlists, confirm: false }),
    });

    const data = await res.json();
    if (!res.ok) { setMsg(`❌ ${data.error}`); return; }

    setPreviewCampaign(campaign);
    setPreview(data.preview);
    setMsg('');
  }

  async function confirmSchedule() {
    if (!previewCampaign || !preview) return;
    setConfirming(true);
    try {
      // First save the campaign
      const saveRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewCampaign),
      });
      const campaign = await saveRes.json();

      // Then generate schedules
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: { ...previewCampaign, id: campaign.id }, playlists, confirm: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`✅ Campaign created! ${data.created} schedules added.`);
        setPreview(null);
        setPreviewCampaign(null);
        setShowForm(false);
        loadCampaigns();
      } else {
        setMsg(`❌ ${data.error}`);
      }
    } finally {
      setConfirming(false);
    }
  }

  async function deleteCampaign(id: number) {
    await fetch('/api/campaigns', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setConfirmDelete(null);
    loadCampaigns();
  }

  async function toggleStatus(campaign: Campaign) {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    await fetch('/api/campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: campaign.id, status: newStatus }),
    });
    loadCampaigns();
  }

  const filteredPlaylists = playlists.filter(p =>
    p.name.toLowerCase().includes(breakSearch.toLowerCase())
  );

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
          <a href="/campaigns" style={S.navItemActive}><IconCampaign /> Campaigns</a>
          <a href="/admin" style={S.navItem}><IconAdmin /> Admin</a>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '10px 14px', borderTop: '0.5px solid #3a3a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white', fontWeight: 500 }}>A</div>
          <span style={{ color: '#666', fontSize: 13 }}>admin</span>
        </div>
      </div>

      {/* Main */}
      <div style={S.main}>
        {/* Toolbar */}
        <div style={{ padding: '12px 20px', background: '#e8e8ed', borderBottom: '0.5px solid #ccc', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 500, margin: 0, color: '#1d1d1f' }}>Campaigns</h1>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Schedule sponsor audio across multiple breaks automatically</p>
          </div>
          <button
            onClick={() => { setShowForm(true); setMsg(''); loadPlaylists(); }}
            style={{ padding: '8px 18px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            + New Campaign
          </button>
        </div>

        {msg && !showForm && (
          <div style={{ margin: '12px 20px 0', padding: '10px 14px', background: 'white', border: '0.5px solid #ddd', borderRadius: 8, fontSize: 13 }}>{msg}</div>
        )}

        {/* Campaign list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          <div style={S.card}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #eee', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>All Campaigns</span>
              <span style={{ background: '#e8e8ed', color: '#666', borderRadius: 10, padding: '1px 8px', fontSize: 12 }}>{campaigns.length}</span>
            </div>
            {loading ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: '#0071e3', margin: '0 auto 8px' }} />
              </div>
            ) : campaigns.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#aaa', fontSize: 14 }}>
                No campaigns yet. Click "+ New Campaign" to get started.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 800 }}>
                  <thead>
                    <tr style={{ background: '#f9f9f9' }}>
                      {['Sponsor', 'Audio File', 'Spots/Week', 'Distribution', 'Days', 'Times', 'Start', 'End', 'Status', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontWeight: 500, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '0.5px solid #eee' }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map(c => (
                      <tr key={c.id} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{c.sponsor_name}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>{c.audio_file_name.replace(/\.[^/.]+$/, '')}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>{c.spots_per_week}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: c.distribution_type === 'even' ? '#e8f0fb' : c.distribution_type === 'random' ? '#fff8e8' : '#e4f5ee', color: c.distribution_type === 'even' ? '#0055cc' : c.distribution_type === 'random' ? '#a06000' : '#0a6e46' }}>
                            {c.distribution_type}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>
                          {c.allowed_days ? c.allowed_days.split(',').map(d => DAYS[parseInt(d)]).join(', ') : 'All'}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>
                          {c.time_from && c.time_to ? `${c.time_from} – ${c.time_to}` : 'Any'}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>{new Date(c.start_date).toLocaleDateString('en-AU')}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>{c.end_date ? new Date(c.end_date).toLocaleDateString('en-AU') : 'Ongoing'}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: c.status === 'active' ? '#d4f1dc' : '#f0f0f0', color: c.status === 'active' ? '#1a7a35' : '#666' }}>
                            {c.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => toggleStatus(c)} style={{ fontSize: 12, color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                              {c.status === 'active' ? 'Pause' : 'Resume'}
                            </button>
                            <button onClick={() => setConfirmDelete(c.id)} style={{ fontSize: 12, color: '#cc0000', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Campaign Form */}
      {showForm && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 500, color: 'white', margin: 0 }}>New Campaign</h2>
              <button onClick={() => { setShowForm(false); setPreview(null); setMsg(''); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            {msg && <p style={{ fontSize: 13, color: '#e0e0e0', marginBottom: 12, background: '#2a2a2c', padding: '8px 12px', borderRadius: 6 }}>{msg}</p>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Sponsor name */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Sponsor Name</label>
                <input value={form.sponsor_name} onChange={e => setForm(f => ({ ...f, sponsor_name: e.target.value }))} placeholder="e.g. ACME Hardware" style={S.input} />
              </div>

              {/* Audio file */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Audio File Name</label>
                <input value={form.audio_file_name} onChange={e => setForm(f => ({ ...f, audio_file_name: e.target.value }))} placeholder="e.g. ACME - 30sec spot.mp3" style={S.input} />
                <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Enter the filename as it appears in RadioBOSS. The local path will be used as-is.</p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Local Path (RadioBOSS)</label>
                <input value={form.audio_local_path} onChange={e => setForm(f => ({ ...f, audio_local_path: e.target.value }))} placeholder="T:\REGFM RadioBOSS\Sponsors\filename.mp3" style={S.input} />
              </div>

              {/* Spots per week */}
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Spots Per Week</label>
                <input type="number" min={1} max={100} value={form.spots_per_week} onChange={e => setForm(f => ({ ...f, spots_per_week: parseInt(e.target.value) || 1 }))} style={S.input} />
              </div>

              {/* Position */}
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Position in Break</label>
                <select value={form.position} onChange={e => setForm(f => ({ ...f, position: parseInt(e.target.value) }))} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }}>
                  <option value={-1}>Add to end</option>
                  <option value={0}>Add at beginning</option>
                  {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>After position {n}</option>)}
                </select>
              </div>

              {/* Distribution type */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Distribution</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[['even', 'Spread Evenly'], ['random', 'Random'], ['per_day', 'Per Day']].map(([val, label]) => (
                    <button key={val} onClick={() => setForm(f => ({ ...f, distribution_type: val }))}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 13, cursor: 'pointer', border: '0.5px solid #555', background: form.distribution_type === val ? '#0071e3' : '#2a2a2c', color: form.distribution_type === val ? 'white' : '#aaa' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Per day counts */}
              {form.distribution_type === 'per_day' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ ...S.label, color: '#ddd' }}>Spots Per Day</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {DAYS.map((day, i) => (
                      <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>{day}</div>
                        <input type="number" min={0} max={20} value={form.per_day_counts[i] || 0}
                          onChange={e => setForm(f => ({ ...f, per_day_counts: { ...f.per_day_counts, [i]: parseInt(e.target.value) || 0 } }))}
                          style={{ ...S.input, textAlign: 'center', padding: '6px 4px' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Allowed days */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Allowed Days</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DAYS.map((day, i) => (
                    <button key={i} onClick={() => setForm(f => ({ ...f, allowed_days: f.allowed_days.includes(i) ? f.allowed_days.filter(d => d !== i) : [...f.allowed_days, i] }))}
                      style={{ flex: 1, padding: '6px 0', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: 'none', background: form.allowed_days.includes(i) ? '#0071e3' : '#2a2a2c', color: form.allowed_days.includes(i) ? 'white' : '#777' }}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time range */}
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Time From</label>
                <input type="time" value={form.time_from} onChange={e => setForm(f => ({ ...f, time_from: e.target.value }))} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }} />
              </div>
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Time To</label>
                <input type="time" value={form.time_to} onChange={e => setForm(f => ({ ...f, time_to: e.target.value }))} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }} />
              </div>

              {/* Dates */}
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Start Date</label>
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }} />
              </div>
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>End Date <span style={{ color: '#888', fontWeight: 400 }}>(optional)</span></label>
                <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} min={form.start_date} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }} />
              </div>

              {/* Specific breaks toggle */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.use_specific_breaks} onChange={e => setForm(f => ({ ...f, use_specific_breaks: e.target.checked }))} style={{ accentColor: '#0071e3' }} />
                  <span style={{ fontSize: 13, color: '#ddd' }}>Restrict to specific breaks only</span>
                </label>
              </div>

              {/* Specific breaks selector */}
              {form.use_specific_breaks && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ ...S.label, color: '#ddd' }}>
                    Select Breaks
                    {form.allowed_breaks.length > 0 && <span style={{ background: '#0071e3', color: 'white', borderRadius: 10, padding: '1px 7px', fontSize: 11, marginLeft: 6 }}>{form.allowed_breaks.length} selected</span>}
                  </label>
                  <input placeholder="Search breaks..." value={breakSearch} onChange={e => setBreakSearch(e.target.value)}
                    style={{ ...S.input, marginBottom: 6, background: '#4a4a4c', color: 'white' }} />
                  {playlistsLoading ? (
                    <div style={{ textAlign: 'center', padding: 16, color: '#888' }}>Loading breaks...</div>
                  ) : (
                    <div style={{ border: '0.5px solid #555', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
                      {filteredPlaylists.map(pl => {
                        const isSelected = form.allowed_breaks.includes(pl.id)
                        return (
                          <label key={pl.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', background: isSelected ? '#0071e322' : '#3a3a3c', borderBottom: '0.5px solid #4a4a4c', fontSize: 13 }}>
                            <input type="checkbox" checked={isSelected} style={{ accentColor: '#0071e3' }}
                              onChange={() => setForm(f => ({ ...f, allowed_breaks: isSelected ? f.allowed_breaks.filter(id => id !== pl.id) : [...f.allowed_breaks, pl.id] }))} />
                            <span style={{ color: isSelected ? '#4da3ff' : '#bbb' }}>{pl.name.replace(/\.m3u8$/i, '')}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button onClick={generatePreview}
              style={{ width: '100%', marginTop: 20, padding: '12px 0', background: '#0071e3', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Preview Schedule →
            </button>
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      {preview && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 500, color: 'white', margin: 0 }}>Schedule Preview</h2>
                <p style={{ fontSize: 13, color: '#aaa', margin: '3px 0 0' }}>{previewCampaign?.sponsor_name} — {preview.length} spots this week</p>
              </div>
              <button onClick={() => setPreview(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20, maxHeight: 400, overflowY: 'auto' }}>
              {preview.map((slot, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: i % 2 === 0 ? '#2a2a2c' : '#333335', borderRadius: 6 }}>
                  <span style={{ fontSize: 12, color: '#0071e3', fontWeight: 600, width: 24, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500 }}>{slot.name.replace(/\.m3u8$/i, '')}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{fmt(slot.scheduledFor)}</div>
                  </div>
                  <span style={{ fontSize: 11, color: '#4da3ff', background: '#0071e322', padding: '2px 8px', borderRadius: 10 }}>{DAYS[slot.day]}</span>
                </div>
              ))}
            </div>

            <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
              These schedules will repeat weekly until {previewCampaign?.end_date ? new Date(previewCampaign.end_date).toLocaleDateString('en-AU') : 'manually stopped'}.
            </p>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPreview(null)} style={{ flex: 1, padding: '11px 0', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
                ← Edit
              </button>
              <button onClick={confirmSchedule} disabled={confirming}
                style={{ flex: 1, padding: '11px 0', background: '#0071e3', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: confirming ? 0.6 : 1 }}>
                {confirming ? 'Creating...' : '✓ Confirm & Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete !== null && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 360 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: 'white', margin: '0 0 8px' }}>Delete Campaign</h2>
            <p style={{ fontSize: 14, color: '#aaa', marginBottom: 24 }}>Are you sure? This will not remove any already-created schedules.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: '10px 0', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => deleteCampaign(confirmDelete)} style={{ flex: 1, padding: '10px 0', background: '#cc0000', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
