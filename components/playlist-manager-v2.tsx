"use client"

import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import {
  googleDriveService,
  type GoogleDriveFile,
  type AudioDirectory,
  PLAYLIST_FOLDER_ID,
  DEFAULT_AUDIO_DIRECTORIES,
} from "@/lib/google-drive"
import { ErrorBoundary } from "@/components/error-boundary"
import { useToast } from "@/hooks/use-toast"
import { Loader2, AlertCircle, RefreshCw, Play, Square, Clock, X, AlarmClock, FileText } from "lucide-react"

interface PlaylistManagerProps {
  accessToken: string
  onAuthError?: () => void
}

// ─── Sidebar icon components ────────────────────────────────────────────────
const IconBreaks = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <rect x="2" y="3" width="5" height="10" rx="1"/>
    <rect x="9" y="3" width="5" height="10" rx="1"/>
  </svg>
)
const IconSchedule = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="5.5"/>
    <path d="M8 4.5v3.5l2 1.5"/>
  </svg>
)
const IconAdmin = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="5" r="2.5"/>
    <path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/>
  </svg>
)
const IconSearch = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="5" cy="5" r="3.5"/>
    <line x1="7.8" y1="7.8" x2="10.5" y2="10.5"/>
  </svg>
)
const IconGrip = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
    <circle cx="3" cy="3" r="1"/><circle cx="7" cy="3" r="1"/>
    <circle cx="3" cy="7" r="1"/><circle cx="7" cy="7" r="1"/>
  </svg>
)

export function PlaylistManager({ accessToken, onAuthError }: PlaylistManagerProps) {
  const { toast } = useToast()

  // ─── Core state ─────────────────────────────────────────────────────────
  const [playlists, setPlaylists] = useState<GoogleDriveFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState<GoogleDriveFile | null>(null)
  const [playlistSearch, setPlaylistSearch] = useState("")
  const [audioDirectories] = useState<AudioDirectory[]>(DEFAULT_AUDIO_DIRECTORIES)
  const [selectedDirectoryName, setSelectedDirectoryName] = useState<string>(DEFAULT_AUDIO_DIRECTORIES[0]?.name || "")
  const [directoryFiles, setDirectoryFiles] = useState<Record<string, GoogleDriveFile[]>>({})
  const [dirLoading, setDirLoading] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState("")
  const [originalContent, setOriginalContent] = useState<string>("#EXTM3U\n")
  const [playlistItems, setPlaylistItems] = useState<{ path: string; filename: string }[]>([])
  const [containerName, setContainerName] = useState<string>("")
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ─── Audio player ────────────────────────────────────────────────────────
  const [playingFileId, setPlayingFileId] = useState<string | null>(null)
  const [isLoadingAudio, setIsLoadingAudio] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioBlobUrl = useRef<string | null>(null)

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = "" }
    if (audioBlobUrl.current) { URL.revokeObjectURL(audioBlobUrl.current); audioBlobUrl.current = null }
    setPlayingFileId(null)
  }

  const playFile = async (file: { id: string; name: string }) => {
    if (playingFileId === file.id) { stopAudio(); return }
    stopAudio()
    setIsLoadingAudio(file.id)
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error("Failed to load audio")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      audioBlobUrl.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setPlayingFileId(null)
      await audio.play()
      setPlayingFileId(file.id)
    } catch {
      toast({ title: "Playback failed", description: "Could not load audio file.", variant: "destructive" })
    } finally {
      setIsLoadingAudio(null)
    }
  }

  // ─── Duration ────────────────────────────────────────────────────────────
  const [playlistDurations, setPlaylistDurations] = useState<Record<string, number>>({})
  const [durationLoading, setDurationLoading] = useState<string | null>(null)

  useEffect(() => {
    if (Object.keys(playlistDurations).length > 0) {
      try { sessionStorage.setItem('playlistDurations', JSON.stringify(playlistDurations)) } catch {}
    }
  }, [playlistDurations])

  const formatDuration = (seconds: number): string => {
    if (!seconds) return ''
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  const measureAudioDuration = (url: string): Promise<number> => new Promise((resolve) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    const timeout = setTimeout(() => resolve(0), 10000)
    audio.onloadedmetadata = () => { clearTimeout(timeout); const d = audio.duration; resolve(typeof d === 'number' && !isNaN(d) && isFinite(d) && d > 0 ? d : 0) }
    audio.onerror = () => { clearTimeout(timeout); resolve(0) }
    audio.src = url
  })

  const calculatePlaylistDuration = async (playlistId: string, items: { path: string; filename: string }[]) => {
    if (items.length === 0) return
    setDurationLoading(playlistId)
    try {
      let allFiles = Object.values(directoryFiles).flat()
      if (allFiles.length === 0) {
        const loadedFiles: typeof allFiles = []
        for (const dir of audioDirectories) {
          if (!dir.driveId) continue
          try { const files = await googleDriveService.listFiles(dir.driveId); loadedFiles.push(...files) } catch {}
        }
        allFiles = loadedFiles
      }
      const fileMatches: { file_id: string; file_name: string }[] = []
      for (const item of items) {
        const baseName = item.filename.toLowerCase().replace(/\.[^/.]+$/, '')
        const match = allFiles.find(f => f.name.toLowerCase().replace(/\.[^/.]+$/, '') === baseName)
        if (match) fileMatches.push({ file_id: match.id, file_name: match.name })
      }
      if (fileMatches.length === 0) { setDurationLoading(null); return }
      const ids = fileMatches.map(f => f.file_id).join(',')
      const cacheRes = await fetch(`/api/durations?ids=${ids}`)
      const cached: { file_id: string; duration_seconds: number }[] = cacheRes.ok ? await cacheRes.json() : []
      const cachedMap = Object.fromEntries(cached.map(c => [c.file_id, c.duration_seconds]))
      const uncached = fileMatches.filter(f => cachedMap[f.file_id] === undefined)
      const newDurations: { file_id: string; file_name: string; duration_seconds: number }[] = []
      for (const file of uncached) {
        try {
          const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.file_id}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } })
          if (!response.ok) continue
          const blob = await response.blob()
          const objectUrl = URL.createObjectURL(blob)
          const duration = await measureAudioDuration(objectUrl)
          URL.revokeObjectURL(objectUrl)
          if (typeof duration === 'number' && !isNaN(duration) && isFinite(duration) && duration > 0) {
            newDurations.push({ file_id: file.file_id, file_name: file.file_name, duration_seconds: duration })
            cachedMap[file.file_id] = duration
          }
        } catch {}
      }
      if (newDurations.length > 0) {
        await fetch('/api/durations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durations: newDurations }) })
      }
      const total = fileMatches.reduce((sum, f) => { const d = cachedMap[f.file_id]; return sum + (typeof d === 'number' && !isNaN(d) && d > 0 ? d : 0) }, 0)
      if (total > 0) setPlaylistDurations(prev => ({ ...prev, [playlistId]: total }))
    } catch {} finally { setDurationLoading(null) }
  }

  // ─── Schedule dialog ─────────────────────────────────────────────────────
  const [scheduleFile, setScheduleFile] = useState<{ id: string; name: string; directoryName: string; localPath: string } | null>(null)
  const [scheduleForm, setScheduleForm] = useState({ selected_playlists: [] as { id: string; name: string }[], position: '-1', schedule_type: 'recurring', days_of_week: [] as number[], specific_dates: '', time_of_day: '08:00' })
  const [playlistSearchSchedule, setPlaylistSearchSchedule] = useState('')
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleMsg, setScheduleMsg] = useState('')

  async function saveSchedule() {
    if (!scheduleFile) return
    if (scheduleForm.selected_playlists.length === 0) { setScheduleMsg('Please select at least one playlist'); return }
    if (scheduleForm.schedule_type === 'recurring' && scheduleForm.days_of_week.length === 0) { setScheduleMsg('Please select at least one day'); return }
    if (scheduleForm.schedule_type === 'once' && !scheduleForm.specific_dates) { setScheduleMsg('Please enter a date'); return }
    setScheduleSaving(true); setScheduleMsg('')
    try {
      let saved = 0
      for (const pl of scheduleForm.selected_playlists) {
        const res = await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio_file_id: scheduleFile.id, audio_file_name: scheduleFile.name, audio_directory_name: scheduleFile.directoryName, audio_local_path: scheduleFile.localPath, playlist_id: pl.id, playlist_name: pl.name, position: parseInt(scheduleForm.position), schedule_type: scheduleForm.schedule_type, days_of_week: scheduleForm.days_of_week.join(',') || null, specific_dates: scheduleForm.specific_dates || null, time_of_day: scheduleForm.time_of_day, expires_at: null }) })
        if (res.ok) saved++
      }
      setScheduleMsg(`✅ ${saved} schedule${saved > 1 ? 's' : ''} saved!`)
      setTimeout(() => { setScheduleFile(null); setScheduleMsg(''); setPlaylistSearchSchedule('') }, 1500)
    } finally { setScheduleSaving(false) }
  }

  // ─── Expiry dialog ───────────────────────────────────────────────────────
  const [expiryFile, setExpiryFile] = useState<{ id: string; name: string; directoryName: string; localPath: string } | null>(null)
  const [expiryForm, setExpiryForm] = useState({ expires_at: '', expires_time: '23:59' })
  const [expirySaving, setExpirySaving] = useState(false)
  const [expiryMsg, setExpiryMsg] = useState('')

  async function saveExpiryOnly() {
    if (!expiryFile) return
    if (!expiryForm.expires_at) { setExpiryMsg('Please set an expiry date'); return }
    setExpirySaving(true); setExpiryMsg('')
    try {
      const res = await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio_file_id: expiryFile.id, audio_file_name: expiryFile.name, audio_directory_name: expiryFile.directoryName, audio_local_path: expiryFile.localPath, playlist_id: 'all', playlist_name: 'All playlists', position: -1, schedule_type: 'expiry_only', days_of_week: null, specific_dates: null, time_of_day: '00:00', expires_at: `${expiryForm.expires_at}T${expiryForm.expires_time}:00` }) })
      if (res.ok) { setExpiryMsg('✅ Expiry set!'); setTimeout(() => { setExpiryFile(null); setExpiryMsg('') }, 1500) }
      else setExpiryMsg('❌ Failed to set expiry')
    } finally { setExpirySaving(false) }
  }

  // ─── Remove from all playlists ───────────────────────────────────────────
  const [removeAllFile, setRemoveAllFile] = useState<{ id: string; name: string; localPath: string } | null>(null)
  const [removeAllLoading, setRemoveAllLoading] = useState(false)
  const [removeAllMsg, setRemoveAllMsg] = useState('')
  const [removeAllProgress, setRemoveAllProgress] = useState({ scanned: 0, total: 0, phase: '' })

  async function removeFromAllPlaylists() {
    if (!removeAllFile) return
    setRemoveAllLoading(true); setRemoveAllMsg(''); setRemoveAllProgress({ scanned: 0, total: 0, phase: 'scanning' })
    try {
      const tokenKey = Object.keys(localStorage).find(k => k.includes('access_token') || k.includes('google'))
      const token = tokenKey ? localStorage.getItem(tokenKey) : accessToken
      if (!token) { setRemoveAllMsg('❌ Google Drive not connected'); return }
      const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
      if (!listRes.ok) { setRemoveAllMsg('❌ Failed to list playlists'); return }
      const { files } = await listRes.json()
      const pathToRemove = removeAllFile.localPath
      const BATCH = 25
      setRemoveAllProgress({ scanned: 0, total: files.length, phase: 'scanning' })
      const toUpdate: { id: string; name: string; containerName: string; updatedPaths: string[] }[] = []
      const quickCheck = pathToRemove.split('\\').pop() || pathToRemove.split('/').pop() || pathToRemove
      for (let i = 0; i < files.length; i += BATCH) {
        await Promise.all(files.slice(i, i + BATCH).map(async (pl: { id: string; name: string }) => {
          try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${pl.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
            if (!res.ok) return
            const text = await res.text()
            if (!text.includes(quickCheck)) return
            let containerName = ''; let paths: string[] = []
            for (const line of text.split('\n').filter((l: string) => l.trim())) {
              if (line.startsWith('Container=')) { const match = line.match(/Container=<([^>]+)>(.+)/); if (match) { containerName = decodeURIComponent(match[1].replace(/\+/g, ' ')); paths = match[2].split('|').filter((p: string) => p.trim()) } }
            }
            if (!paths.includes(pathToRemove)) return
            toUpdate.push({ id: pl.id, name: pl.name, containerName, updatedPaths: paths.filter((p: string) => p !== pathToRemove) })
          } catch {}
        }))
        setRemoveAllProgress(prev => ({ ...prev, scanned: Math.min(i + BATCH, files.length) }))
      }
      if (toUpdate.length === 0) { setRemoveAllMsg('✅ File not found in any playlists'); setTimeout(() => { setRemoveAllFile(null); setRemoveAllMsg('') }, 2000); return }
      setRemoveAllProgress({ scanned: 0, total: toUpdate.length, phase: 'removing' })
      let saved = 0
      for (let i = 0; i < toUpdate.length; i += BATCH) {
        await Promise.all(toUpdate.slice(i, i + BATCH).map(async (pl) => {
          try {
            const encodedName = encodeURIComponent(pl.containerName || 'Not predefined').replace(/%20/g, '+')
            const newContent = pl.updatedPaths.length > 0 ? `#EXTM3U\nContainer=<${encodedName}>${pl.updatedPaths.join('|')}\n` : `#EXTM3U\n`
            const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${pl.id}?uploadType=media&supportsAllDrives=true`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: newContent })
            if (res.ok) saved++
          } catch {}
        }))
        setRemoveAllProgress(prev => ({ ...prev, scanned: Math.min(i + BATCH, toUpdate.length) }))
      }
      setRemoveAllMsg(`✅ Removed from ${saved} playlist${saved !== 1 ? 's' : ''}`)
      setTimeout(() => { setRemoveAllFile(null); setRemoveAllMsg('') }, 2000)
    } catch { setRemoveAllMsg('❌ Failed to remove from playlists') } finally { setRemoveAllLoading(false) }
  }

  // ─── Find in playlists ───────────────────────────────────────────────────
  const [inPlaylistsFile, setInPlaylistsFile] = useState<{ name: string; localPath: string } | null>(null)
  const [inPlaylistsList, setInPlaylistsList] = useState<string[]>([])
  const [inPlaylistsLoading, setInPlaylistsLoading] = useState(false)
  const [inPlaylistsProgress, setInPlaylistsProgress] = useState({ scanned: 0, total: 0 })

  async function findFileInPlaylists(file: { name: string; localPath: string }) {
    setInPlaylistsFile(file); setInPlaylistsList([]); setInPlaylistsLoading(true); setInPlaylistsProgress({ scanned: 0, total: 0 })
    try {
      const tokenKey = Object.keys(localStorage).find(k => k.includes('access_token') || k.includes('google'))
      const token = tokenKey ? localStorage.getItem(tokenKey) : accessToken
      if (!token) { setInPlaylistsLoading(false); return }
      const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
      if (!listRes.ok) { setInPlaylistsLoading(false); return }
      const { files } = await listRes.json()
      setInPlaylistsProgress({ scanned: 0, total: files.length })
      const found: string[] = []
      const BATCH = 25
      let scanned = 0
      const quickCheck = file.localPath.split('\\').pop() || file.localPath.split('/').pop() || file.localPath
      for (let i = 0; i < files.length; i += BATCH) {
        await Promise.all(files.slice(i, i + BATCH).map(async (pl: { id: string; name: string }) => {
          try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${pl.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
            if (!res.ok) return
            const text = await res.text()
            if (!text.includes(quickCheck)) return
            if (text.includes(file.localPath)) found.push(pl.name.replace(/\.m3u8$/i, ''))
          } catch {}
        }))
        scanned = Math.min(i + BATCH, files.length)
        setInPlaylistsProgress({ scanned, total: files.length })
        setInPlaylistsList([...found])
      }
    } finally { setInPlaylistsLoading(false) }
  }

  // ─── Data loading ────────────────────────────────────────────────────────
  const removeFileExtension = (filename: string) => filename.replace(/\.[^/.]+$/, "")
  const isAudioFile = (filename: string) => ['.wav', '.mp3'].some(ext => filename.toLowerCase().endsWith(ext))

  useEffect(() => { loadInitialData() }, [accessToken])

  useEffect(() => {
    if (!accessToken) return
    const checkSession = () => {
      try {
        const sessionInfo = googleDriveService.getSessionInfo()
        if (sessionInfo && sessionInfo.timeUntilExpiry < 24 * 60 * 60 * 1000 && !sessionInfo.isExpired) googleDriveService.checkSessionValidity()
      } catch {}
    }
    checkSession()
    const interval = setInterval(checkSession, 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [accessToken])

  const loadInitialData = async () => {
    setIsLoading(true); setError(null)
    try {
      if (!PLAYLIST_FOLDER_ID) { setError("Playlist folder not configured."); return }
      googleDriveService.setAccessToken(accessToken)
      const playlistFiles = await googleDriveService.listFiles(PLAYLIST_FOLDER_ID)
      const m3u8Files = playlistFiles.filter((file) => file.name.endsWith(".m3u8"))
      setPlaylists(m3u8Files)
      try { const cached = sessionStorage.getItem('playlistDurations'); if (cached) setPlaylistDurations(JSON.parse(cached)) } catch {}
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load playlists"
      if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) { if (onAuthError) onAuthError(); return }
      setError(errorMessage)
    } finally { setIsLoading(false) }
  }

  const filteredPlaylists = useMemo(() => {
    let filtered = playlists
    if (playlistSearch) filtered = playlists.filter((pl) => pl.name.toLowerCase().includes(playlistSearch.toLowerCase()))
    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [playlists, playlistSearch])

  const parsePlaylistContent = (content: string) => {
    const lines = content.split("\n").filter((l) => l.trim())
    const items: { path: string; filename: string }[] = []
    let name = ""
    for (const line of lines) {
      if (line.startsWith("#EXTM3U")) continue
      if (line.startsWith("Container=")) {
        const match = line.match(/Container=<([^>]+)>(.+)/)
        if (match) {
          name = decodeURIComponent(match[1].replace(/\+/g, " "))
          match[2].split("|").forEach((p) => { if (p.trim()) { const fullFilename = p.split("\\").pop() || p.split("/").pop() || p; items.push({ path: p.trim(), filename: removeFileExtension(fullFilename) }) } })
        }
      }
    }
    setContainerName(name); setPlaylistItems(items)
  }

  const generatePlaylistContent = (): string => {
    if (playlistItems.length === 0) return "#EXTM3U\n"
    const paths = playlistItems.map((i) => i.path).join("|")
    const encodedName = encodeURIComponent(containerName || "Not predefined").replace(/%20/g, "+")
    return `#EXTM3U\nContainer=<${encodedName}>${paths}\n`
  }

  useEffect(() => {
    const load = async () => {
      if (!selectedPlaylist) { setOriginalContent("#EXTM3U\n"); setPlaylistItems([]); setContainerName(""); return }
      try {
        setIsPlaylistLoading(true)
        const content = await googleDriveService.getFileContent(selectedPlaylist.id)
        setOriginalContent(content); parsePlaylistContent(content)
        setTimeout(() => {
          const parsedItems: { path: string; filename: string }[] = []
          for (const line of content.split("\n").filter(l => l.trim())) {
            if (line.startsWith("Container=")) { const match = line.match(/Container=<([^>]+)>(.+)/); if (match) match[2].split("|").forEach(p => { if (p.trim()) { const fullFilename = p.split("\\").pop() || p.split("/").pop() || p; parsedItems.push({ path: p.trim(), filename: fullFilename.replace(/\.[^/.]+$/, "") }) } }) }
          }
          if (parsedItems.length > 0 && selectedPlaylist) calculatePlaylistDuration(selectedPlaylist.id, parsedItems)
        }, 100)
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Failed to load"
        if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) { if (onAuthError) onAuthError(); return }
      } finally { setIsPlaylistLoading(false) }
    }
    load()
  }, [selectedPlaylist])

  const selectedDirectory = useMemo(() => audioDirectories.find((d) => d.name === selectedDirectoryName), [audioDirectories, selectedDirectoryName])

  const loadDirectoryFiles = async (directory: AudioDirectory) => {
    if (!directory.driveId) return
    setDirLoading((prev) => ({ ...prev, [directory.name]: true }))
    try {
      const files = await googleDriveService.listFiles(directory.driveId)
      setDirectoryFiles((prev) => ({ ...prev, [directory.name]: files }))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : ""
      if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) { if (onAuthError) onAuthError() }
    } finally { setDirLoading((prev) => ({ ...prev, [directory.name]: false })) }
  }

  useEffect(() => { audioDirectories.forEach((d) => { if (d.driveId && !directoryFiles[d.name]) loadDirectoryFiles(d) }) }, [audioDirectories])

  const filteredFiles = useMemo(() => {
    const files = selectedDirectory ? directoryFiles[selectedDirectory.name] || [] : []
    const audioFiles = files.filter((f) => isAudioFile(f.name))
    let filtered = audioFiles
    if (search) filtered = audioFiles.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [directoryFiles, search, selectedDirectory])

  const buildPathForFile = (file: GoogleDriveFile, directory?: AudioDirectory): string => {
    if (directory) return directory.localPath.replace("{audio_filename}", file.name)
    return `T:\\My Drive\\Audio\\${file.name}`
  }

  const isInPlaylist = (file: GoogleDriveFile): boolean => playlistItems.some((it) => it.path === buildPathForFile(file, selectedDirectory))

  const addFileToPlaylist = (file: GoogleDriveFile) => {
    if (!selectedPlaylist) { toast({ title: "Select a playlist", description: "Please select a sponsorship break first.", variant: "error" as any }); return }
    const p = buildPathForFile(file, selectedDirectory)
    if (playlistItems.some((it) => it.path === p)) return
    setPlaylistItems((prev) => [...prev, { path: p, filename: removeFileExtension(file.name) }])
  }

  const removeFileFromPlaylist = (file: GoogleDriveFile) => {
    const p = buildPathForFile(file, selectedDirectory)
    setPlaylistItems((prev) => prev.filter((it) => it.path !== p))
  }

  const savePlaylist = async () => {
    if (!selectedPlaylist) return
    setIsSaving(true); setSaveError(null)
    try {
      const content = generatePlaylistContent()
      await googleDriveService.updateFile(selectedPlaylist.id, content)
      setOriginalContent(content)
      toast({ title: "Saved", description: `${selectedPlaylist.name.replace(/\.m3u8$/i, "")} updated successfully.`, variant: "success" as any })
    } catch (e: any) {
      const errorMessage = e?.message || "Failed to save"
      if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) { if (onAuthError) onAuthError(); return }
      setSaveError(errorMessage)
    } finally { setIsSaving(false) }
  }

  const resetPlaylist = () => parsePlaylistContent(originalContent)

  // ─── Drag and drop ───────────────────────────────────────────────────────
  const [dragState, setDragState] = useState({ isDragging: false, draggedIndex: null as number | null, hoveredDropZone: null as number | null })
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => { e.dataTransfer.setData('text/plain', index.toString()); e.dataTransfer.effectAllowed = 'move'; setDragState({ isDragging: true, draggedIndex: index, hoveredDropZone: null }) }, [])
  const handleDragEnd = useCallback(() => setDragState({ isDragging: false, draggedIndex: null, hoveredDropZone: null }), [])
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }, [])
  const handleDropZoneEnter = useCallback((dropIndex: number) => setDragState(prev => ({ ...prev, hoveredDropZone: dropIndex })), [])
  const handleDropZoneLeave = useCallback(() => setDragState(prev => ({ ...prev, hoveredDropZone: null })), [])
  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'))
    if (dragIndex === dropIndex) return
    setPlaylistItems(prev => { const newItems = [...prev]; const draggedItem = newItems[dragIndex]; newItems.splice(dragIndex, 1); newItems.splice(dropIndex, 0, draggedItem); return newItems })
    setDragState({ isDragging: false, draggedIndex: null, hoveredDropZone: null })
  }, [])

  // ─── Loading / error screens ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#1d1d1f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 style={{ width: 32, height: 32, animation: 'spin 1s linear infinite', color: '#0071e3', margin: '0 auto 12px' }} />
          <p style={{ color: '#888', fontSize: 16 }}>Loading your playlists...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#1d1d1f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: '#2a2a2c', borderRadius: 12, padding: 24, maxWidth: 400, width: '100%' }}>
          <AlertCircle style={{ width: 32, height: 32, color: '#ff453a', margin: '0 auto 12px', display: 'block' }} />
          <p style={{ color: '#e0e0e0', fontSize: 17, textAlign: 'center', marginBottom: 16 }}>{error}</p>
          <button onClick={() => loadInitialData()} style={{ width: '100%', padding: '8px 0', background: '#0071e3', color: 'white', border: 'none', borderRadius: 8, fontSize: 18, cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  const S: Record<string, React.CSSProperties> = {
    // Layout
    app: { display: 'flex', height: '100vh', background: '#1d1d1f', fontFamily: 'var(--font-sans)', overflow: 'hidden' },
    sidebar: { width: 260, background: '#1d1d1f', borderRight: '0.5px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0 },
    main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f7', overflow: 'hidden' },
    // Sidebar elements
    sidebarHeader: { padding: '18px 16px 12px', borderBottom: '0.5px solid #333' },
    sidebarLogo: { width: 40, height: 40, borderRadius: 10, background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    sidebarSection: { padding: '12px 10px 6px' },
    sidebarLabel: { fontSize: 15, color: '#555', padding: '0 8px', marginBottom: 4, letterSpacing: '0.05em', display: 'block' },
    navItemActive: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#0071e3', borderRadius: 6, marginBottom: 2, color: 'white', cursor: 'pointer', fontSize: 15 },
    navItem: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 6, marginBottom: 2, color: '#888', cursor: 'pointer', fontSize: 15, textDecoration: 'none' },
    // Main toolbar
    toolbar: { padding: '12px 20px', background: '#e8e8ed', borderBottom: '0.5px solid #ccc', display: 'flex', alignItems: 'center', gap: 10 },
    searchBox: { flex: 1, background: 'white', borderRadius: 7, border: '0.5px solid #ccc', padding: '5px 10px', fontSize: 15, color: '#333', display: 'flex', alignItems: 'center', gap: 6 },
    dirBtn: { padding: '6px 14px', borderRadius: 7, fontSize: 15, cursor: 'pointer', border: 'none', whiteSpace: 'nowrap' as const },
    // Column header
    colHeader: { padding: '6px 20px', background: '#e8e8ed', borderBottom: '0.5px solid #ddd', display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, color: '#888', letterSpacing: '0.04em' },
    // File rows
    fileRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '0px 10px', height: 36, borderRadius: 7, marginBottom: 2, border: '0.5px solid #e8e8e8', background: 'white', transition: 'background 0.1s', boxSizing: 'border-box' as const },
    fileRowPlaying: { display: 'flex', alignItems: 'center', gap: 12, padding: '0px 10px', height: 36, borderRadius: 7, marginBottom: 2, border: '0.5px solid #b8d0f0', background: '#e8f0fb', boxSizing: 'border-box' as const },
    playBtn: { width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', border: 'none' },
    iconBtn: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', border: '0.5px solid #e8e8e8', background: 'white' },
    addBtn: { width: 66, height: 22, background: '#0071e3', borderRadius: 4, fontSize: 11, color: 'white', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    removeBtn: { width: 66, height: 22, background: '#e8e8ed', borderRadius: 4, fontSize: 11, color: '#444', border: '0.5px solid #ccc', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    // Bottom break content
    breakPanel: { borderTop: '0.5px solid #bbb', background: '#eef2f7', padding: '12px 20px', flexShrink: 0, minHeight: 200, maxHeight: 350, display: 'flex', flexDirection: 'column' },
    breakChip: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', background: '#f5f5f7', borderRadius: 5, border: '0.5px solid #e0e0e0', flexShrink: 0 },
    // Dialog overlay
    overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
    dialog: { background: '#3a3a3c', borderRadius: 14, width: '100%' },
  }

  return (
    <ErrorBoundary>
      <div style={S.app}>

        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <div style={S.sidebar}>
          {/* Logo */}
          <div style={S.sidebarHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={S.sidebarLogo}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5" fill="white" stroke="none"/>
                </svg>
              </div>
              <div>
                <div style={{ color: 'white', fontSize: 15, fontWeight: 500 }}>REGFM</div>
                <div style={{ color: '#666', fontSize: 10 }}>Sponsorship Scheduler</div>
              </div>
            </div>
          </div>

          {/* Nav */}
          <div style={S.sidebarSection}>
            <span style={S.sidebarLabel}>LIBRARY</span>
            <div style={S.navItemActive}><IconBreaks /> Sponsorship Breaks</div>
          </div>
          <div style={{ padding: '6px 10px' }}>
            <a href="/schedules" style={{ ...S.navItem, textDecoration: 'none' }}><IconSchedule /> Schedules</a>
            <a href="/admin" style={{ ...S.navItem, textDecoration: 'none' }}><IconAdmin /> Admin</a>
          </div>

          {/* Breaks list */}
          <div style={{ padding: '12px 10px 6px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginTop: 4 }}>
            <span style={S.sidebarLabel}>BREAKS <span style={{ color: '#444' }}>({filteredPlaylists.length})</span></span>
            <div style={{ background: '#2a2a2c', borderRadius: 6, padding: '7px 10px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#555' }}><IconSearch /></span>
              <input
                value={playlistSearch}
                onChange={e => setPlaylistSearch(e.target.value)}
                placeholder="Search..."
                style={{ background: 'none', border: 'none', outline: 'none', color: '#aaa', fontSize: 17, width: '100%' }}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => setSelectedPlaylist(pl)}
                  style={{
                    padding: '8px 12px',
                    marginBottom: 1,
                    borderRadius: 5,
                    cursor: 'pointer',
                    background: selectedPlaylist?.id === pl.id ? '#2a2a2c' : 'transparent',
                    borderLeft: selectedPlaylist?.id === pl.id ? '2px solid #0071e3' : '2px solid transparent',
                  }}
                >
                  <div style={{ color: selectedPlaylist?.id === pl.id ? '#e0e0e0' : '#888', fontSize: 17, fontWeight: selectedPlaylist?.id === pl.id ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {removeFileExtension(pl.name)}
                  </div>
                  <div style={{ fontSize: 15, color: durationLoading === pl.id ? '#0071e3' : '#555', marginTop: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                    {durationLoading === pl.id ? (
                      <><Loader2 style={{ width: 8, height: 8, animation: 'spin 1s linear infinite' }} /> Calculating...</>
                    ) : playlistDurations[pl.id] ? formatDuration(playlistDurations[pl.id]) : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* User */}
          <div style={{ padding: '10px 14px', borderTop: '0.5px solid #333', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, color: 'white', fontWeight: 500 }}>A</div>
            <span style={{ color: '#666', fontSize: 14 }}>admin</span>
          </div>
        </div>

        {/* ── Main content ───────────────────────────────────────────── */}
        <div style={S.main}>

          {/* Toolbar */}
          <div style={S.toolbar}>
            <div style={S.searchBox}>
              <span style={{ color: '#bbb', flexShrink: 0 }}><IconSearch /></span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search audio files..."
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 15, color: '#333', width: '100%' }}
              />
            </div>
            {audioDirectories.map(d => (
              <button
                key={d.name}
                onClick={() => setSelectedDirectoryName(d.name)}
                style={{ ...S.dirBtn, background: selectedDirectoryName === d.name ? '#1d1d1f' : 'white', color: selectedDirectoryName === d.name ? 'white' : '#444', border: selectedDirectoryName === d.name ? 'none' : '0.5px solid #ccc' }}
              >
                {d.name}
              </button>
            ))}
          </div>

          {/* Column headers */}
          <div style={S.colHeader}>
            <div style={{ width: 22 }}></div>
            <span style={{ flex: 1 }}>NAME</span>
            <span style={{ width: 160, textAlign: 'right' }}>ACTIONS</span>
          </div>

          {/* File list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {dirLoading[selectedDirectoryName] ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: '#0071e3', margin: '0 auto 8px' }} />
                <p style={{ color: '#888', fontSize: 15 }}>Loading audio files...</p>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#aaa', fontSize: 15 }}>No audio files found</div>
            ) : filteredFiles.map((file) => {
              const isPlaying = playingFileId === file.id
              const isLoadingThis = isLoadingAudio === file.id
              const inPlaylist = isInPlaylist(file)
              return (
                <div key={file.id} style={isPlaying ? S.fileRowPlaying : S.fileRow}>
                  {/* Play button */}
                  <button
                    onClick={() => playFile(file)}
                    disabled={!!isLoadingAudio && !isPlaying}
                    style={{ ...S.playBtn, background: isPlaying ? '#0071e3' : '#e8e8ed', color: isPlaying ? 'white' : '#666' }}
                  >
                    {isLoadingThis ? <Loader2 style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> : isPlaying ? <Square style={{ width: 8, height: 8 }} /> : <Play style={{ width: 8, height: 8 }} />}
                  </button>

                  {/* Name + progress bar if playing */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: isPlaying ? '#0071e3' : '#1d1d1f', fontWeight: isPlaying ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {removeFileExtension(file.name)}
                    </div>
                    {isPlaying && <div style={{ height: 2, background: '#b8d0f0', borderRadius: 1, marginTop: 3 }}><div style={{ width: '38%', height: 2, background: '#0071e3', borderRadius: 1 }}></div></div>}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                    {/* Schedule */}
                    <button
                      title="Schedule"
                      onClick={() => { setScheduleFile({ id: file.id, name: file.name, directoryName: selectedDirectory?.name || '', localPath: buildPathForFile(file, selectedDirectory) }); setScheduleForm({ selected_playlists: selectedPlaylist ? [{ id: selectedPlaylist.id, name: selectedPlaylist.name }] : [], position: '-1', schedule_type: 'recurring', days_of_week: [], specific_dates: '', time_of_day: '08:00' }); setPlaylistSearchSchedule('') }}
                      style={{ ...S.iconBtn, border: '0.5px solid #e0e0e0' }}
                    >
                      <Clock style={{ width: 10, height: 10, color: '#aaa' }} />
                    </button>
                    {/* Expiry */}
                    <button
                      title="Set expiry"
                      onClick={() => { setExpiryFile({ id: file.id, name: file.name, directoryName: selectedDirectory?.name || '', localPath: buildPathForFile(file, selectedDirectory) }); setExpiryForm({ expires_at: '', expires_time: '23:59' }) }}
                      style={{ ...S.iconBtn, border: '0.5px solid #e0e0e0' }}
                    >
                      <AlarmClock style={{ width: 10, height: 10, color: '#aaa' }} />
                    </button>
                    {/* Find in playlists */}
                    <button
                      title="Find in playlists"
                      onClick={() => findFileInPlaylists({ name: file.name, localPath: buildPathForFile(file, selectedDirectory) })}
                      style={{ ...S.iconBtn, border: '0.5px solid #e0e0e0' }}
                    >
                      <FileText style={{ width: 10, height: 10, color: '#88aadd' }} />
                    </button>
                    {/* Remove from all */}
                    <button
                      title="Remove from all playlists"
                      onClick={() => setRemoveAllFile({ id: file.id, name: file.name, localPath: buildPathForFile(file, selectedDirectory) })}
                      style={{ ...S.iconBtn, background: '#fff0f0', border: '0.5px solid #ffcccc' }}
                    >
                      <X style={{ width: 10, height: 10, color: '#cc3333' }} />
                    </button>
                    {/* Add / Remove */}
                    {inPlaylist
                      ? <button onClick={() => removeFileFromPlaylist(file)} style={S.removeBtn}>Remove</button>
                      : <button onClick={() => addFileToPlaylist(file)} style={S.addBtn}>Add</button>
                    }
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Break content panel ────────────────────────────────── */}
          <div style={S.breakPanel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: '#2a3a4a' }}>
                  {selectedPlaylist ? removeFileExtension(selectedPlaylist.name) : 'Sponsorship Break Content'}
                </span>
                {playlistItems.length > 0 && (
                  <span style={{ fontSize: 17, color: '#0071e3', background: '#e8f0fb', padding: '2px 8px', borderRadius: 10 }}>
                    {playlistItems.length} track{playlistItems.length !== 1 ? 's' : ''}
                    {selectedPlaylist && playlistDurations[selectedPlaylist.id] ? ` · ${formatDuration(playlistDurations[selectedPlaylist.id])}` : ''}
                  </span>
                )}
                {saveError && <span style={{ fontSize: 17, color: '#cc0000' }}>{saveError}</span>}
              </div>
              {selectedPlaylist && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={resetPlaylist} style={{ padding: '6px 14px', background: 'white', borderRadius: 6, fontSize: 15, color: '#555', border: '0.5px solid #c0c8d4', cursor: 'pointer' }}>Reset</button>
                  <button onClick={savePlaylist} disabled={isSaving} style={{ padding: '6px 16px', background: '#0071e3', borderRadius: 6, fontSize: 15, color: 'white', border: 'none', cursor: 'pointer', opacity: isSaving ? 0.6 : 1 }}>
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {isPlaylistLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', color: '#888', fontSize: 14 }}>
                <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> Loading break content...
              </div>
            ) : !selectedPlaylist ? (
              <p style={{ fontSize: 17, color: '#aaa' }}>Select a sponsorship break to view its content</p>
            ) : playlistItems.length === 0 ? (
              <p style={{ fontSize: 15, color: '#aaa' }}>No tracks in this break yet — add some from the list above</p>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, background: 'white', borderRadius: 8, border: '0.5px solid #d0d8e4', padding: '4px 0' }}>
                {playlistItems.map((item, index) => (
                  <div
                    key={index}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => { e.preventDefault(); handleDropZoneEnter(index) }}
                    onDragLeave={handleDropZoneLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '0px 10px', height: 36, margin: '1px 4px', borderRadius: 6, boxSizing: 'border-box' as const,
                      background: dragState.hoveredDropZone === index && dragState.draggedIndex !== index
                        ? '#e8f0fb'
                        : dragState.draggedIndex === index
                        ? '#f0f0f0'
                        : 'white',
                      opacity: dragState.draggedIndex === index ? 0.5 : 1,
                      border: dragState.hoveredDropZone === index && dragState.draggedIndex !== index
                        ? '0.5px solid #0071e3'
                        : '0.5px solid #eee',
                      cursor: 'grab', transition: 'background 0.1s, border 0.1s',
                      userSelect: 'none' as const,
                    }}
                  >
                    {/* Number */}
                    <span style={{ fontSize: 12, color: '#0071e3', fontWeight: 600, width: 22, textAlign: 'right' as const, flexShrink: 0 }}>{index + 1}</span>
                    {/* Grip */}
                    <span style={{ color: '#bbb', flexShrink: 0, display: 'flex', alignItems: 'center' }}><IconGrip /></span>
                    {/* Filename */}
                    <span style={{ fontSize: 14, color: '#1d1d1f', flex: 1, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.filename}</span>
                    {/* Up / Down */}
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); if (index === 0) return; setPlaylistItems(prev => { const n = [...prev]; [n[index-1], n[index]] = [n[index], n[index-1]]; return n }) }}
                        disabled={index === 0}
                        style={{ width: 22, height: 22, border: '0.5px solid #ddd', borderRadius: 4, background: 'white', cursor: index === 0 ? 'default' : 'pointer', color: index === 0 ? '#ddd' : '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, padding: 0 }}
                      >▲</button>
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); if (index === playlistItems.length - 1) return; setPlaylistItems(prev => { const n = [...prev]; [n[index], n[index+1]] = [n[index+1], n[index]]; return n }) }}
                        disabled={index === playlistItems.length - 1}
                        style={{ width: 22, height: 22, border: '0.5px solid #ddd', borderRadius: 4, background: 'white', cursor: index === playlistItems.length - 1 ? 'default' : 'pointer', color: index === playlistItems.length - 1 ? '#ddd' : '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, padding: 0 }}
                      >▼</button>
                    </div>
                    {/* Remove */}
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setPlaylistItems(prev => prev.filter((_, i) => i !== index)) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#ccc', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                    >
                      <X style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Schedule Dialog ──────────────────────────────────────────────── */}
      {scheduleFile && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 740, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0, color: 'white' }}>Schedule: {removeFileExtension(scheduleFile.name)}</h2>
                <p style={{ fontSize: 14, color: '#aaa', margin: '2px 0 0' }}>Select one or more breaks to add this file on a schedule</p>
              </div>
              <button onClick={() => setScheduleFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 0 }}><X style={{ width: 18, height: 18 }} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Left: playlist selector */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 15, fontWeight: 500, color: '#333' }}>
                    Sponsorship Breaks {scheduleForm.selected_playlists.length > 0 && <span style={{ background: '#0071e3', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: 17, marginLeft: 4 }}>{scheduleForm.selected_playlists.length}</span>}
                  </label>
                  {scheduleForm.selected_playlists.length > 0 && <button onClick={() => setScheduleForm(f => ({ ...f, selected_playlists: [] }))} style={{ fontSize: 13, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>}
                </div>
                <input
                  value={playlistSearchSchedule}
                  onChange={e => setPlaylistSearchSchedule(e.target.value)}
                  placeholder="Search breaks..."
                  style={{ width: '100%', padding: '8px 12px', border: '0.5px solid #555', borderRadius: 7, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' as const, outline: 'none', background: '#4a4a4c', color: '#e0e0e0' }}
                />
                <div style={{ border: '0.5px solid #555', borderRadius: 8, overflowY: 'auto', maxHeight: 320 }}>
                  {playlists.filter(p => p.name.toLowerCase().includes(playlistSearchSchedule.toLowerCase())).map(p => {
                    const isSelected = scheduleForm.selected_playlists.some(s => s.id === p.id)
                    return (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', cursor: 'pointer', background: isSelected ? '#0071e333' : '#2a2a2c', borderBottom: '0.5px solid #3a3a3c', fontSize: 14 }}>
                        <input type="checkbox" checked={isSelected} onChange={() => setScheduleForm(f => ({ ...f, selected_playlists: isSelected ? f.selected_playlists.filter(s => s.id !== p.id) : [...f.selected_playlists, { id: p.id, name: p.name }] }))} />
                        <span style={{ color: isSelected ? '#4da3ff' : '#aaa', fontWeight: isSelected ? 500 : 400 }}>{removeFileExtension(p.name)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              {/* Right: schedule options */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#ccc', display: 'block', marginBottom: 4 }}>Position</label>
                  <select value={scheduleForm.position} onChange={e => setScheduleForm(f => ({ ...f, position: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '0.5px solid #555', borderRadius: 7, fontSize: 14, background: '#4a4a4c', color: '#e0e0e0' }}>
                    <option value="-1">Add to end</option>
                    <option value="0">Add at beginning</option>
                    {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={String(n)}>After position {n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#ccc', display: 'block', marginBottom: 4 }}>Schedule type</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['recurring', 'once'] as const).map(t => (
                      <button key={t} onClick={() => setScheduleForm(f => ({ ...f, schedule_type: t }))} style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 15, cursor: 'pointer', border: '0.5px solid #ddd', background: scheduleForm.schedule_type === t ? '#0071e3' : '#3a3a3c', color: scheduleForm.schedule_type === t ? 'white' : '#aaa', border: '0.5px solid #555' }}>
                        {t === 'recurring' ? '🔁 Recurring' : '1️⃣ One-time'}
                      </button>
                    ))}
                  </div>
                </div>
                {scheduleForm.schedule_type === 'recurring' && (
                  <div>
                    <label style={{ fontSize: 14, fontWeight: 500, color: '#ccc', display: 'block', marginBottom: 4 }}>Days</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['Su','Mo','Tu','We','Th','Fr','Sa'].map((day, idx) => (
                        <button key={day} onClick={() => setScheduleForm(f => ({ ...f, days_of_week: f.days_of_week.includes(idx) ? f.days_of_week.filter(d => d !== idx) : [...f.days_of_week, idx] }))} style={{ flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 17, cursor: 'pointer', border: 'none', background: scheduleForm.days_of_week.includes(idx) ? '#0071e3' : '#3a3a3c', color: scheduleForm.days_of_week.includes(idx) ? 'white' : '#aaa', border: '0.5px solid #555' }}>
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {scheduleForm.schedule_type === 'once' && (
                  <div>
                    <label style={{ fontSize: 14, fontWeight: 500, color: '#ccc', display: 'block', marginBottom: 4 }}>Date</label>
                    <input type="date" value={scheduleForm.specific_dates} onChange={e => setScheduleForm(f => ({ ...f, specific_dates: e.target.value }))} min={new Date().toISOString().split('T')[0]} style={{ width: '100%', padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: 7, fontSize: 15, boxSizing: 'border-box' as const }} />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#ccc', display: 'block', marginBottom: 4 }}>Time</label>
                  <input type="time" value={scheduleForm.time_of_day} onChange={e => setScheduleForm(f => ({ ...f, time_of_day: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '0.5px solid #ddd', borderRadius: 7, fontSize: 15, boxSizing: 'border-box' as const }} />
                </div>
              </div>
            </div>
            {scheduleMsg && <p style={{ textAlign: 'center', fontSize: 18, margin: '12px 0 0' }}>{scheduleMsg}</p>}
            <button onClick={saveSchedule} disabled={scheduleSaving} style={{ width: '100%', marginTop: 16, padding: '10px 0', background: '#0071e3', color: 'white', border: 'none', borderRadius: 8, fontSize: 18, cursor: 'pointer', opacity: scheduleSaving ? 0.6 : 1 }}>
              {scheduleSaving ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>
        </div>
      )}

      {/* ── Expiry Dialog ────────────────────────────────────────────────── */}
      {expiryFile && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 400, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Set Expiry</h2>
                <p style={{ fontSize: 15, color: '#888', margin: '2px 0 0' }}>{removeFileExtension(expiryFile.name)}</p>
              </div>
              <button onClick={() => setExpiryFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 0 }}><X style={{ width: 18, height: 18 }} /></button>
            </div>
            <p style={{ fontSize: 15, color: '#888', marginBottom: 14 }}>This file will be automatically removed from all playlists after this date.</p>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <input type="date" value={expiryForm.expires_at} onChange={e => setExpiryForm(f => ({ ...f, expires_at: e.target.value }))} min={new Date().toISOString().split('T')[0]} style={{ flex: 1, padding: '9px 12px', border: '0.5px solid #ddd', borderRadius: 7, fontSize: 15, boxSizing: 'border-box' as const }} />
              <input type="time" value={expiryForm.expires_time} onChange={e => setExpiryForm(f => ({ ...f, expires_time: e.target.value }))} disabled={!expiryForm.expires_at} style={{ width: 110, padding: '9px 12px', border: '0.5px solid #ddd', borderRadius: 7, fontSize: 15 }} />
            </div>
            {expiryMsg && <p style={{ textAlign: 'center', fontSize: 18, marginBottom: 10 }}>{expiryMsg}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setExpiryFile(null)} style={{ flex: 1, padding: '9px 0', background: 'white', border: '0.5px solid #ddd', borderRadius: 8, fontSize: 18, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveExpiryOnly} disabled={expirySaving} style={{ flex: 1, padding: '9px 0', background: '#e55', color: 'white', border: 'none', borderRadius: 8, fontSize: 18, cursor: 'pointer', opacity: expirySaving ? 0.6 : 1 }}>
                {expirySaving ? 'Saving...' : 'Set Expiry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove from all dialog ───────────────────────────────────────── */}
      {removeAllFile && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 380, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 500, color: '#cc0000', margin: 0 }}>Remove from All Playlists</h2>
              <button onClick={() => setRemoveAllFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 0 }}><X style={{ width: 18, height: 18 }} /></button>
            </div>
            {!removeAllLoading && !removeAllMsg ? (
              <>
                <p style={{ fontSize: 18, color: '#444', marginBottom: 6 }}>Remove <strong>{removeFileExtension(removeAllFile.name)}</strong> from all sponsorship breaks?</p>
                <p style={{ fontSize: 15, color: '#aaa', marginBottom: 20 }}>This will scan every break and remove this file wherever it appears. This cannot be undone.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setRemoveAllFile(null)} style={{ flex: 1, padding: '9px 0', background: 'white', border: '0.5px solid #ddd', borderRadius: 8, fontSize: 18, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={removeFromAllPlaylists} style={{ flex: 1, padding: '9px 0', background: '#cc0000', color: 'white', border: 'none', borderRadius: 8, fontSize: 18, cursor: 'pointer' }}>Yes, Remove</button>
                </div>
              </>
            ) : removeAllMsg ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <p style={{ fontSize: 17, marginBottom: 16 }}>{removeAllMsg}</p>
                <button onClick={() => { setRemoveAllFile(null); setRemoveAllMsg('') }} style={{ padding: '8px 24px', background: 'white', border: '0.5px solid #ddd', borderRadius: 8, fontSize: 18, cursor: 'pointer' }}>Close</button>
              </div>
            ) : (
              <div style={{ padding: '8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: '#666', marginBottom: 6 }}>
                  <span style={{color:'#aaa'}}>{removeAllProgress.phase === 'scanning' ? 'Scanning breaks...' : 'Removing...'}</span>
                  <span style={{ fontWeight: 500, color: '#ccc' }}>{removeAllProgress.scanned} / {removeAllProgress.total}</span>
                </div>
                <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: 6, borderRadius: 3, background: removeAllProgress.phase === 'scanning' ? '#0071e3' : '#cc0000', width: removeAllProgress.total > 0 ? `${(removeAllProgress.scanned / removeAllProgress.total) * 100}%` : '0%', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Find in playlists dialog ─────────────────────────────────────── */}
      {inPlaylistsFile && (
        <div style={S.overlay}>
          <div style={{ ...S.dialog, maxWidth: 440, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{removeFileExtension(inPlaylistsFile.name)}</h2>
                <p style={{ fontSize: 15, color: '#888', margin: '2px 0 0' }}>Sponsorship breaks containing this file</p>
              </div>
              <button onClick={() => { setInPlaylistsFile(null); setInPlaylistsList([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 0 }}><X style={{ width: 18, height: 18 }} /></button>
            </div>
            {inPlaylistsLoading ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: '#666', marginBottom: 6 }}>
                  <span style={{color:'#aaa'}}>Scanning sponsorship breaks...</span>
                  <span style={{ fontWeight: 500, color: '#ccc' }}>{inPlaylistsProgress.scanned} / {inPlaylistsProgress.total}</span>
                </div>
                <div style={{ height: 6, background: '#444', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                  <div style={{ height: 6, borderRadius: 3, background: '#0071e3', width: inPlaylistsProgress.total > 0 ? `${(inPlaylistsProgress.scanned / inPlaylistsProgress.total) * 100}%` : '0%', transition: 'width 0.3s' }} />
                </div>
                {inPlaylistsList.length > 0 && (
                  <div>
                    <p style={{ fontSize: 15, color: '#888', marginBottom: 6 }}>Found in {inPlaylistsList.length} so far...</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 160, overflowY: 'auto' }}>
                      {inPlaylistsList.map((name, i) => <div key={i} style={{ padding: '6px 12px', background: '#e8f0fb', borderRadius: 6, fontSize: 15, color: '#0071e3', fontWeight: 500 }}>{name}</div>)}
                    </div>
                  </div>
                )}
              </div>
            ) : inPlaylistsList.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#aaa', fontSize: 18, padding: '20px 0' }}>This file is not in any sponsorship breaks.</p>
            ) : (
              <div>
                <p style={{ fontSize: 15, color: '#666', marginBottom: 8 }}>Found in <strong>{inPlaylistsList.length}</strong> break{inPlaylistsList.length !== 1 ? 's' : ''}:</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 240, overflowY: 'auto', marginBottom: 16 }}>
                  {inPlaylistsList.map((name, i) => <div key={i} style={{ padding: '7px 12px', background: '#e8f0fb', borderRadius: 7, fontSize: 15, color: '#0071e3', fontWeight: 500, border: '0.5px solid #b8d0f0' }}>{name}</div>)}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <button onClick={() => { setInPlaylistsFile(null); setInPlaylistsList([]) }} style={{ flex: 1, padding: '9px 0', background: 'white', border: '0.5px solid #ddd', borderRadius: 8, fontSize: 18, cursor: 'pointer' }}>Close</button>
              {!inPlaylistsLoading && inPlaylistsList.length > 0 && (
                <button
                  onClick={() => {
                    const fileName = inPlaylistsFile?.name.replace(/\.[^/.]+$/, '') || 'audio-file'
                    const date = new Date().toLocaleDateString('en-AU').replace(/\//g, '-')
                    const csvContent = [`Audio File,${fileName}`, `Export Date,${date}`, `Total Breaks,${inPlaylistsList.length}`, '', 'Sponsorship Break', ...inPlaylistsList].join('\n')
                    const blob = new Blob([csvContent], { type: 'text/csv' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = `${fileName} - playlists - ${date}.csv`; a.click(); URL.revokeObjectURL(url)
                  }}
                  style={{ flex: 1, padding: '9px 0', background: '#0071e3', color: 'white', border: 'none', borderRadius: 8, fontSize: 18, cursor: 'pointer' }}
                >
                  Export CSV
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </ErrorBoundary>
  )
}

