"use client"

import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  googleDriveService,
  type GoogleDriveFile,
  type AudioDirectory,
  PLAYLIST_FOLDER_ID,
  DEFAULT_AUDIO_DIRECTORIES,
} from "@/lib/google-drive"
import { ErrorBoundary } from "@/components/error-boundary"
import { useToast } from "@/hooks/use-toast"
import { FileText, Loader2, AlertCircle, RefreshCw, Search, Music, Headphones, GripVertical, Play, Square, SkipBack, SkipForward, Clock, X, AlarmClock } from "lucide-react"

interface PlaylistManagerProps {
  accessToken: string
  onAuthError?: () => void
}

export function PlaylistManager({ accessToken, onAuthError }: PlaylistManagerProps) {
  const [playlists, setPlaylists] = useState<GoogleDriveFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState<GoogleDriveFile | null>(null)
  const [playlistSearch, setPlaylistSearch] = useState("")

  // Audio folders and files (right pane)
  const [audioDirectories, setAudioDirectories] = useState<AudioDirectory[]>(DEFAULT_AUDIO_DIRECTORIES)
  const [selectedDirectoryName, setSelectedDirectoryName] = useState<string>(DEFAULT_AUDIO_DIRECTORIES[0]?.name || "")
  const [directoryFiles, setDirectoryFiles] = useState<Record<string, GoogleDriveFile[]>>({})
  const [dirLoading, setDirLoading] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState("") 

  

  // Playlist content (bottom pane)
  const [originalContent, setOriginalContent] = useState<string>("#EXTM3U\n")
  const [playlistItems, setPlaylistItems] = useState<{ path: string; filename: string }[]>([])
  const [containerName, setContainerName] = useState<string>("")
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Audio player state
  const [playingFileId, setPlayingFileId] = useState<string | null>(null)
  const [isLoadingAudio, setIsLoadingAudio] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioBlobUrl = useRef<string | null>(null)

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }
    if (audioBlobUrl.current) {
      URL.revokeObjectURL(audioBlobUrl.current)
      audioBlobUrl.current = null
    }
    setPlayingFileId(null)
  }

  const playFile = async (file: { id: string; name: string }, allFiles: { id: string; name: string }[]) => {
    // If already playing this file, stop it
    if (playingFileId === file.id) {
      stopAudio()
      return
    }
    // Stop any current audio
    stopAudio()
    setIsLoadingAudio(file.id)
    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!response.ok) throw new Error("Failed to load audio")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      audioBlobUrl.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        setPlayingFileId(null)
      }
      await audio.play()
      setPlayingFileId(file.id)
    } catch (err) {
      console.error("Audio playback error:", err)
      toast({ title: "Playback failed", description: "Could not load audio file.", variant: "destructive" })
    } finally {
      setIsLoadingAudio(null)
    }
  }

  const skipTo = (direction: "prev" | "next", allFiles: { id: string; name: string }[]) => {
    if (!playingFileId) return
    const idx = allFiles.findIndex(f => f.id === playingFileId)
    const nextIdx = direction === "next" ? idx + 1 : idx - 1
    if (nextIdx >= 0 && nextIdx < allFiles.length) {
      playFile(allFiles[nextIdx], allFiles)
    }
  }

  // Schedule dialog state
  const [scheduleFile, setScheduleFile] = useState<{ id: string; name: string; directoryName: string; localPath: string } | null>(null)
  const [expiryFile, setExpiryFile] = useState<{ id: string; name: string; directoryName: string; localPath: string } | null>(null)
  const [removeAllFile, setRemoveAllFile] = useState<{ id: string; name: string; localPath: string } | null>(null)
  const [inPlaylistsFile, setInPlaylistsFile] = useState<{ name: string; localPath: string } | null>(null)
  const [inPlaylistsList, setInPlaylistsList] = useState<string[]>([])
  const [inPlaylistsLoading, setInPlaylistsLoading] = useState(false)
  const [inPlaylistsProgress, setInPlaylistsProgress] = useState({ scanned: 0, total: 0 })

  async function findFileInPlaylists(file: { name: string; localPath: string }) {
    setInPlaylistsFile(file)
    setInPlaylistsList([])
    setInPlaylistsLoading(true)
    setInPlaylistsProgress({ scanned: 0, total: 0 })
    try {
      const tokenKey = Object.keys(localStorage).find(k => k.includes('access_token') || k.includes('google'))
      const token = tokenKey ? localStorage.getItem(tokenKey) : accessToken
      if (!token) { setInPlaylistsLoading(false); return }

      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!listRes.ok) { setInPlaylistsLoading(false); return }
      const { files } = await listRes.json()

      setInPlaylistsProgress({ scanned: 0, total: files.length })
      const found: string[] = []
      const BATCH = 10
      let scanned = 0
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH)
        await Promise.all(batch.map(async (pl: { id: string; name: string }) => {
          try {
            const res = await fetch(
              `https://www.googleapis.com/drive/v3/files/${pl.id}?alt=media`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            if (!res.ok) return
            const text = await res.text()
            for (const line of text.split('\n')) {
              if (line.startsWith('Container=') && line.includes(file.localPath)) {
                found.push(pl.name.replace(/\.m3u8$/i, ''))
                break
              }
            }
          } catch {}
        }))
        scanned = Math.min(i + BATCH, files.length)
        setInPlaylistsProgress({ scanned, total: files.length })
        setInPlaylistsList([...found])
      }
    } finally {
      setInPlaylistsLoading(false)
    }
  }
  const [removeAllLoading, setRemoveAllLoading] = useState(false)
  const [removeAllMsg, setRemoveAllMsg] = useState('')

  async function removeFromAllPlaylists() {
    if (!removeAllFile) return
    setRemoveAllLoading(true)
    setRemoveAllMsg('Scanning playlists...')
    try {
      const tokenKey = Object.keys(localStorage).find(k => k.includes('access_token') || k.includes('google'))
      const token = tokenKey ? localStorage.getItem(tokenKey) : accessToken
      if (!token) { setRemoveAllMsg('❌ Google Drive not connected'); return }

      // List all playlists
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!listRes.ok) { setRemoveAllMsg('❌ Failed to list playlists'); return }
      const { files } = await listRes.json()

      const pathToRemove = removeAllFile.localPath
      const BATCH = 10 // fetch 10 playlists at a time

      // Step 1: Fetch all playlist contents in parallel batches
      setRemoveAllMsg(`Scanning ${files.length} playlists...`)
      const toUpdate: { id: string; name: string; containerName: string; updatedPaths: string[] }[] = []

      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH)
        await Promise.all(batch.map(async (playlist: { id: string; name: string }) => {
          try {
            const res = await fetch(
              `https://www.googleapis.com/drive/v3/files/${playlist.id}?alt=media`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            if (!res.ok) return
            const text = await res.text()
            let containerName = ''
            let paths: string[] = []
            for (const line of text.split('\n').filter((l: string) => l.trim())) {
              if (line.startsWith('Container=')) {
                const match = line.match(/Container=<([^>]+)>(.+)/)
                if (match) {
                  containerName = decodeURIComponent(match[1].replace(/\+/g, ' '))
                  paths = match[2].split('|').filter((p: string) => p.trim())
                }
              }
            }
            // Only queue playlists that actually contain the file
            if (!paths.includes(pathToRemove)) return
            toUpdate.push({
              id: playlist.id,
              name: playlist.name,
              containerName,
              updatedPaths: paths.filter((p: string) => p !== pathToRemove),
            })
          } catch {}
        }))
        setRemoveAllMsg(`Scanning... ${Math.min(i + BATCH, files.length)} / ${files.length}`)
      }

      if (toUpdate.length === 0) {
        setRemoveAllMsg('✅ File not found in any playlists')
        setTimeout(() => { setRemoveAllFile(null); setRemoveAllMsg('') }, 2000)
        return
      }

      // Step 2: Save only the playlists that contained the file, in parallel batches
      setRemoveAllMsg(`Removing from ${toUpdate.length} playlist${toUpdate.length !== 1 ? 's' : ''}...`)
      let saved = 0

      for (let i = 0; i < toUpdate.length; i += BATCH) {
        const batch = toUpdate.slice(i, i + BATCH)
        await Promise.all(batch.map(async (pl) => {
          try {
            const encodedName = encodeURIComponent(pl.containerName || 'Not predefined').replace(/%20/g, '+')
            const newContent = pl.updatedPaths.length > 0
              ? `#EXTM3U\nContainer=<${encodedName}>${pl.updatedPaths.join('|')}\n`
              : `#EXTM3U\n`
            const res = await fetch(
              `https://www.googleapis.com/upload/drive/v3/files/${pl.id}?uploadType=media&supportsAllDrives=true`,
              { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: newContent }
            )
            if (res.ok) saved++
          } catch {}
        }))
      }

      setRemoveAllMsg(`✅ Removed from ${saved} playlist${saved !== 1 ? 's' : ''}`)
      setTimeout(() => { setRemoveAllFile(null); setRemoveAllMsg('') }, 2000)
    } catch {
      setRemoveAllMsg('❌ Failed to remove from playlists')
    } finally {
      setRemoveAllLoading(false)
    }
  }
  const [expiryForm, setExpiryForm] = useState({ expires_at: '', expires_time: '23:59' })
  const [expirySaving, setExpirySaving] = useState(false)
  const [expiryMsg, setExpiryMsg] = useState('')

  async function saveExpiryOnly() {
    if (!expiryFile) return
    if (!expiryForm.expires_at) { setExpiryMsg('Please set an expiry date'); return }
    setExpirySaving(true)
    setExpiryMsg('')
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_file_id: expiryFile.id,
          audio_file_name: expiryFile.name,
          audio_directory_name: expiryFile.directoryName,
          audio_local_path: expiryFile.localPath,
          playlist_id: 'all',
          playlist_name: 'All playlists',
          position: -1,
          schedule_type: 'expiry_only',
          days_of_week: null,
          specific_dates: null,
          time_of_day: '00:00',
          expires_at: `${expiryForm.expires_at}T${expiryForm.expires_time}:00`,
        }),
      })
      if (res.ok) {
        setExpiryMsg('✅ Expiry set!')
        setTimeout(() => { setExpiryFile(null); setExpiryMsg('') }, 1500)
      } else {
        setExpiryMsg('❌ Failed to set expiry')
      }
    } finally {
      setExpirySaving(false)
    }
  }
  const [scheduleForm, setScheduleForm] = useState({
    selected_playlists: [] as { id: string; name: string }[],
    position: '-1',
    schedule_type: 'recurring', days_of_week: [] as number[],
    specific_dates: '', time_of_day: '08:00', expires_at: '', expires_time: '23:59',
  })
  const [playlistSearchSchedule, setPlaylistSearchSchedule] = useState('')
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleMsg, setScheduleMsg] = useState('')

  async function saveSchedule() {
    if (!scheduleFile) return
    if (scheduleForm.selected_playlists.length === 0) { setScheduleMsg('Please select at least one playlist'); return }
    if (scheduleForm.schedule_type === 'recurring' && scheduleForm.days_of_week.length === 0) {
      setScheduleMsg('Please select at least one day'); return
    }
    if (scheduleForm.schedule_type === 'once' && !scheduleForm.specific_dates) {
      setScheduleMsg('Please enter a date'); return
    }
    setScheduleSaving(true)
    setScheduleMsg('')
    try {
      let saved = 0
      for (const pl of scheduleForm.selected_playlists) {
        const res = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio_file_id: scheduleFile.id,
            audio_file_name: scheduleFile.name,
            audio_directory_name: scheduleFile.directoryName,
            audio_local_path: scheduleFile.localPath,
            playlist_id: pl.id,
            playlist_name: pl.name,
            position: parseInt(scheduleForm.position),
            schedule_type: scheduleForm.schedule_type,
            days_of_week: scheduleForm.days_of_week.join(',') || null,
            specific_dates: scheduleForm.specific_dates || null,
            time_of_day: scheduleForm.time_of_day,
            expires_at: scheduleForm.expires_at
              ? `${scheduleForm.expires_at}T${scheduleForm.expires_time}:00`
              : null,
          }),
        })
        if (res.ok) saved++
      }
      if (saved === scheduleForm.selected_playlists.length) {
        setScheduleMsg(`✅ ${saved} schedule${saved > 1 ? 's' : ''} saved!`)
        setTimeout(() => { setScheduleFile(null); setScheduleMsg(''); setPlaylistSearchSchedule('') }, 1500)
      } else {
        setScheduleMsg(`⚠️ Saved ${saved} of ${scheduleForm.selected_playlists.length}`)
      }
    } finally {
      setScheduleSaving(false)
    }
  }

  // Duration cache state
  const [playlistDurations, setPlaylistDurations] = useState<Record<string, number>>({}) // playlistId -> total seconds
  const [durationLoading, setDurationLoading] = useState<string | null>(null) // playlistId being calculated

  // Persist durations to sessionStorage so they survive page navigation
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

  const measureAudioDuration = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio()
      audio.preload = 'metadata'
      const timeout = setTimeout(() => resolve(0), 10000) // 10s timeout
      audio.onloadedmetadata = () => {
        clearTimeout(timeout)
        const d = audio.duration
        resolve(typeof d === 'number' && !isNaN(d) && isFinite(d) && d > 0 ? d : 0)
      }
      audio.onerror = () => { clearTimeout(timeout); resolve(0) }
      audio.src = url
    })
  }

  const calculatePlaylistDuration = async (playlistId: string, items: { path: string; filename: string }[]) => {
    if (items.length === 0) return
    setDurationLoading(playlistId)
    try {
      // Load all directory files if not already cached
      let allFiles = Object.values(directoryFiles).flat()
      if (allFiles.length === 0) {
        // Load all directories first
        const loadedFiles: typeof allFiles = []
        for (const dir of audioDirectories) {
          if (!dir.driveId) continue
          try {
            const files = await googleDriveService.listFiles(dir.driveId)
            loadedFiles.push(...files)
          } catch {}
        }
        allFiles = loadedFiles
      }

      // Match playlist items to Google Drive file IDs by filename
      const fileMatches: { file_id: string; file_name: string }[] = []
      for (const item of items) {
        const baseName = item.filename.toLowerCase().replace(/\.[^/.]+$/, '')
        const match = allFiles.find(f =>
          f.name.toLowerCase().replace(/\.[^/.]+$/, '') === baseName
        )
        if (match) fileMatches.push({ file_id: match.id, file_name: match.name })
      }

      if (fileMatches.length === 0) {
        setDurationLoading(null)
        return
      }

      // Check which ones we already have cached
      const ids = fileMatches.map(f => f.file_id).join(',')
      const cacheRes = await fetch(`/api/durations?ids=${ids}`)
      const cached: { file_id: string; duration_seconds: number }[] = cacheRes.ok ? await cacheRes.json() : []
      const cachedMap = Object.fromEntries(cached.map(c => [c.file_id, c.duration_seconds]))

      // Measure uncached files
      const uncached = fileMatches.filter(f => cachedMap[f.file_id] === undefined)
      const newDurations: { file_id: string; file_name: string; duration_seconds: number }[] = []

      for (const file of uncached) {
        try {
          const url = `https://www.googleapis.com/drive/v3/files/${file.file_id}?alt=media`
          const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
          if (!response.ok) continue
          const blob = await response.blob()
          const objectUrl = URL.createObjectURL(blob)
          const duration = await measureAudioDuration(objectUrl)
          URL.revokeObjectURL(objectUrl)
          if (typeof duration === 'number' && !isNaN(duration) && isFinite(duration) && duration > 0) {
            newDurations.push({ file_id: file.file_id, file_name: file.file_name, duration_seconds: duration })
            cachedMap[file.file_id] = duration
          }
        } catch {
          // skip failed files
        }
      }

      // Save new durations to cache
      if (newDurations.length > 0) {
        await fetch('/api/durations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ durations: newDurations }),
        })
      }

      // Calculate total — only include valid non-NaN durations
      const total = fileMatches.reduce((sum, f) => {
        const d = cachedMap[f.file_id]
        return sum + (typeof d === 'number' && !isNaN(d) && d > 0 ? d : 0)
      }, 0)
      // Only set if we got at least some valid durations
      if (total > 0) {
        setPlaylistDurations(prev => ({ ...prev, [playlistId]: total }))
      }
    } catch (err) {
      console.error('[duration] Failed to calculate duration:', err)
    } finally {
      setDurationLoading(null)
    }
  }

  const { toast } = useToast()

  // Helper function to remove file extensions
  const removeFileExtension = (filename: string): string => {
    return filename.replace(/\.[^/.]+$/, "")
  }

  // Helper function to check if file is audio file
  const isAudioFile = (filename: string): boolean => {
    const audioExtensions = ['.wav', '.mp3']
    return audioExtensions.some(ext => filename.toLowerCase().endsWith(ext))
  }

  useEffect(() => {
    loadInitialData()
  }, [accessToken])

  // Check session validity periodically and extend if needed
  useEffect(() => {
    if (!accessToken) return

    const checkSession = () => {
      try {
        const sessionInfo = googleDriveService.getSessionInfo()
        if (sessionInfo) {
          console.log("[v0] Session check:", sessionInfo)
          
          // If session expires within 24 hours, extend it
          if (sessionInfo.timeUntilExpiry < 24 * 60 * 60 * 1000 && !sessionInfo.isExpired) {
            googleDriveService.checkSessionValidity()
            console.log("[v0] Session extended automatically")
          }
        }
      } catch (error) {
        console.error("[v0] Session check failed:", error)
      }
    }

    // Check immediately
    checkSession()

    // Check every hour
    const interval = setInterval(checkSession, 60 * 60 * 1000)

    return () => clearInterval(interval)
  }, [accessToken])

  const loadInitialData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      console.log("[v0] Loading initial playlist data...")

      // Check if playlist folder is configured
      if (!PLAYLIST_FOLDER_ID) {
        setError("Playlist folder not configured. Please configure your Google Drive folders in the settings.")
        return
      }

      // Set access token for the service
      googleDriveService.setAccessToken(accessToken)

      // Load playlists from the designated folder
      const playlistFiles = await googleDriveService.listFiles(PLAYLIST_FOLDER_ID)
      const m3u8Files = playlistFiles.filter((file) => file.name.endsWith(".m3u8"))

      console.log(`[v0] Loaded ${m3u8Files.length} playlist files`)
      setPlaylists(m3u8Files)

      // Pre-load any already-cached durations for all playlists
      try {
        const allIds = m3u8Files.map((f: any) => f.id).join(',')
        // We store durations by file_id of audio files, not playlist ids
        // So just initialise — durations load when playlist is opened
        // But restore from sessionStorage if available
        const cached = sessionStorage.getItem('playlistDurations')
        if (cached) {
          setPlaylistDurations(JSON.parse(cached))
        }
      } catch {}
    } catch (error) {
      console.error("[v0] Failed to load initial data:", error)
      const errorMessage = error instanceof Error ? error.message : "Failed to load playlists"
      
      // Check if this is an authentication error
      if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) {
        console.log("[v0] Authentication error detected, triggering re-authentication")
        if (onAuthError) {
          onAuthError()
        }
        return
      }
      
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredPlaylists = useMemo(() => {
    let filtered = playlists
    if (playlistSearch) {
      filtered = playlists.filter((pl) => pl.name.toLowerCase().includes(playlistSearch.toLowerCase()))
    }
    // Sort alphabetically
    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [playlists, playlistSearch])

  const handlePlaylistCreated = () => {
    loadInitialData()
  }

  const handleRetry = () => {
    loadInitialData()
  }

  // Helpers: parse and generate playlist content
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
          const paths = match[2].split("|")
          paths.forEach((p) => {
            if (p.trim()) {
              const fullFilename = p.split("\\").pop() || p.split("/").pop() || p
              const filename = removeFileExtension(fullFilename)
              items.push({ path: p.trim(), filename })
            }
          })
        }
      }
    }
    setContainerName(name)
    setPlaylistItems(items)
  }

  const generatePlaylistContent = (): string => {
    if (playlistItems.length === 0) return "#EXTM3U\n"
    const paths = playlistItems.map((i) => i.path).join("|")
    const encodedName = encodeURIComponent(containerName || "Not predefined").replace(/%20/g, "+")
    return `#EXTM3U\nContainer=<${encodedName}>${paths}\n`
  }

  // Load selected playlist content
  useEffect(() => {
    const load = async () => {
      if (!selectedPlaylist) {
        setOriginalContent("#EXTM3U\n")
        setPlaylistItems([])
        setContainerName("")
        return
      }
      try {
        setIsPlaylistLoading(true)
        const content = await googleDriveService.getFileContent(selectedPlaylist.id)
        setOriginalContent(content)
        parsePlaylistContent(content)
        // Trigger duration calculation after items are parsed
        setTimeout(() => {
          const lines2 = content.split("\n").filter(l => l.trim())
          const parsedItems: { path: string; filename: string }[] = []
          for (const line of lines2) {
            if (line.startsWith("Container=")) {
              const match = line.match(/Container=<([^>]+)>(.+)/)
              if (match) {
                match[2].split("|").forEach(p => {
                  if (p.trim()) {
                    const fullFilename = p.split("\\").pop() || p.split("/").pop() || p
                    parsedItems.push({ path: p.trim(), filename: fullFilename.replace(/\.[^/.]+$/, "") })
                  }
                })
              }
            }
          }
          if (parsedItems.length > 0 && selectedPlaylist) {
            calculatePlaylistDuration(selectedPlaylist.id, parsedItems)
          }
        }, 100)
      } catch (e) {
        console.error("Failed to load playlist content", e)
        const errorMessage = e instanceof Error ? e.message : "Failed to load playlist content"
        
        // Check if this is an authentication error
        if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) {
          console.log("Authentication error detected in playlist loading, triggering re-authentication")
          if (onAuthError) {
            onAuthError()
          }
          return
        }
      } finally {
        setIsPlaylistLoading(false)
      }
    }
    load()
  }, [selectedPlaylist])

  // Directory files loading
  const selectedDirectory: AudioDirectory | undefined = useMemo(
    () => audioDirectories.find((d) => d.name === selectedDirectoryName),
    [audioDirectories, selectedDirectoryName],
  )

  const loadDirectoryFiles = async (directory: AudioDirectory) => {
    if (!directory.driveId) {
      console.log(`[PM] Directory '${directory.name}' not configured (no driveId)`)
      return
    }
    setDirLoading((prev) => ({ ...prev, [directory.name]: true }))
    try {
      console.log(`[PM] Fetching files for directory '${directory.name}' (id=${directory.driveId})`)
      const files = await googleDriveService.listFiles(directory.driveId)
      console.log(`[PM] Got ${files.length} files for '${directory.name}'`)
      setDirectoryFiles((prev) => ({ ...prev, [directory.name]: files }))
    } catch (error) {
      console.error(`[PM] Failed to load files for '${directory.name}':`, error)
      const errorMessage = error instanceof Error ? error.message : "Failed to load files"
      
      // Check if this is an authentication error
      if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) {
        console.log("[PM] Authentication error detected, triggering re-authentication")
        if (onAuthError) {
          onAuthError()
        }
        return
      }
      
      // Don't set error state here, just log it
    } finally {
      setDirLoading((prev) => ({ ...prev, [directory.name]: false }))
    }
  }

  useEffect(() => {
    audioDirectories.forEach((d) => {
      if (d.driveId && !directoryFiles[d.name]) {
        loadDirectoryFiles(d)
      }
    })
  }, [audioDirectories])

  const filteredFiles = useMemo(() => {
    const files = selectedDirectory ? directoryFiles[selectedDirectory.name] || [] : []
    // Filter to only show audio files (.wav and .mp3)
    const audioFiles = files.filter((f) => isAudioFile(f.name))
    
    let filtered = audioFiles
    if (search) {
      filtered = audioFiles.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    }
    // Sort alphabetically
    const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name))
    console.log(`[PM] filter search='${search}' => ${sorted.length}/${audioFiles.length} audio files`)
    return sorted
  }, [directoryFiles, search, selectedDirectory])

  // Add / Remove handlers
  const buildPathForFile = (file: GoogleDriveFile, directory?: AudioDirectory): string => {
    if (directory) return directory.localPath.replace("{audio_filename}", file.name)
    return `T:\\My Drive\\Audio\\${file.name}`
  }

  const isInPlaylist = (file: GoogleDriveFile): boolean => {
    const p = buildPathForFile(file, selectedDirectory)
    return playlistItems.some((it) => it.path === p)
  }

  const addFileToPlaylist = (file: GoogleDriveFile) => {
    if (!selectedPlaylist) {
      toast({
        title: "Select a playlist",
        description: "Please select a playlist before adding audio files.",
        variant: "error",
      })
      return
    }
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
    setIsSaving(true)
    setSaveError(null)
    try {
      const content = generatePlaylistContent()
      await googleDriveService.updateFile(selectedPlaylist.id, content)
      setOriginalContent(content)
      toast({ 
        title: "Playlist saved", 
        description: `${selectedPlaylist.name.replace(/\.m3u8$/i, "")} was updated successfully.`, 
        variant: "success" as any 
      })
    } catch (e: any) {
      console.error("Save playlist failed", e)
      const errorMessage = e?.message || "Failed to save playlist"
      
      // Check if this is an authentication error
      if (errorMessage.includes("Authentication expired") || errorMessage.includes("Not authenticated")) {
        console.log("Authentication error detected in save, triggering re-authentication")
        if (onAuthError) {
          onAuthError()
        }
        return
      }
      
      setSaveError(errorMessage)
    } finally {
      setIsSaving(false)
    }
  }

  const resetPlaylist = () => {
    parsePlaylistContent(originalContent)
  }

  // Drag and drop state for visual feedback
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    draggedIndex: number | null
    hoveredDropZone: number | null
  }>({
    isDragging: false,
    draggedIndex: null,
    hoveredDropZone: null,
  })

  // Drag and drop handlers for playlist reordering
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString())
    e.dataTransfer.effectAllowed = 'move'
    setDragState({
      isDragging: true,
      draggedIndex: index,
      hoveredDropZone: null,
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragState({
      isDragging: false,
      draggedIndex: null,
      hoveredDropZone: null,
    })
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDropZoneEnter = useCallback((dropIndex: number) => {
    setDragState(prev => ({
      ...prev,
      hoveredDropZone: dropIndex,
    }))
  }, [])

  const handleDropZoneLeave = useCallback(() => {
    setDragState(prev => ({
      ...prev,
      hoveredDropZone: null,
    }))
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'))
    
    if (dragIndex === dropIndex) return
    
    setPlaylistItems(prev => {
      const newItems = [...prev]
      const draggedItem = newItems[dragIndex]
      newItems.splice(dragIndex, 1)
      newItems.splice(dropIndex, 0, draggedItem)
      return newItems
    })
    
    setDragState({
      isDragging: false,
      draggedIndex: null,
      hoveredDropZone: null,
    })
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-2 text-muted-foreground">Loading your audio files and playlists...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="font-serif text-2xl">Failed to Load</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>

            <Button onClick={handleRetry} className="w-full" size="lg">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen" style={{ backgroundColor: '#f8f8f8' }}>
        <header className="border-b bg-card">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Headphones className="h-8 w-8 text-primary" />
                <h1 className="font-serif text-2xl font-bold text-foreground">REGFM - RadioBOSS Sponsorship Scheduler</h1>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href="/schedules"
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                >
                  <Clock className="h-4 w-4 text-gray-500" />
                  Schedules
                </a>
                <a
                  href="/admin"
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                >
                  Admin
                </a>
              </div>
            </div>
          </div>
        </header>

        <div className="container mx-auto p-4 grid h-[calc(100vh-80px)] grid-rows-[3fr_2fr] gap-4">
          {/* Top row: left playlists and right audio files */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4" style={{ height: "400px" }}>
            {/* Left: Playlists list */}
            <Card className="lg:col-span-2 flex flex-col min-h-0 bg-white">
              <CardHeader>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-4 w-full">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      <span className="font-serif text-lg font-medium">Playlists</span>
                      <Badge variant="secondary">{filteredPlaylists.length} found</Badge>
                    </div>
                    <div className="relative flex-1 min-w-64">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
                      <Input
                        placeholder="Search playlists..."
                        value={playlistSearch}
                        onChange={(e) => setPlaylistSearch(e.target.value)}
                        className="pl-8 w-58 h-9 border rounded-md bg-background"
                        style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto">
                {playlists.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <FileText className="mx-auto h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">No playlists found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredPlaylists.map((pl) => (
                      <Button
                        key={pl.id}
                        variant={selectedPlaylist?.id === pl.id ? "default" : "ghost"}
                        className={`w-full justify-start text-left h-auto p-2 ${
                          selectedPlaylist?.id !== pl.id 
                            ? "hover:bg-[#efefef] dark:hover:bg-gray-1000 hover:text-foreground dark:hover:text-foreground" 
                            : ""
                        }`}
                        onClick={() => setSelectedPlaylist(pl)}
                      >
                        <div className="w-full flex items-center justify-between">
                          <div className="font-medium truncate text-sm flex-1 mr-2">{removeFileExtension(pl.name)}</div>
                          <div className={`text-xs whitespace-nowrap flex items-center gap-1 ${
                            selectedPlaylist?.id === pl.id 
                              ? "text-primary-foreground" 
                              : "text-muted-foreground"
                          }`}>
                            {durationLoading === pl.id ? (
                              <span className="flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Calculating...</span>
                              </span>
                            ) : playlistDurations[pl.id] ? (
                              formatDuration(playlistDurations[pl.id])
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right: Audio files with dropdown + search */}
            <Card className="lg:col-span-3 flex flex-col min-h-0 bg-white">
              <CardHeader>
                <div className="flex items-center gap-4 flex-wrap">
                  <CardTitle className="font-serif flex items-center gap-2">
                    <Music className="h-5 w-5 text-primary" />
                    Audio Files
                    {selectedDirectory && (
                      <Badge variant="secondary">{filteredFiles.length} found</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Select value={selectedDirectoryName} onValueChange={setSelectedDirectoryName}>
                      <SelectTrigger className="w-48 h-9 border rounded-md bg-background" style={{ boxShadow: "0 0 0 1px var(--color-border)" }}>
                        <SelectValue placeholder="Select audio folder" />
                      </SelectTrigger>
                      <SelectContent>
                        {audioDirectories.map((d) => (
                          <SelectItem key={d.name} value={d.name}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="relative flex-1 min-w-64">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search audio files..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8 w-full h-9 border rounded-md bg-background"
                        style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
                      />
                    </div>
                  </div>
                  {/* {selectedDirectory && selectedDirectory.driveId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => loadDirectoryFiles(selectedDirectory)}
                      disabled={!!dirLoading[selectedDirectory.name]}
                    >
                      {dirLoading[selectedDirectory.name] ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  )} */}
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto">
                {!selectedDirectory || !selectedDirectory.driveId ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="font-medium">Select a configured audio folder</p>
                  </div>
                ) : dirLoading[selectedDirectory.name] ? (
                  <div className="text-center py-8">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                    <p className="mt-2 text-muted-foreground">Loading audio files...</p>
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="font-medium">No audio files found</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredFiles.map((file, idx) => (
                      <div key={file.id} className={`flex items-center gap-2 p-1 rounded-md transition-colors ${
                        playingFileId === file.id
                          ? "bg-blue-50 border border-blue-200"
                          : isInPlaylist(file)
                          ? "bg-[#efefef] dark:bg-gray-1000"
                          : "hover:bg-[#efefef] dark:hover:bg-gray-1000"
                      }`}>
                        {/* Player controls */}
                        <div className="flex items-center flex-shrink-0">
                          <button
                            onClick={() => playFile(file, filteredFiles)}
                            disabled={isLoadingAudio === file.id}
                            className={`p-1 rounded transition-colors ${
                              playingFileId === file.id
                                ? "bg-blue-500 text-white hover:bg-blue-600"
                                : "hover:bg-gray-200"
                            }`}
                            title={playingFileId === file.id ? "Stop" : "Play"}
                          >
                            {isLoadingAudio === file.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : playingFileId === file.id ? (
                              <Square className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        {/* File name */}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Music className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className={`truncate text-sm ${playingFileId === file.id ? "text-blue-700 font-medium" : ""}`}>
                            {removeFileExtension(file.name)}
                          </div>
                          {playingFileId === file.id && (
                            <span className="text-xs text-blue-500 flex-shrink-0">▶ Playing</span>
                          )}
                        </div>
                        {/* Add/Remove button */}
                        {isInPlaylist(file) ? (
                          <Button variant="secondary" size="sm" onClick={() => removeFileFromPlaylist(file)}>
                            Remove
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => addFileToPlaylist(file)}>
                            Add
                          </Button>
                        )}
                        {/* Schedule button */}
                        <button
                          onClick={() => {
                            setScheduleFile({
                              id: file.id, name: file.name,
                              directoryName: selectedDirectory?.name || '',
                              localPath: buildPathForFile(file, selectedDirectory),
                            })
                            setScheduleForm({
                              selected_playlists: selectedPlaylist ? [{ id: selectedPlaylist.id, name: selectedPlaylist.name }] : [],
                              position: '-1', schedule_type: 'recurring',
                              days_of_week: [], specific_dates: '', time_of_day: '08:00',
                              expires_at: '', expires_time: '23:59',
                            })
                            setPlaylistSearchSchedule('')
                          }}
                          className="p-1 rounded hover:bg-gray-200 transition-colors flex-shrink-0"
                          title="Schedule this file"
                        >
                          <Clock className="h-3.5 w-3.5 text-gray-400 hover:text-gray-700" />
                        </button>
                        {/* Expiry-only button */}
                        <button
                          onClick={() => {
                            setExpiryFile({
                              id: file.id, name: file.name,
                              directoryName: selectedDirectory?.name || '',
                              localPath: buildPathForFile(file, selectedDirectory),
                            })
                            setExpiryForm({ expires_at: '', expires_time: '23:59' })
                          }}
                          className="p-1 rounded hover:bg-gray-200 transition-colors flex-shrink-0"
                          title="Set expiry date (remove from playlist on a date)"
                        >
                          <AlarmClock className="h-3.5 w-3.5 text-gray-400 hover:text-gray-700" />
                        </button>
                        {/* Remove from all playlists button */}
                        <button
                          onClick={() => setRemoveAllFile({
                            id: file.id, name: file.name,
                            localPath: buildPathForFile(file, selectedDirectory),
                          })}
                          className="p-1 rounded hover:bg-red-100 transition-colors flex-shrink-0"
                          title="Remove from all playlists"
                        >
                          <X className="h-3.5 w-3.5 text-red-400 hover:text-red-600" />
                        </button>
                        {/* Show which playlists contain this file */}
                        <button
                          onClick={() => findFileInPlaylists({
                            name: file.name,
                            localPath: buildPathForFile(file, selectedDirectory),
                          })}
                          className="p-1 rounded hover:bg-blue-100 transition-colors flex-shrink-0"
                          title="Show which playlists contain this file"
                        >
                          <FileText className="h-3.5 w-3.5 text-blue-400 hover:text-blue-600" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bottom row: Playlist file content full width */}
          <Card className="bg-white">
            <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-serif flex items-center gap-2">
                Sponsorship Break Content
                {playlistItems.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{playlistItems.length} audio added</Badge>
                )}
                {selectedPlaylist && (
                  <span className="text-sm text-foreground ml-2">
                    <span className="font-bold">Playlist:</span> <span className="font-normal">{removeFileExtension(selectedPlaylist.name)}</span>
                  </span>
                )}
              </CardTitle>
            </div>
            </CardHeader>
            <CardContent>
              {!selectedPlaylist ? (
                <div className="text-sm text-muted-foreground">Select a playlist to view its content.</div>
              ) : (
                <div className="space-y-3">
                  {isPlaylistLoading ? (
                    <div className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                      <p className="mt-2">Loading playlist content...</p>
                    </div>
                  ) : (
                    <>
                      {saveError && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>{saveError}</AlertDescription>
                        </Alert>
                      )}
                      
                      {/* Show only audio file list without raw text */}
                      {playlistItems.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Music className="mx-auto h-8 w-8 mb-2 opacity-50" />
                          <p className="text-sm">No audio files in this playlist</p>
                        </div>
                      ) : (
                        <div className="max-h-60 overflow-y-auto">
                          {playlistItems.map((item, index) => (
                            <div key={`${item.path}-${index}`}>
                              {/* Drop zone above each item */}
                              <div
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, index)}
                                onDragEnter={() => handleDropZoneEnter(index)}
                                onDragLeave={handleDropZoneLeave}
                                className={`h-2 transition-all duration-200 ${
                                  dragState.isDragging && dragState.hoveredDropZone === index && dragState.draggedIndex !== index
                                    ? 'bg-primary/20 border-2 border-dashed border-primary rounded'
                                    : 'hover:bg-gray-100/50'
                                }`}
                              />
                              
                              {/* Playlist item */}
                              <div 
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragEnd={handleDragEnd}
                                className={`flex items-center justify-between p-2 border rounded-md bg-gray-50 hover:bg-gray-100 cursor-move transition-colors ${
                                  dragState.isDragging && dragState.draggedIndex === index
                                    ? 'opacity-50'
                                    : ''
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                                  <Music className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                  <div className="truncate text-sm">{removeFileExtension(item.filename)}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">#{index + 1}</span>
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setPlaylistItems(prev => prev.filter((_, i) => i !== index))
                                    }}
                                    className="h-6 w-6 p-0 hover:bg-red-100 hover:text-red-600"
                                  >
                                    ×
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                          
                          {/* Drop zone after the last item */}
                          <div
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, playlistItems.length)}
                            onDragEnter={() => handleDropZoneEnter(playlistItems.length)}
                            onDragLeave={handleDropZoneLeave}
                            className={`h-2 transition-all duration-200 ${
                              dragState.isDragging && dragState.hoveredDropZone === playlistItems.length
                                ? 'bg-primary/20 border-2 border-dashed border-primary rounded'
                                : 'hover:bg-gray-100/50'
                            }`}
                          />
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                <Button onClick={savePlaylist} disabled={isSaving} className="w-40">
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button variant="outline" onClick={resetPlaylist} className="w-40">
                  Reset
                </Button>
              </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Schedule Dialog */}
      {scheduleFile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-lg">Schedule: {scheduleFile.name.replace(/\.[^/.]+$/, '')}</h2>
              <button onClick={() => setScheduleFile(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Multi-playlist selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">
                    Playlists
                    {scheduleForm.selected_playlists.length > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 bg-black text-white rounded text-xs">
                        {scheduleForm.selected_playlists.length} selected
                      </span>
                    )}
                  </label>
                  {scheduleForm.selected_playlists.length > 0 && (
                    <button
                      onClick={() => setScheduleForm(f => ({ ...f, selected_playlists: [] }))}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                {/* Search */}
                <input
                  type="text"
                  placeholder="Search playlists..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={playlistSearchSchedule}
                  onChange={e => setPlaylistSearchSchedule(e.target.value)}
                />
                {/* Checkbox list */}
                <div className="border border-gray-200 rounded-lg overflow-y-auto" style={{ maxHeight: '320px' }}>
                  {playlists
                    .filter(p => p.name.toLowerCase().includes(playlistSearchSchedule.toLowerCase()))
                    .map(p => {
                      const isSelected = scheduleForm.selected_playlists.some(s => s.id === p.id)
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm transition-colors border-b border-gray-50 last:border-0 ${
                            isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setScheduleForm(f => ({
                                ...f,
                                selected_playlists: isSelected
                                  ? f.selected_playlists.filter(s => s.id !== p.id)
                                  : [...f.selected_playlists, { id: p.id, name: p.name }]
                              }))
                            }}
                            className="rounded"
                          />
                          <span className={isSelected ? 'font-medium text-blue-700' : 'text-gray-700'}>
                            {p.name.replace(/\.m3u8$/i, '')}
                          </span>
                        </label>
                      )
                    })
                  }
                </div>
              </div>

              {/* Position */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Position in playlist</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={scheduleForm.position}
                  onChange={e => setScheduleForm(f => ({ ...f, position: e.target.value }))}
                >
                  <option value="-1">Add to end</option>
                  <option value="0">Add at beginning</option>
                  {[1,2,3,4,5,6,7,8,9].map(n => (
                    <option key={n} value={String(n)}>After position {n}</option>
                  ))}
                </select>
              </div>

              {/* Schedule type */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Schedule type</label>
                <div className="flex gap-2">
                  {(['recurring', 'once'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setScheduleForm(f => ({ ...f, schedule_type: t }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        scheduleForm.schedule_type === t
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {t === 'recurring' ? '🔁 Recurring' : '1️⃣ One-time'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Days of week (recurring) */}
              {scheduleForm.schedule_type === 'recurring' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Days of week</label>
                  <div className="flex gap-1.5">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, idx) => (
                      <button
                        key={day}
                        onClick={() => setScheduleForm(f => ({
                          ...f,
                          days_of_week: f.days_of_week.includes(idx)
                            ? f.days_of_week.filter(d => d !== idx)
                            : [...f.days_of_week, idx]
                        }))}
                        className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                          scheduleForm.days_of_week.includes(idx)
                            ? 'bg-black text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Specific dates (one-time) */}
              {scheduleForm.schedule_type === 'once' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    value={scheduleForm.specific_dates}
                    onChange={e => setScheduleForm(f => ({ ...f, specific_dates: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}

              {/* Time */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Time</label>
                <input
                  type="time"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={scheduleForm.time_of_day}
                  onChange={e => setScheduleForm(f => ({ ...f, time_of_day: e.target.value }))}
                />
              </div>

              {scheduleMsg && (
                <p className="text-sm text-center">{scheduleMsg}</p>
              )}

              <button
                onClick={saveSchedule}
                disabled={scheduleSaving}
                className="w-full bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                {scheduleSaving ? 'Saving...' : 'Save Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Expiry-only Dialog */}
      {expiryFile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-semibold text-lg">Set Expiry: {expiryFile.name.replace(/\.[^/.]+$/, '')}</h2>
                <p className="text-sm text-gray-500 mt-0.5">File will be automatically removed from the playlist on this date</p>
              </div>
              <button onClick={() => setExpiryFile(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Expiry date */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Expiry date</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={expiryForm.expires_at}
                  onChange={e => setExpiryForm(f => ({ ...f, expires_at: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              {/* Expiry time */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Expiry time (Melbourne)</label>
                <input
                  type="time"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={expiryForm.expires_time}
                  onChange={e => setExpiryForm(f => ({ ...f, expires_time: e.target.value }))}
                  disabled={!expiryForm.expires_at}
                />
              </div>

              {expiryMsg && (
                <p className="text-sm text-center">{expiryMsg}</p>
              )}

              <button
                onClick={saveExpiryOnly}
                disabled={expirySaving}
                className="w-full bg-orange-500 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
              >
                {expirySaving ? 'Saving...' : 'Set Expiry'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* In Playlists dialog */}
      {inPlaylistsFile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="font-semibold text-lg">{inPlaylistsFile.name.replace(/\.[^/.]+$/, '')}</h2>
                <p className="text-sm text-gray-500 mt-0.5">Sponsorship breaks containing this file</p>
              </div>
              <button onClick={() => { setInPlaylistsFile(null); setInPlaylistsList([]) }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {inPlaylistsLoading ? (
              <div className="py-4">
                {/* Progress bar */}
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Scanning sponsorship breaks...</span>
                  <span className="font-medium">{inPlaylistsProgress.scanned} / {inPlaylistsProgress.total}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 mb-4 overflow-hidden">
                  <div
                    className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: inPlaylistsProgress.total > 0 ? `${(inPlaylistsProgress.scanned / inPlaylistsProgress.total) * 100}%` : '0%' }}
                  />
                </div>
                {inPlaylistsList.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Found in {inPlaylistsList.length} break{inPlaylistsList.length !== 1 ? 's' : ''} so far...</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {inPlaylistsList.map((name, i) => (
                        <div key={i} className="px-3 py-2 bg-blue-50 rounded-lg text-sm text-blue-700 font-medium">{name}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : inPlaylistsList.length === 0 ? (
              <div className="py-6 text-center text-gray-400 text-sm">
                This file is not in any sponsorship breaks.
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500 mb-3">Found in <span className="font-semibold text-gray-700">{inPlaylistsList.length}</span> sponsorship break{inPlaylistsList.length !== 1 ? 's' : ''}:</p>
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {inPlaylistsList.map((name, i) => (
                    <div key={i} className="px-3 py-2 bg-blue-50 rounded-lg text-sm text-blue-700 font-medium border border-blue-100">{name}</div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => { setInPlaylistsFile(null); setInPlaylistsList([]) }}
              className="w-full mt-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* Remove from all playlists confirm dialog */}
      {removeAllFile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-lg text-red-600">Remove from All Playlists</h2>
              <button onClick={() => setRemoveAllFile(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              Are you sure you want to remove <span className="font-semibold">{removeAllFile.name.replace(/\.[^/.]+$/, '')}</span> from <span className="font-semibold">all playlists</span>?
            </p>
            <p className="text-xs text-gray-400 mb-5">This will scan every playlist and remove this file wherever it appears. This cannot be undone.</p>
            {removeAllMsg && <p className="text-sm text-center mb-3">{removeAllMsg}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setRemoveAllFile(null)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={removeFromAllPlaylists}
                disabled={removeAllLoading}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {removeAllLoading ? 'Removing...' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  )
}
