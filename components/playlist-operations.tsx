"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { googleDriveService, PLAYLIST_FOLDER_ID } from "@/lib/google-drive"
import { Plus, FileText, Loader2, AlertCircle } from "lucide-react"

interface PlaylistOperationsProps {
  onPlaylistCreated: () => void
}

export function PlaylistOperations({ onPlaylistCreated }: PlaylistOperationsProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createNewPlaylist = async () => {
    if (!newPlaylistName.trim()) return

    setIsCreating(true)
    setError(null)

    try {
      const fileName = newPlaylistName.endsWith(".m3u8") ? newPlaylistName : `${newPlaylistName}.m3u8`
      const initialContent = "#EXTM3U\n"

      // Create new file in Google Drive
      const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleDriveService["accessToken"]}`,
          "Content-Type": "multipart/related; boundary=boundary123",
        },
        body: [
          "--boundary123",
          "Content-Type: application/json; charset=UTF-8",
          "",
          JSON.stringify({
            name: fileName,
            parents: [PLAYLIST_FOLDER_ID],
            mimeType: "text/plain",
          }),
          "",
          "--boundary123",
          "Content-Type: text/plain",
          "",
          initialContent,
          "--boundary123--",
        ].join("\r\n"),
      })

      if (!response.ok) {
        throw new Error("Failed to create playlist file")
      }

      setNewPlaylistName("")
      setIsCreateOpen(false)
      onPlaylistCreated()
    } catch (error) {
      console.error("Failed to create playlist:", error)
      setError("Failed to create new playlist. Please try again.")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Playlist
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif">
            <FileText className="h-5 w-5 text-primary" />
            Create New Playlist
          </DialogTitle>
          <DialogDescription>Create a new M3U8 playlist file in your Google Drive.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="playlist-name">Playlist Name</Label>
            <Input
              id="playlist-name"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="Enter playlist name (e.g., Morning Show Sponsors)"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The .m3u8 extension will be added automatically if not provided.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={createNewPlaylist} disabled={!newPlaylistName.trim() || isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create Playlist
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
