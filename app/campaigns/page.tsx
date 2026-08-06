'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getGoogleAccessToken } from '@/lib/client-google-token';
import { BUSINESS_CATEGORIES } from '@/lib/business-categories';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Campaign = {
  id: number;
  sponsor_name: string;
  business_category: string | null;
  booking_reference: string | null;
  booking_details: string | null;
  randomize_weekly: boolean;
  audio_file_name: string;
  audio_file_id: string | null;
  audio_directory_name: string | null;
  audio_local_path: string;
  spots_per_week: number;
  distribution_type: string;
  per_day_counts: string | Record<number, number> | null;
  allowed_days: string | null;
  allowed_breaks: string | null;
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
  sidebar: { width: 260, minWidth: 260, maxWidth: 260, background: '#2a2a2c', borderRight: '0.5px solid #3a3a3c', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
  navItem: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, marginBottom: 2, color: '#777', cursor: 'pointer', fontSize: 13, textDecoration: 'none' as const },
  navItemActive: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: '#0071e3', borderRadius: 8, marginBottom: 2, color: 'white', fontSize: 13, textDecoration: 'none' as const },
  card: { background: 'white', borderRadius: 12, border: '0.5px solid #ddd', overflow: 'hidden', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: 500, color: '#555', display: 'block', marginBottom: 5 },
  input: { width: '100%', padding: '8px 12px', border: '0.5px solid #555', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' as const, outline: 'none', background: '#4a4a4c', color: 'white' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  dialog: { background: '#3a3a3c', borderRadius: 14, width: '100%', padding: 24 },
};

const IconBreaks = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/></svg>;
const IconSchedule = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v3.5l2 1.5"/></svg>;
const IconAdmin = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg>;
const IconCampaign = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h2l2-5 4 10 2-5h2"/></svg>;
const IconOverview = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="5.5" y1="2.5" x2="5.5" y2="4.5"/><line x1="10.5" y1="2.5" x2="10.5" y2="4.5"/></svg>;

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<PreviewSlot[] | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<any>(null);
  const [previewDiff, setPreviewDiff] = useState<{ added: string[]; removed: string[]; unchanged: string[]; audioChanged: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleteWithSchedules, setDeleteWithSchedules] = useState(false);
  const [deletingSchedules, setDeletingSchedules] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(0);
  const [viewSchedulesCampaign, setViewSchedulesCampaign] = useState<Campaign | null>(null);
  const [campaignSchedules, setCampaignSchedules] = useState<any[]>([]);
  const [campaignSchedulesLoading, setCampaignSchedulesLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);

  // Form state
  const defaultForm = {
    sponsor_name: '',
    business_category: '',
    booking_reference: '',
    booking_details: '',
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
    randomize_weekly: false,
  };
  const [form, setForm] = useState(defaultForm);

  const [breakSearch, setBreakSearch] = useState('');

  // Audio file picker
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [pickerFiles, setPickerFiles] = useState<{ id: string; name: string; dir: string; localPath: string }[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  // Matches DEFAULT_AUDIO_DIRECTORIES in lib/folder-config.ts
  const AUDIO_DIRECTORIES = [
    { name: 'IDs - Test Update', driveId: '1cy56CgC1KtxCgZI-kGOEWTTNuC5rjzh_', localPath: 'T:\\REGFM RadioBOSS\\IDs\\{filename}' },
    { name: 'CSAs - Audio', driveId: '14Oy00clKujI6ldWv7NW35DybZVBN_MPm', localPath: 'T:\\REGFM RadioBOSS\\CSAs Audio\\{filename}' },
    { name: 'Promos - Audio', driveId: '1PzkL-eDZVPU-g3D7c5IUY93g14-SV3l6', localPath: 'T:\\REGFM RadioBOSS\\Promos\\{filename}' },
    { name: 'Sponsors - Audio', driveId: '1B_LOIo2jl_-P-1UrWoRZ4W688_lk0NQC', localPath: 'T:\\REGFM RadioBOSS\\Sponsors\\{filename}' },
  ];

  const [pickerDirectory, setPickerDirectory] = useState(0); // selected tab index
  const [pickerDirCache, setPickerDirCache] = useState<Record<number, { id: string; name: string; dir: string; localPath: string }[]>>({});

  async function openFilePicker() {
    setShowFilePicker(true);
    setPickerDirectory(0);
    loadPickerDirectory(0);
  }

  async function loadPickerDirectory(dirIndex: number) {
    setPickerDirectory(dirIndex);
    // Use cache if already loaded
    if (pickerDirCache[dirIndex]) {
      setPickerFiles(pickerDirCache[dirIndex]);
      return;
    }
    setPickerLoading(true);
    setPickerFiles([]);
    try {
      const token = await getGoogleAccessToken();
      if (!token) { setMsg('⚠️ Google Drive is not connected — connect it in the main app first'); setShowFilePicker(false); return; }
      const dir = AUDIO_DIRECTORIES[dirIndex];
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${dir.driveId}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        const files = (data.files || [])
          .filter((f: { id: string; name: string }) => f.name.match(/\.(mp3|wav)$/i))
          .map((f: { id: string; name: string }) => ({ id: f.id, name: f.name, dir: dir.name, localPath: dir.localPath.replace('{filename}', f.name) }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
        setPickerFiles(files);
        setPickerDirCache(prev => ({ ...prev, [dirIndex]: files }));
      }
    } finally {
      setPickerLoading(false);
    }
  }

  function selectFile(file: { id: string; name: string; dir: string; localPath: string }) {
    setForm(f => ({
      ...f,
      audio_file_id: file.id,
      audio_file_name: file.name,
      audio_directory_name: file.dir,
      audio_local_path: file.localPath,
    }));
    setShowFilePicker(false);
    setPickerSearch('');
  }

  useEffect(() => { loadCampaigns(); }, []);

  // Deletion has no real progress signal from the server mid-request, so
  // ease toward 90% while it's running (never claiming completion until
  // it actually finishes) — gives visible motion instead of a static wait.
  useEffect(() => {
    if (!deletingSchedules) { setDeleteProgress(0); return; }
    setDeleteProgress(8);
    const interval = setInterval(() => {
      setDeleteProgress(p => p < 90 ? p + (90 - p) * 0.08 : p);
    }, 250);
    return () => clearInterval(interval);
  }, [deletingSchedules]);

  async function loadCampaigns() {
    setLoading(true);
    const res = await fetch('/api/campaigns');
    if (res.ok) setCampaigns(await res.json());
    setLoading(false);
  }

  async function loadPlaylists() {
    setPlaylistsLoading(true);
    try {
      const token = await getGoogleAccessToken();
      if (!token) { setMsg('⚠️ Google Drive is not connected — connect it in the main app first'); return; }

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
      id: editingCampaignId ?? undefined,
      allowed_days: form.allowed_days.join(','),
      allowed_breaks: form.use_specific_breaks && form.allowed_breaks.length > 0
        ? form.allowed_breaks.join(',')
        : null,
      per_day_counts: form.distribution_type === 'per_day' ? form.per_day_counts : null,
    };

    setMsg('Generating preview...');
    const accessToken = await getGoogleAccessToken();

    const res = await fetch('/api/campaigns/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign, playlists, accessToken, confirm: false, isEdit: !!editingCampaignId }),
    });

    const data = await res.json();
    if (!res.ok) {
      const debugInfo = data.debug ? `\n\nDebug: ${data.debug.playlistCount} playlists loaded, ${data.debug.matchingCount ?? 0} matched. Sample: ${data.debug.samplePlaylists?.join(', ')}` : '';
      setMsg(`❌ ${data.error}${debugInfo}`);
      return;
    }

    setPreviewCampaign(campaign);
    setPreview(data.preview);
    setPreviewDiff(data.diff ?? null);
    if (data.skippedDueToConflict && data.skippedDueToConflict.length > 0) {
      setMsg(`⚠️ ${data.skippedDueToConflict.length} break(s) skipped — already occupied by another "${campaign.business_category}" campaign with no free break in the same hour: ${data.skippedDueToConflict.join(', ')}`);
    } else {
      setMsg('');
    }
  }

  async function confirmSchedule() {
    if (!previewCampaign || !preview) return;
    setConfirming(true);
    try {
      const isEdit = !!editingCampaignId;
      let campaignId = editingCampaignId;

      if (isEdit) {
        // Update the existing campaign record in place
        await fetch('/api/campaigns', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...previewCampaign, id: editingCampaignId }),
        });
      } else {
        // Create a new campaign record
        const saveRes = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(previewCampaign),
        });
        const created = await saveRes.json();
        campaignId = created.id;
      }

      // Then reconcile schedules — pass preview slots directly so API doesn't recalculate
      const accessToken2 = await getGoogleAccessToken();
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign: { ...previewCampaign, id: campaignId },
          previewSlots: preview, // send the already-calculated slots directly
          playlists,
          accessToken: accessToken2,
          confirm: true,
          isEdit,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const errNote = data.errors?.length > 0 ? ` (${data.errors.length} failed)` : '';
        setMsg(isEdit
          ? `✅ Campaign updated! ${data.created} added, ${data.removed} removed, ${data.refreshed} unchanged${errNote}.`
          : `✅ Campaign created! ${data.created} of ${data.total} schedules added${errNote}.`);
        setPreview(null);
        setPreviewCampaign(null);
        setPreviewDiff(null);
        setShowForm(false);
        setEditingCampaignId(null);
        loadCampaigns();
      } else {
        const errDetail = data.errors?.length > 0 ? `\n${data.errors.slice(0,3).join('\n')}` : '';
        const debugDetail = data.debug ? `\nDebug: slots=${data.debug.slotsWithDatesLength}, playlists=${data.debug.playlistCount}` : '';
        setMsg(`❌ ${data.error}${errDetail}${debugDetail}`);
      }
    } finally {
      setConfirming(false);
    }
  }

  function editCampaign(campaign: Campaign) {
    let perDayCounts = { 0: 0, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 0 } as Record<number, number>;
    if (campaign.per_day_counts) {
      try {
        const parsed = typeof campaign.per_day_counts === 'string' ? JSON.parse(campaign.per_day_counts) : campaign.per_day_counts;
        perDayCounts = parsed;
      } catch {}
    }
    const allowedBreaks = campaign.allowed_breaks ? campaign.allowed_breaks.split(',') : [];

    setForm({
      sponsor_name: campaign.sponsor_name,
      business_category: campaign.business_category || '',
      booking_reference: campaign.booking_reference || '',
      booking_details: campaign.booking_details || '',
      audio_file_name: campaign.audio_file_name,
      audio_file_id: campaign.audio_file_id || '',
      audio_directory_name: campaign.audio_directory_name || '',
      audio_local_path: campaign.audio_local_path,
      spots_per_week: campaign.spots_per_week,
      distribution_type: campaign.distribution_type,
      per_day_counts: perDayCounts,
      allowed_days: campaign.allowed_days ? campaign.allowed_days.split(',').map(Number) : [1, 2, 3, 4, 5],
      time_from: campaign.time_from || '06:00',
      time_to: campaign.time_to || '18:00',
      allowed_breaks: allowedBreaks,
      position: campaign.position,
      start_date: campaign.start_date.split('T')[0],
      end_date: campaign.end_date ? campaign.end_date.split('T')[0] : '',
      use_specific_breaks: allowedBreaks.length > 0,
      randomize_weekly: !!campaign.randomize_weekly,
    });
    setEditingCampaignId(campaign.id);
    setShowForm(true);
    setMsg('');
    loadPlaylists();
  }

  async function deleteCampaign(id: number, withSchedules: boolean) {
    setDeletingSchedules(true);
    try {
      const accessToken = withSchedules ? await getGoogleAccessToken() : null;
      await fetch('/api/campaigns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, withSchedules, accessToken }),
      });
      setDeleteProgress(100);
      await new Promise(r => setTimeout(r, 250)); // let the bar visibly reach the end
    } finally {
      setDeletingSchedules(false);
      setConfirmDelete(null);
      setDeleteWithSchedules(false);
      loadCampaigns();
    }
  }

  async function viewCampaignSchedules(campaign: Campaign) {
    setViewSchedulesCampaign(campaign);
    setCampaignSchedulesLoading(true);
    setCampaignSchedules([]);
    try {
      const res = await fetch('/api/schedules');
      if (res.ok) {
        const all = await res.json();
        const matching = all.filter((s: any) => s.audio_file_name === campaign.audio_file_name);
        setCampaignSchedules(matching);
      }
    } finally {
      setCampaignSchedulesLoading(false);
    }
  }

  function weeksRemaining(campaign: Campaign): number | null {
    if (!campaign.end_date) return null;
    const now = new Date();
    const end = new Date(campaign.end_date);
    const ms = end.getTime() - now.getTime();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (7 * 24 * 60 * 60 * 1000));
  }

  function spotsRemaining(campaign: Campaign): number | null {
    const weeks = weeksRemaining(campaign);
    if (weeks === null) return null;
    return weeks * campaign.spots_per_week;
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
        <div style={{ padding: '10px 8px 8px' }}>
          <span style={{ fontSize: 9, color: '#4a4a4c', padding: '0 6px', marginBottom: 5, letterSpacing: '0.1em', fontWeight: 600, display: 'block' }}>MENU</span>
          <a href="/" style={S.navItem}><IconBreaks /> Sponsorship Breaks</a>
          <a href="/schedules" style={S.navItem}><IconSchedule /> Schedules</a>
          <a href="/campaigns" style={S.navItemActive}><IconCampaign /> Campaigns</a>
          <a href="/schedule-overview" style={S.navItem}><IconOverview /> Weekly Overview</a>
          <a href="/admin" style={S.navItem}><IconAdmin /> Admin</a>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '8px 12px', borderTop: '0.5px solid #3a3a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white', fontWeight: 500 }}>A</div>
          <span style={{ color: '#777', fontSize: 12, flex: 1 }}>admin</span>
          <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login' }} title="Logout" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 0, display: 'flex', alignItems: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/><path d="M10 11l4-3-4-3"/><line x1="14" y1="8" x2="6" y2="8"/>
            </svg>
          </button>
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
            onClick={() => { setForm(defaultForm); setEditingCampaignId(null); setShowForm(true); setMsg(''); loadPlaylists(); }}
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
                      {['Sponsor', 'Audio File', 'Spots/Week', 'Distribution', 'Days', 'Times', 'Start', 'End', 'Weeks Left', 'Spots Left', 'Status', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontWeight: 500, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '0.5px solid #eee' }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map(c => (
                      <tr key={c.id} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {c.sponsor_name}
                          {c.business_category && <div style={{ fontSize: 10, color: '#888', fontWeight: 400, marginTop: 1 }}>{c.business_category}</div>}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>{c.audio_file_name.replace(/\.[^/.]+$/, '')}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>{c.spots_per_week}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: c.distribution_type === 'even' ? '#e8f0fb' : c.distribution_type === 'random' ? '#fff8e8' : '#e4f5ee', color: c.distribution_type === 'even' ? '#0055cc' : c.distribution_type === 'random' ? '#a06000' : '#0a6e46' }}>
                            {c.distribution_type}
                          </span>
                          {c.randomize_weekly && (
                            <span title="Reshuffles every Monday" style={{ marginLeft: 4, padding: '2px 6px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: '#f0e8fb', color: '#6b21a8' }}>🔀 weekly</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>
                          {c.allowed_days ? c.allowed_days.split(',').map(d => DAYS[parseInt(d)]).join(', ') : 'All'}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>
                          {c.time_from && c.time_to ? `${c.time_from} – ${c.time_to}` : 'Any'}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>{new Date(c.start_date).toLocaleDateString('en-AU')}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>{c.end_date ? new Date(c.end_date).toLocaleDateString('en-AU') : 'Ongoing'}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                          {weeksRemaining(c) === null ? <span style={{ color: '#aaa' }}>∞</span> : weeksRemaining(c) === 0 ? <span style={{ color: '#cc0000', fontWeight: 500 }}>Ended</span> : <span style={{ color: '#1a7a35', fontWeight: 500 }}>{weeksRemaining(c)}</span>}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                          {spotsRemaining(c) === null ? <span style={{ color: '#aaa' }}>∞</span> : spotsRemaining(c) === 0 ? <span style={{ color: '#cc0000', fontWeight: 500 }}>0</span> : <span style={{ color: '#0055cc', fontWeight: 500 }}>{spotsRemaining(c)?.toLocaleString()}</span>}
                        </td>
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
                            <button onClick={() => editCampaign(c)} style={{ fontSize: 12, color: '#a06000', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Edit</button>
                            <a href={`/api/campaigns/${c.id}/broadcast-schedule`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#5b8def', textDecoration: 'none' }}>Broadcast Schedule</a>
                            <button onClick={() => viewCampaignSchedules(c)} style={{ fontSize: 12, color: '#0a6e46', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Schedules</button>
                            <button onClick={() => { setConfirmDelete(c.id); setDeleteWithSchedules(false); }} style={{ fontSize: 12, color: '#cc0000', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
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

      {/* Campaign Form */}
      {showForm && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 500, color: 'white', margin: 0 }}>{editingCampaignId ? 'Edit Campaign' : 'New Campaign'}</h2>
              <button onClick={() => { setShowForm(false); setPreview(null); setPreviewDiff(null); setEditingCampaignId(null); setMsg(''); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            {msg && <p style={{ fontSize: 13, color: '#e0e0e0', marginBottom: 12, background: '#2a2a2c', padding: '8px 12px', borderRadius: 6 }}>{msg}</p>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Sponsor name */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Sponsor Name</label>
                <input value={form.sponsor_name} onChange={e => setForm(f => ({ ...f, sponsor_name: e.target.value }))} placeholder="e.g. ACME Hardware" style={S.input} />
              </div>

              {/* Business category */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Business Category</label>
                <select
                  value={form.business_category}
                  onChange={e => setForm(f => ({ ...f, business_category: e.target.value }))}
                  style={S.input}
                >
                  <option value="">— None —</option>
                  {BUSINESS_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  Optional — campaigns sharing a category will never be scheduled into the same break.
                </p>
              </div>

              {/* Booking reference / details — shown on the Broadcast Schedule PDF */}
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Booking Reference</label>
                <input value={form.booking_reference} onChange={e => setForm(f => ({ ...f, booking_reference: e.target.value }))} placeholder="e.g. S526" style={S.input} />
              </div>
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Booking Details</label>
                <input value={form.booking_details} onChange={e => setForm(f => ({ ...f, booking_details: e.target.value }))} placeholder="e.g. 10 x 30 second spots per week" style={S.input} />
              </div>

              {/* Audio file picker */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Audio File</label>
                {form.audio_file_name ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#0071e322', border: '0.5px solid #0071e344', borderRadius: 7 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: '#4da3ff', fontWeight: 500 }}>{form.audio_file_name.replace(/\.[^/.]+$/, '')}</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{form.audio_local_path}</div>
                    </div>
                    <button onClick={openFilePicker} style={{ padding: '4px 10px', background: '#4a4a4c', border: '0.5px solid #666', borderRadius: 5, color: '#ddd', fontSize: 12, cursor: 'pointer' }}>Change</button>
                  </div>
                ) : (
                  <button onClick={openFilePicker} style={{ width: '100%', padding: '10px 0', background: '#4a4a4c', border: '0.5px dashed #666', borderRadius: 7, color: '#aaa', fontSize: 13, cursor: 'pointer' }}>
                    📂 Browse Audio Files
                  </button>
                )}
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

              {/* Randomize weekly */}
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'flex-start', gap: 8, background: '#2a2a2c', borderRadius: 8, padding: '10px 12px' }}>
                <input type="checkbox" id="randomize_weekly" checked={form.randomize_weekly}
                  onChange={e => setForm(f => ({ ...f, randomize_weekly: e.target.checked }))}
                  style={{ marginTop: 3, accentColor: '#0071e3' }} />
                <label htmlFor="randomize_weekly" style={{ fontSize: 13, color: '#ddd', cursor: 'pointer' }}>
                  Randomize weekly
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    Every Monday, automatically pick a fresh set of breaks (same days/spots/time range), avoiding last week's exact times where possible — so the same ad isn't always heard at the same time each week.
                  </div>
                </label>
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
                <h2 style={{ fontSize: 18, fontWeight: 500, color: 'white', margin: 0 }}>{editingCampaignId ? 'Review Changes' : 'Schedule Preview'}</h2>
                <p style={{ fontSize: 13, color: '#aaa', margin: '3px 0 0' }}>{previewCampaign?.sponsor_name} — {preview.length} spots this week</p>
              </div>
              <button onClick={() => { setPreview(null); setPreviewDiff(null); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            {msg && (
              <p style={{ fontSize: 12, color: '#e0c060', marginBottom: 16, background: '#4a3a1a', padding: '8px 12px', borderRadius: 6 }}>{msg}</p>
            )}

            {previewDiff && (
              <div style={{ marginBottom: 16, background: '#2a2a2c', borderRadius: 8, padding: 12 }}>
                {previewDiff.audioChanged && (
                  <p style={{ fontSize: 12, color: '#e0c060', margin: '0 0 8px' }}>🔄 Audio file changed — every break will get the new file swapped in.</p>
                )}
                {previewDiff.added.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>+ Added ({previewDiff.added.length})</p>
                    {previewDiff.added.map((n, i) => <p key={i} style={{ fontSize: 12, color: '#ccc', margin: '2px 0' }}>{n.replace(/\.m3u8$/i, '')}</p>)}
                  </div>
                )}
                {previewDiff.removed.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 11, color: '#f87171', fontWeight: 600, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>− Removed ({previewDiff.removed.length})</p>
                    {previewDiff.removed.map((n, i) => <p key={i} style={{ fontSize: 12, color: '#ccc', margin: '2px 0' }}>{n}</p>)}
                  </div>
                )}
                {previewDiff.unchanged.length > 0 && (
                  <p style={{ fontSize: 11, color: '#888', margin: 0 }}>{previewDiff.unchanged.length} break(s) unchanged</p>
                )}
                {previewDiff.added.length === 0 && previewDiff.removed.length === 0 && (
                  <p style={{ fontSize: 12, color: '#888', margin: 0 }}>No placement changes — only campaign details were updated.</p>
                )}
              </div>
            )}

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
              <button onClick={() => { setPreview(null); setPreviewDiff(null); }} style={{ flex: 1, padding: '11px 0', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
                ← Edit
              </button>
              <button onClick={confirmSchedule} disabled={confirming}
                style={{ flex: 1, padding: '11px 0', background: '#0071e3', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: confirming ? 0.6 : 1 }}>
                {confirming ? (editingCampaignId ? 'Updating...' : 'Creating...') : (editingCampaignId ? '✓ Confirm & Update' : '✓ Confirm & Schedule')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete !== null && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 400 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: 'white', margin: '0 0 8px' }}>Delete Campaign</h2>
            <p style={{ fontSize: 14, color: '#aaa', marginBottom: 16 }}>Are you sure you want to delete this campaign?</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#2a2a2c', borderRadius: 8, marginBottom: 20, cursor: 'pointer' }}>
              <input type="checkbox" checked={deleteWithSchedules} onChange={e => setDeleteWithSchedules(e.target.checked)} style={{ accentColor: '#cc0000', width: 16, height: 16 }} />
              <div>
                <div style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500 }}>Also delete all schedules for this campaign</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Removes all matching schedule entries from the Schedules page</div>
              </div>
            </label>
            {deletingSchedules && deleteWithSchedules && (
              <div style={{ marginBottom: 16, marginTop: -8 }}>
                <p style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
                  Removing audio from every break — this can take 15-30 seconds for larger campaigns.
                </p>
                <div style={{ width: '100%', height: 6, background: '#3a3a3c', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${deleteProgress}%`, height: '100%', background: '#cc0000', borderRadius: 3, transition: 'width 0.25s ease-out' }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setConfirmDelete(null); setDeleteWithSchedules(false); }} style={{ flex: 1, padding: '11px 0', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => deleteCampaign(confirmDelete, deleteWithSchedules)} disabled={deletingSchedules}
                style={{ flex: 1, padding: '11px 0', background: '#cc0000', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: deletingSchedules ? 0.6 : 1 }}>
                {deletingSchedules ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Campaign Schedules dialog */}
      {viewSchedulesCampaign && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 660, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 500, color: 'white', margin: 0 }}>{viewSchedulesCampaign.sponsor_name} — Schedules</h2>
                <p style={{ fontSize: 13, color: '#aaa', margin: '3px 0 0' }}>
                  {viewSchedulesCampaign.audio_file_name.replace(/\.[^/.]+$/, '')} ·{' '}
                  {campaignSchedulesLoading ? 'Loading...' : `${campaignSchedules.length} schedules`}
                  {weeksRemaining(viewSchedulesCampaign) !== null && !campaignSchedulesLoading &&
                    ` · ${weeksRemaining(viewSchedulesCampaign)} weeks remaining · ~${spotsRemaining(viewSchedulesCampaign)?.toLocaleString()} spots left`}
                </p>
              </div>
              <button onClick={() => setViewSchedulesCampaign(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {campaignSchedulesLoading ? (
                <div style={{ padding: '30px 0', textAlign: 'center' }}>
                  <Loader2 style={{ width: 20, height: 20, animation: 'spin 1s linear infinite', color: '#0071e3', margin: '0 auto 8px' }} />
                  <div style={{ fontSize: 13, color: '#888' }}>Loading schedules...</div>
                </div>
              ) : campaignSchedules.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#666', fontSize: 14, padding: '30px 0' }}>No schedules found for this campaign.</p>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Break', 'Day', 'Time', 'Next Run', 'Last Run', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', fontSize: 10, color: '#888', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #4a4a4c', letterSpacing: '0.04em' }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaignSchedules.map((s, i) => (
                      <tr key={s.id} style={{ borderBottom: '0.5px solid #3a3a3c', background: i % 2 === 0 ? '#2a2a2c' : '#333335' }}>
                        <td style={{ padding: '8px 12px', color: '#e0e0e0', whiteSpace: 'nowrap' }}>{s.playlist_name.replace(/\.m3u8$/i, '')}</td>
                        <td style={{ padding: '8px 12px', color: '#aaa', whiteSpace: 'nowrap' }}>
                          {s.days_of_week ? DAYS[parseInt(s.days_of_week)] : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#aaa', whiteSpace: 'nowrap' }}>{s.time_of_day}</td>
                        <td style={{ padding: '8px 12px', color: '#888', whiteSpace: 'nowrap', fontSize: 11 }}>
                          {s.next_run_at ? new Date(s.next_run_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#888', whiteSpace: 'nowrap', fontSize: 11 }}>
                          {s.last_run_at ? new Date(s.last_run_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : 'Never'}
                        </td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '2px 7px', borderRadius: 8, fontSize: 10, fontWeight: 500, background: s.is_active ? '#1a3a25' : '#3a2a2a', color: s.is_active ? '#4caf70' : '#cc5555' }}>
                            {s.is_active ? 'Active' : 'Paused'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ marginTop: 14, flexShrink: 0 }}>
              <button onClick={() => setViewSchedulesCampaign(null)} style={{ width: '100%', padding: '11px 0', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* File Picker Dialog */}
      {showFilePicker && (
        <div style={{ ...S.overlay, zIndex: 60 }}>
          <div style={{ ...S.dialog, maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 16, fontWeight: 500, color: 'white', margin: 0 }}>Select Audio File</h2>
              <button onClick={() => setShowFilePicker(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            {/* Folder tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' as const }}>
              {AUDIO_DIRECTORIES.map((dir, i) => (
                <button key={i} onClick={() => loadPickerDirectory(i)}
                  style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: 'none', background: pickerDirectory === i ? '#1d1d1f' : '#4a4a4c', color: pickerDirectory === i ? 'white' : '#aaa', fontWeight: pickerDirectory === i ? 500 : 400 }}>
                  {dir.name}
                </button>
              ))}
            </div>
            <input
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
              placeholder="Search files..."
              style={{ ...S.input, marginBottom: 10 }}
            />
            <div style={{ flex: 1, overflowY: 'auto', border: '0.5px solid #555', borderRadius: 8 }}>
              {pickerLoading ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: '#888' }}>
                  <Loader2 style={{ width: 20, height: 20, animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                  <div style={{ fontSize: 13 }}>Loading audio files...</div>
                </div>
              ) : pickerFiles.filter(f => f.name.toLowerCase().includes(pickerSearch.toLowerCase())).length === 0 ? (
                <div style={{ padding: '30px 0', textAlign: 'center', color: '#666', fontSize: 13 }}>No files found</div>
              ) : (
                pickerFiles
                  .filter(f => f.name.toLowerCase().includes(pickerSearch.toLowerCase()))
                  .map((f, i) => (
                    <div key={f.id} onClick={() => selectFile(f)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: i % 2 === 0 ? '#3a3a3c' : '#2a2a2c', borderBottom: '0.5px solid #4a4a4c' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#0071e322')}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#3a3a3c' : '#2a2a2c')}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#4da3ff" strokeWidth="1.4"><path d="M2 2h6l3 3v7H2V2z"/><path d="M8 2v3h3"/></svg>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: '#e0e0e0' }}>{f.name.replace(/\.[^/.]+$/, '')}</div>
                        <div style={{ fontSize: 11, color: '#666' }}>{f.dir}</div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

