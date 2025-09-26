"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
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
import { FileText, Loader2, AlertCircle, RefreshCw, Search, Music, Headphones, GripVertical } from "lucide-react"

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
                <h1 className="font-serif text-2xl font-bold text-foreground">Audio Playlist Manager</h1>
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
                          <div className={`text-xs whitespace-nowrap ${
                            selectedPlaylist?.id === pl.id 
                              ? "text-primary-foreground" 
                              : "text-muted-foreground"
                          }`}>
                            {pl.modifiedTime && new Date(pl.modifiedTime).toLocaleDateString()}
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
                  <div className="space-y-2">
                    {filteredFiles.map((file) => (
                      <div key={file.id} className={`flex items-center justify-between p-1 rounded-md transition-colors ${
                        isInPlaylist(file) 
                          ? "bg-[#efefef] dark:bg-gray-1000" 
                          : "hover:bg-[#efefef] dark:hover:bg-gray-1000"
                      }`}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Music className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="truncate text-sm">{removeFileExtension(file.name)}</div>
                        </div>
                        {isInPlaylist(file) ? (
                          <Button variant="secondary" size="sm" onClick={() => removeFileFromPlaylist(file)}>
                            Remove
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => addFileToPlaylist(file)}>
                            Add
                          </Button>
                        )}
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
                Playlist File Content
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
    </ErrorBoundary>
  )
}
