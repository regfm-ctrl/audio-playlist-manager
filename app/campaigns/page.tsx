'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getGoogleAccessToken } from '@/lib/client-google-token';
import { BUSINESS_CATEGORIES } from '@/lib/business-categories';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type AudioFileRef = { id: string; name: string; dir: string; localPath: string; expiresAt?: string | null };

type Campaign = {
  id: number;
  sponsor_name: string;
  business_category: string | null;
  booking_reference: string | null;
  booking_details: string | null;
  randomize_weekly: boolean;
  go_live_time: string | null;
  expiry_time: string | null;
  audio_file_name: string;
  audio_file_id: string | null;
  audio_directory_name: string | null;
  audio_local_path: string;
  audio_files: AudioFileRef[] | string | null;
  spots_per_week: number;
  distribution_type: string;
  per_day_counts: string | Record<number, number> | null;
  allowed_days: string | null;
  allowed_breaks: string | null;
  time_from: string | null;
  time_to: string | null;
  position: number;
  position_type: string | null;
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
const IconAudit = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l5.5 2.5v4c0 3.5-2.3 5.9-5.5 7-3.2-1.1-5.5-3.5-5.5-7v-4z"/><path d="M6 8l1.5 1.5L10.5 6.5"/></svg>;
const IconRebalance = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h7M8 3l2 2-2 2"/><path d="M13 11H6M8 13l-2-2 2-2"/></svg>;

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignFilter, setCampaignFilter] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [expiryEditorFileId, setExpiryEditorFileId] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState({ date: '', time: '23:59' });
  const [reshufflingId, setReshufflingId] = useState<number | null>(null);

  async function reshuffleNow(campaign: Campaign) {
    setReshufflingId(campaign.id);
    setMsg('');
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/reshuffle-now`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMsg(`✅ ${data.detail}`);
        loadCampaigns();
      } else {
        setMsg(`❌ ${data.error || 'Reshuffle failed'}`);
      }
    } finally {
      setReshufflingId(null);
    }
  }
  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<PreviewSlot[] | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<any>(null);
  const [previewDiff, setPreviewDiff] = useState<{ added: string[]; removed: string[]; unchanged: string[]; audioChanged: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleteWithSchedules, setDeleteWithSchedules] = useState(true);
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
    audio_files: [] as AudioFileRef[],
    spots_per_week: 10,
    distribution_type: 'even',
    per_day_counts: { 0: 0, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 0 } as Record<number, number>,
    allowed_days: [1, 2, 3, 4, 5] as number[],
    time_from: '06:00',
    time_to: '18:00',
    allowed_breaks: [] as string[],
    position: -1,
    position_type: 'middle',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    use_specific_breaks: false,
    randomize_weekly: false,
    go_live_time: '06:00',
    expiry_time: '22:00',
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
    { name: 'IDs - Test Update', driveId: '1cy56CgC1KtxCgZI-kGOEWTTNuC5rjzh_', localPath: 'T:\\REGFM - RadioBOSS\\Traffic System\\IDs\\{filename}' },
    { name: 'CSAs - Audio', driveId: '14Oy00clKujI6ldWv7NW35DybZVBN_MPm', localPath: 'T:\\REGFM - RadioBOSS\\Traffic System\\CSAs\\{filename}' },
    { name: 'Promos - Audio', driveId: '1PzkL-eDZVPU-g3D7c5IUY93g14-SV3l6', localPath: 'T:\\REGFM - RadioBOSS\\Traffic System\\Promos\\{filename}' },
    { name: 'Sponsors - Audio', driveId: '1B_LOIo2jl_-P-1UrWoRZ4W688_lk0NQC', localPath: 'T:\\REGFM - RadioBOSS\\Traffic System\\Sponsors\\{filename}' },
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

  function toggleFile(file: AudioFileRef) {
    setForm(f => {
      const exists = f.audio_files.some(a => a.id === file.id);
      const audio_files = exists ? f.audio_files.filter(a => a.id !== file.id) : [...f.audio_files, file];
      // Keep the legacy singular fields in sync with the first file, for
      // the older parts of the system (and campaigns table display) that
      // still read them directly.
      const first = audio_files[0];
      return {
        ...f,
        audio_files,
        audio_file_id: first?.id ?? '',
        audio_file_name: first?.name ?? '',
        audio_directory_name: first?.dir ?? '',
        audio_local_path: first?.localPath ?? '',
      };
    });
  }

  function removeFile(fileId: string) {
    setForm(f => {
      const audio_files = f.audio_files.filter(a => a.id !== fileId);
      const first = audio_files[0];
      return {
        ...f,
        audio_files,
        audio_file_id: first?.id ?? '',
        audio_file_name: first?.name ?? '',
        audio_directory_name: first?.dir ?? '',
        audio_local_path: first?.localPath ?? '',
      };
    });
  }

  // Converts a stored UTC ISO timestamp back into Melbourne-local date/time
  // parts for editing — the reverse of the conversion the backend does
  // when saving.
  function isoToMelbourneParts(iso: string): { date: string; time: string } {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return { date, time };
  }

  function openExpiryEditor(file: AudioFileRef) {
    setExpiryEditorFileId(file.id);
    setExpiryDraft(file.expiresAt ? isoToMelbourneParts(file.expiresAt) : { date: '', time: '23:59' });
  }

  function saveExpiryDraft(fileId: string) {
    if (!expiryDraft.date) return;
    // Sent as a plain Melbourne-local string — the backend converts it to
    // a proper UTC timestamp on save, same pattern as go_live_time/
    // expiry_time at the campaign level.
    const expiresAt = `${expiryDraft.date}T${expiryDraft.time}`;
    setForm(f => ({
      ...f,
      audio_files: f.audio_files.map(a => a.id === fileId ? { ...a, expiresAt } : a),
    }));
    setExpiryEditorFileId(null);
  }

  function clearFileExpiry(fileId: string) {
    setForm(f => ({
      ...f,
      audio_files: f.audio_files.map(a => a.id === fileId ? { ...a, expiresAt: null } : a),
    }));
    setExpiryEditorFileId(null);
  }

  useEffect(() => { loadCampaigns(); }, []);
  useEffect(() => {
    const token = document.cookie.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
    if (token) {
      try { setIsAdmin(JSON.parse(atob(token.split('.')[1])).role === 'admin'); } catch {}
    }
  }, []);

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
    if (form.audio_files.length === 0) { setMsg('Please select at least one audio file'); return; }

    if (playlists.length === 0) { setMsg('Loading breaks...'); await loadPlaylists(); }

    // Zero out any day's spot count that isn't actually in Allowed Days —
    // catches stale data too (e.g. a campaign that had this mismatch from
    // before this fix existed), not just new edits, since this normalizes
    // right before every submission regardless of how the form got here.
    const normalizedPerDayCounts = Object.fromEntries(
      Object.entries(form.per_day_counts).map(([day, count]) => [day, form.allowed_days.includes(Number(day)) ? count : 0])
    );

    const campaign = {
      ...form,
      id: editingCampaignId ?? undefined,
      allowed_days: form.allowed_days.join(','),
      allowed_breaks: form.use_specific_breaks && form.allowed_breaks.length > 0
        ? form.allowed_breaks.join(',')
        : null,
      per_day_counts: form.distribution_type === 'per_day' ? normalizedPerDayCounts : null,
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

    let audioFiles: AudioFileRef[] = [];
    if (campaign.audio_files) {
      try {
        const parsed = typeof campaign.audio_files === 'string' ? JSON.parse(campaign.audio_files) : campaign.audio_files;
        if (Array.isArray(parsed) && parsed.length > 0) audioFiles = parsed;
      } catch {}
    }
    if (audioFiles.length === 0 && campaign.audio_local_path) {
      // Legacy campaign, created before multi-file support existed
      audioFiles = [{ id: campaign.audio_file_id || '', name: campaign.audio_file_name, dir: campaign.audio_directory_name || '', localPath: campaign.audio_local_path }];
    }

    setForm({
      sponsor_name: campaign.sponsor_name,
      business_category: campaign.business_category || '',
      booking_reference: campaign.booking_reference || '',
      booking_details: campaign.booking_details || '',
      audio_file_name: campaign.audio_file_name,
      audio_file_id: campaign.audio_file_id || '',
      audio_directory_name: campaign.audio_directory_name || '',
      audio_local_path: campaign.audio_local_path,
      audio_files: audioFiles,
      spots_per_week: campaign.spots_per_week,
      distribution_type: campaign.distribution_type,
      per_day_counts: perDayCounts,
      allowed_days: campaign.allowed_days ? campaign.allowed_days.split(',').map(Number) : [1, 2, 3, 4, 5],
      time_from: campaign.time_from || '06:00',
      time_to: campaign.time_to || '18:00',
      allowed_breaks: allowedBreaks,
      position: campaign.position,
      position_type: campaign.position_type || 'middle',
      start_date: campaign.start_date.split('T')[0],
      end_date: campaign.end_date ? campaign.end_date.split('T')[0] : '',
      use_specific_breaks: allowedBreaks.length > 0,
      randomize_weekly: !!campaign.randomize_weekly,
      go_live_time: campaign.go_live_time || '06:00',
      expiry_time: campaign.expiry_time || '22:00',
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
      setDeleteWithSchedules(true);
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
        // Filter by campaign_id, not audio_file_name — a round-robin
        // campaign has schedules using many different files, only one of
        // which happens to match the legacy single "first file" field.
        const matching = all.filter((s: any) => s.campaign_id === campaign.id);
        setCampaignSchedules(matching);
      }
    } finally {
      setCampaignSchedulesLoading(false);
    }
  }

  // For "per day" distribution, spots_per_week is a stale field that
  // doesn't track the real total — the actual count is the sum of the
  // per-day targets, same as what the generate/reshuffle logic actually
  // uses.
  function effectiveSpotsPerWeek(campaign: Campaign): number {
    if (campaign.distribution_type === 'per_day' && campaign.per_day_counts) {
      let counts: Record<string, number> = {};
      try {
        counts = typeof campaign.per_day_counts === 'string' ? JSON.parse(campaign.per_day_counts) : campaign.per_day_counts;
      } catch {}
      return Object.values(counts).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0);
    }
    return campaign.spots_per_week;
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
    return weeks * effectiveSpotsPerWeek(campaign);
  }

  const [confirmPause, setConfirmPause] = useState<Campaign | null>(null);
  const [pauseRemoveSchedules, setPauseRemoveSchedules] = useState(false);
  const [pausingCampaign, setPausingCampaign] = useState(false);

  async function toggleStatus(campaign: Campaign) {
    if (campaign.status === 'active') {
      // Pausing — offer the "also remove from playlists" choice rather
      // than firing instantly, since that choice has a real, on-air
      // consequence worth a moment's thought.
      setConfirmPause(campaign);
      setPauseRemoveSchedules(false);
      return;
    }
    // Resuming — no destructive consequence either way, stays instant.
    await fetch('/api/campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: campaign.id, status: 'active' }),
    });
    loadCampaigns();
  }

  async function confirmPauseAction() {
    if (!confirmPause) return;
    setPausingCampaign(true);
    try {
      await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: confirmPause.id, status: 'paused', removeSchedules: pauseRemoveSchedules }),
      });
      setConfirmPause(null);
      loadCampaigns();
    } finally {
      setPausingCampaign(false);
    }
  }

  const filteredPlaylists = playlists.filter(p =>
    p.name.toLowerCase().includes(breakSearch.toLowerCase())
  );

  const filteredCampaigns = campaigns.filter(c => {
    const q = campaignFilter.toLowerCase();
    if (!q) return true;
    return (
      c.sponsor_name.toLowerCase().includes(q) ||
      c.audio_file_name.toLowerCase().includes(q) ||
      (c.business_category || '').toLowerCase().includes(q) ||
      (c.booking_reference || '').toLowerCase().includes(q) ||
      c.distribution_type.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q)
    );
  });

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
<a href="/rebalance" style={S.navItem}><IconRebalance /> Rebalance</a>
          {isAdmin && <a href="/admin" style={S.navItem}><IconAdmin /> Admin</a>}
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
          <input
            value={campaignFilter}
            onChange={e => setCampaignFilter(e.target.value)}
            placeholder="Filter campaigns..."
            style={{ padding: '7px 12px', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 13, background: 'white', outline: 'none', width: 200 }}
          />
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
        <div style={{ flex: 1, overflow: 'hidden', padding: '12px 20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...S.card, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginBottom: 0, flex: 1 }}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #eee', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>All Campaigns</span>
              <span style={{ background: '#e8e8ed', color: '#666', borderRadius: 10, padding: '1px 8px', fontSize: 12 }}>{filteredCampaigns.length}</span>
            </div>
            {loading ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: '#0071e3', margin: '0 auto 8px' }} />
              </div>
            ) : campaigns.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#aaa', fontSize: 14 }}>
                No campaigns yet. Click "+ New Campaign" to get started.
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#aaa', fontSize: 14 }}>
                No campaigns match "{campaignFilter}".
              </div>
            ) : (
              <div style={{ overflow: 'auto', flex: 1 }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: '#f9f9f9' }}>
                      {['Sponsor', 'Spots/Week', 'Distribution', 'Days', 'Times', 'Start', 'End', 'Weeks Left', 'Spots Left', 'Status', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', fontSize: 11, color: '#888', fontWeight: 500, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '0.5px solid #eee' }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCampaigns.map((c, i) => {
                      const rowBg = c.status === 'expired' ? '#fdf6ea' : c.status === 'paused' ? '#f2f2f3' : (i % 2 === 1 ? '#f7f8fa' : 'white');
                      return (
                      <tr key={c.id} style={{ borderBottom: '0.5px solid #f0f0f0', background: rowBg }}>
                        <td style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {c.sponsor_name}
                          {c.business_category && <div style={{ fontSize: 10, color: '#888', fontWeight: 400, marginTop: 1 }}>{c.business_category}</div>}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>{effectiveSpotsPerWeek(c)}</td>
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
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                            background: c.status === 'active' ? '#d4f1dc' : c.status === 'expired' ? '#fbe3c0' : '#e2e2e4',
                            color: c.status === 'active' ? '#1a7a35' : c.status === 'expired' ? '#946200' : '#555',
                          }}>
                            {c.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => toggleStatus(c)} style={{ fontSize: 12, color: '#0071e3', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                              {c.status === 'active' ? 'Pause' : 'Resume'}
                            </button>
                            <button onClick={() => editCampaign(c)} style={{ fontSize: 12, color: '#a06000', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Edit</button>
                            <span style={{ width: 68, flexShrink: 0 }}>
                              {c.randomize_weekly && (() => {
                                let fileCount = 1;
                                try {
                                  const parsed = typeof c.audio_files === 'string' ? JSON.parse(c.audio_files) : c.audio_files;
                                  if (Array.isArray(parsed)) fileCount = parsed.length;
                                } catch {}
                                if (fileCount <= 1) return null;
                                return (
                                  <button onClick={() => reshuffleNow(c)} disabled={reshufflingId === c.id} style={{ fontSize: 12, color: '#8a3ec9', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: reshufflingId === c.id ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                                    {reshufflingId === c.id ? 'Reshuffling...' : 'Reshuffle'}
                                  </button>
                                );
                              })()}
                            </span>
                            <a href={`/api/campaigns/${c.id}/broadcast-schedule`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#5b8def', textDecoration: 'none' }}>Export PDF</a>
                            <button onClick={() => viewCampaignSchedules(c)} style={{ fontSize: 12, color: '#0a6e46', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Schedules</button>
                            <button onClick={() => { setConfirmDelete(c.id); setDeleteWithSchedules(true); }} style={{ fontSize: 12, color: '#cc0000', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
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

      {/* Campaign Form */}
      {showForm && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 700, maxHeight: '90vh', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="dialog-scroll" style={{ overflowY: 'auto', padding: 24 }}>
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
                <label style={{ ...S.label, color: '#ddd' }}>
                  Audio File{form.audio_files.length > 1 ? 's' : ''}
                  {form.audio_files.length > 1 && <span style={{ fontWeight: 400, color: '#888' }}> — rotates round-robin between breaks</span>}
                </label>
                {form.audio_files.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {form.audio_files.map(file => {
                      const editing = expiryEditorFileId === file.id;
                      const expired = file.expiresAt && new Date(file.expiresAt) <= new Date();
                      return (
                        <div key={file.id} style={{ padding: '8px 12px', background: '#0071e322', border: '0.5px solid #0071e344', borderRadius: 7 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, color: '#4da3ff', fontWeight: 500 }}>{file.name.replace(/\.[^/.]+$/, '')}</div>
                              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{file.localPath}</div>
                              {file.expiresAt && (
                                <div style={{ fontSize: 11, color: expired ? '#cc4444' : '#a06000', marginTop: 3 }}>
                                  {expired ? 'Expired' : 'Expires'} {new Date(file.expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'short', timeStyle: 'short' })}
                                </div>
                              )}
                            </div>
                            <button onClick={() => openExpiryEditor(file)} style={{ padding: '4px 10px', background: file.expiresAt ? '#a0600033' : '#4a4a4c', border: '0.5px solid #666', borderRadius: 5, color: file.expiresAt ? '#e0a030' : '#ddd', fontSize: 12, cursor: 'pointer' }}>
                              {file.expiresAt ? 'Edit Expiry' : 'Set Expiry'}
                            </button>
                            <button onClick={() => removeFile(file.id)} style={{ padding: '4px 10px', background: '#4a4a4c', border: '0.5px solid #666', borderRadius: 5, color: '#ddd', fontSize: 12, cursor: 'pointer' }}>Remove</button>
                          </div>
                          {editing && (
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '0.5px solid #0071e344' }}>
                              <div style={{ flex: 1 }}>
                                <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 3 }}>Expiry date</label>
                                <input type="date" value={expiryDraft.date} onChange={e => setExpiryDraft(d => ({ ...d, date: e.target.value }))}
                                  style={{ width: '100%', padding: '6px 10px', border: '0.5px solid #666', borderRadius: 6, fontSize: 12, background: '#4a4a4c', color: 'white', colorScheme: 'dark', boxSizing: 'border-box' as const }} />
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 3 }}>Time</label>
                                <input type="time" value={expiryDraft.time} onChange={e => setExpiryDraft(d => ({ ...d, time: e.target.value }))}
                                  style={{ padding: '6px 10px', border: '0.5px solid #666', borderRadius: 6, fontSize: 12, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }} />
                              </div>
                              <button onClick={() => saveExpiryDraft(file.id)} style={{ padding: '6px 12px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Save</button>
                              {file.expiresAt && <button onClick={() => clearFileExpiry(file.id)} style={{ padding: '6px 12px', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Clear</button>}
                              <button onClick={() => setExpiryEditorFileId(null)} style={{ padding: '6px 12px', background: 'none', color: '#888', border: 'none', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button onClick={openFilePicker} style={{ padding: '7px 0', background: '#4a4a4c', border: '0.5px dashed #666', borderRadius: 7, color: '#aaa', fontSize: 12, cursor: 'pointer' }}>
                      + Add another file
                    </button>
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
                <select value={form.position_type} onChange={e => setForm(f => ({ ...f, position_type: e.target.value }))} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }}>
                  <option value="first">First in Break</option>
                  <option value="middle">Middle of Break</option>
                  <option value="second_last">Second Last in Break</option>
                  <option value="last">Last in Break</option>
                </select>
                <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  Actively enforced — whenever anything else is added to or removed from a shared break, this campaign's spot stays correctly positioned relative to everyone else, not just at the moment it was first placed.
                </p>
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
                    {DAYS.map((day, i) => {
                      const dayAllowed = form.allowed_days.includes(i);
                      return (
                        <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: dayAllowed ? '#aaa' : '#555', marginBottom: 4 }}>{day}</div>
                          <input type="number" min={0} max={20} value={dayAllowed ? (form.per_day_counts[i] || 0) : 0}
                            disabled={!dayAllowed}
                            onChange={e => setForm(f => ({ ...f, per_day_counts: { ...f.per_day_counts, [i]: parseInt(e.target.value) || 0 } }))}
                            style={{ ...S.input, textAlign: 'center', padding: '6px 4px', opacity: dayAllowed ? 1 : 0.4, cursor: dayAllowed ? 'text' : 'not-allowed' }} />
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Greyed-out days are disabled in "Allowed Days" below and can't have spots.</p>
                </div>
              )}

              {/* Allowed days */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...S.label, color: '#ddd' }}>Allowed Days</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DAYS.map((day, i) => (
                    <button key={i} onClick={() => setForm(f => {
                      const nowAllowed = !f.allowed_days.includes(i);
                      const allowed_days = nowAllowed ? [...f.allowed_days, i] : f.allowed_days.filter(d => d !== i);
                      // A day that's no longer allowed can never actually get
                      // its spots filled — zero it out here so "Spots Per
                      // Day" can't silently drift out of sync with what's
                      // actually achievable (which is exactly what causes a
                      // campaign to permanently fall short of its target).
                      const per_day_counts = nowAllowed ? f.per_day_counts : { ...f.per_day_counts, [i]: 0 };
                      return { ...f, allowed_days, per_day_counts };
                    })}
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
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Go-Live Time</label>
                <input type="time" value={form.go_live_time} onChange={e => setForm(f => ({ ...f, go_live_time: e.target.value }))} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }} />
                <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>When the campaign actually goes live in Drive on the Start Date — separate from Time From/To above, which just controls which breaks are eligible.</p>
              </div>
              <div>
                <label style={{ ...S.label, color: '#ddd' }}>Expiry Time</label>
                <input type="time" value={form.expiry_time} onChange={e => setForm(f => ({ ...f, expiry_time: e.target.value }))} style={{ ...S.input, background: '#4a4a4c', color: 'white', colorScheme: 'dark' }} />
                <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>When the campaign is actually removed on the End Date.</p>
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
                    <div className="dialog-scroll" style={{ border: '0.5px solid #555', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
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
        </div>
      )}

      {/* Preview Dialog */}
      {preview && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 600, maxHeight: '90vh', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="dialog-scroll" style={{ overflowY: 'auto', padding: 24 }}>
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

            <div className="dialog-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20, maxHeight: 400, overflowY: 'auto' }}>
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
        </div>
      )}

      {/* Delete confirm */}
      {confirmPause !== null && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 420 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: 'white', margin: '0 0 8px' }}>Pause Campaign</h2>
            <p style={{ fontSize: 14, color: '#aaa', marginBottom: 16 }}>Pause "{confirmPause.sponsor_name}"?</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#2a2a2c', borderRadius: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={pauseRemoveSchedules} onChange={e => setPauseRemoveSchedules(e.target.checked)} style={{ accentColor: '#0071e3', width: 16, height: 16 }} />
              <div>
                <div style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500 }}>Also remove from playlists right now</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Pulls the audio off air immediately, rather than just stopping future management</div>
              </div>
            </label>
            {pauseRemoveSchedules ? (
              <div style={{ padding: '10px 14px', background: '#4a2020', border: '0.5px solid #a02020', borderRadius: 8, marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: '#ff8080', margin: 0, fontWeight: 500 }}>⚠ This removes the campaign's audio from every break in Google Drive right now. The campaign itself stays, and you can resume it later — but its old placements are gone, so it'll need fresh spots picked (via Edit or Reshuffle) before it plays again.</p>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 20px' }}>
                Without this checked, pausing is administrative only — the campaign's audio keeps playing on air exactly as it is, just without future reshuffles or expiry handling while paused.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmPause(null)} style={{ flex: 1, padding: '11px 0', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmPauseAction} disabled={pausingCampaign}
                style={{ flex: 1, padding: '11px 0', background: '#0071e3', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: pausingCampaign ? 0.6 : 1 }}>
                {pausingCampaign ? 'Pausing...' : 'Pause'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete !== null && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 420 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: 'white', margin: '0 0 8px' }}>Delete Campaign</h2>
            <p style={{ fontSize: 14, color: '#aaa', marginBottom: 16 }}>Are you sure you want to delete this campaign?</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#2a2a2c', borderRadius: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={deleteWithSchedules} onChange={e => setDeleteWithSchedules(e.target.checked)} style={{ accentColor: '#cc0000', width: 16, height: 16 }} />
              <div>
                <div style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500 }}>Also delete all schedules for this campaign</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Removes all matching schedule entries from the Schedules page</div>
              </div>
            </label>
            {deleteWithSchedules ? (
              <div style={{ padding: '10px 14px', background: '#4a2020', border: '0.5px solid #a02020', borderRadius: 8, marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: '#ff8080', margin: 0, fontWeight: 500 }}>⚠ This permanently removes this campaign's actual audio from every break in Google Drive, not just a database record — it will stop playing on air immediately. This cannot be undone.</p>
              </div>
            ) : (
              <div style={{ padding: '10px 14px', background: '#4a3a1a', border: '0.5px solid #a06000', borderRadius: 8, marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: '#e0a030', margin: 0, fontWeight: 500 }}>⚠ Leaving this unchecked deletes the campaign but leaves its schedules and audio still live — they'll keep playing on air indefinitely with nothing left to ever end them, since the campaign that owned them is gone.</p>
              </div>
            )}
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
              <button onClick={() => { setConfirmDelete(null); setDeleteWithSchedules(true); }} style={{ flex: 1, padding: '11px 0', background: '#4a4a4c', color: '#ddd', border: '0.5px solid #666', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
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
          <div style={{ ...S.dialog, maxWidth: 660, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
            <div className="dialog-scroll" style={{ flex: 1, overflowY: 'auto' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ fontSize: 16, fontWeight: 500, color: 'white', margin: 0 }}>Select Audio Files</h2>
              <button onClick={() => setShowFilePicker(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 14px' }}>
              Pick one or more — with several, the scheduler rotates between them round-robin as it fills breaks.
            </p>
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
            <div className="dialog-scroll" style={{ flex: 1, overflowY: 'auto', border: '0.5px solid #555', borderRadius: 8 }}>
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
                  .map((f, i) => {
                    const checked = form.audio_files.some(a => a.id === f.id)
                    return (
                      <div key={f.id} onClick={() => toggleFile(f)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: checked ? '#0071e322' : (i % 2 === 0 ? '#3a3a3c' : '#2a2a2c'), borderBottom: '0.5px solid #4a4a4c' }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleFile(f)} onClick={e => e.stopPropagation()} style={{ accentColor: '#0071e3', width: 15, height: 15, flexShrink: 0 }} />
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#4da3ff" strokeWidth="1.4"><path d="M2 2h6l3 3v7H2V2z"/><path d="M8 2v3h3"/></svg>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: '#e0e0e0' }}>{f.name.replace(/\.[^/.]+$/, '')}</div>
                          <div style={{ fontSize: 11, color: '#666' }}>{f.dir}</div>
                        </div>
                      </div>
                    )
                  })
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <span style={{ fontSize: 12, color: '#888' }}>{form.audio_files.length} selected</span>
              <button onClick={() => { setShowFilePicker(false); setPickerSearch(''); }}
                style={{ padding: '8px 20px', background: '#0071e3', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

