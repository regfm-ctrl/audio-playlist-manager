"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import type { AudioDirectory } from "@/lib/google-drive"
import { Settings, Plus, Folder, Save, AlertCircle } from "lucide-react"

interface DirectoryConfigProps {
  directories: AudioDirectory[]
  onDirectoriesUpdated: (directories: AudioDirectory[]) => void
}

export function DirectoryConfig({ directories, onDirectoriesUpdated }: DirectoryConfigProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [editingDirectories, setEditingDirectories] = useState<AudioDirectory[]>(directories)
  const [newDirectory, setNewDirectory] = useState<AudioDirectory>({
    name: "",
    driveId: "",
    localPath: "",
  })
  const [showAddForm, setShowAddForm] = useState(false)

  const handleDirectoryChange = (index: number, field: keyof AudioDirectory, value: string) => {
    const updated = [...editingDirectories]
    updated[index] = { ...updated[index], [field]: value }
    setEditingDirectories(updated)
  }

  const handleAddDirectory = () => {
    if (!newDirectory.name || !newDirectory.driveId || !newDirectory.localPath) return

    setEditingDirectories([...editingDirectories, newDirectory])
    setNewDirectory({ name: "", driveId: "", localPath: "" })
    setShowAddForm(false)
  }

  const handleRemoveDirectory = (index: number) => {
    setEditingDirectories(editingDirectories.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    onDirectoriesUpdated(editingDirectories)
    setIsOpen(false)
  }

  const handleCancel = () => {
    setEditingDirectories(directories)
    setShowAddForm(false)
    setIsOpen(false)
  }

  const extractFolderIdFromUrl = (url: string): string => {
    // Extract folder ID from Google Drive URL
    const match = url.match(/folders\/([a-zA-Z0-9-_]+)/)
    return match ? match[1] : url
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2 bg-transparent">
          <Settings className="h-4 w-4" />
          Configure Directories
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif">
            <Folder className="h-5 w-5 text-primary" />
            Audio Directory Configuration
          </DialogTitle>
          <DialogDescription>
            Configure Google Drive folders for your audio directories. You can add new directories or update existing
            ones.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing Directories */}
          <div className="space-y-3">
            {editingDirectories.map((directory, index) => (
              <Card key={index}>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor={`name-${index}`}>Directory Name</Label>
                      <Input
                        id={`name-${index}`}
                        value={directory.name}
                        onChange={(e) => handleDirectoryChange(index, "name", e.target.value)}
                        placeholder="e.g., CSAs - Audio"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`driveId-${index}`}>Google Drive Folder ID/URL</Label>
                      <Input
                        id={`driveId-${index}`}
                        value={directory.driveId}
                        onChange={(e) =>
                          handleDirectoryChange(index, "driveId", extractFolderIdFromUrl(e.target.value))
                        }
                        placeholder="Folder ID or full Google Drive URL"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`localPath-${index}`}>Local Path Template</Label>
                      <div className="flex gap-2">
                        <Input
                          id={`localPath-${index}`}
                          value={directory.localPath}
                          onChange={(e) => handleDirectoryChange(index, "localPath", e.target.value)}
                          placeholder="T:\REGFM RadioBOSS\Audio\{audio_filename}"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveDirectory(index)}
                          className="text-destructive hover:text-destructive"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant={directory.driveId ? "default" : "destructive"}>
                      {directory.driveId ? "Configured" : "Not Configured"}
                    </Badge>
                    {directory.driveId && (
                      <span className="text-xs text-muted-foreground">ID: {directory.driveId}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Add New Directory */}
          {showAddForm ? (
            <Card className="border-dashed">
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="new-name">Directory Name</Label>
                    <Input
                      id="new-name"
                      value={newDirectory.name}
                      onChange={(e) => setNewDirectory({ ...newDirectory, name: e.target.value })}
                      placeholder="e.g., Jingles - Audio"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-driveId">Google Drive Folder ID/URL</Label>
                    <Input
                      id="new-driveId"
                      value={newDirectory.driveId}
                      onChange={(e) =>
                        setNewDirectory({ ...newDirectory, driveId: extractFolderIdFromUrl(e.target.value) })
                      }
                      placeholder="Folder ID or full Google Drive URL"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-localPath">Local Path Template</Label>
                    <Input
                      id="new-localPath"
                      value={newDirectory.localPath}
                      onChange={(e) => setNewDirectory({ ...newDirectory, localPath: e.target.value })}
                      placeholder="T:\REGFM RadioBOSS\Jingles\{audio_filename}"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button onClick={handleAddDirectory} size="sm">
                    Add Directory
                  </Button>
                  <Button variant="outline" onClick={() => setShowAddForm(false)} size="sm">
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button
              variant="outline"
              onClick={() => setShowAddForm(true)}
              className="w-full border-dashed flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add New Audio Directory
            </Button>
          )}

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>How to get Google Drive Folder ID:</strong>
              <br />
              1. Open the folder in Google Drive
              <br />
              2. Copy the URL from your browser
              <br />
              3. Paste the full URL here - the folder ID will be extracted automatically
              <br />
              Example: https://drive.google.com/drive/folders/1M4LWyru1Npx-hxdssgPZsQl8gCLNScBx
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
