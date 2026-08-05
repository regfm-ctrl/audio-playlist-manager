"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield } from "lucide-react"

// This screen only ever appears when the server has no stored Google
// refresh token at all (first-time setup, or the token was revoked).
// Day-to-day, the app pulls a fresh access token from /api/auth/google/token,
// which the server keeps valid using the stored refresh token — so this
// screen should not reappear on its own after the first connect.
export function GoogleAuth() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-serif text-2xl">REGFM - RadioBOSS Sponsorship Scheduler</CardTitle>
          <CardDescription className="text-balance">
            Connect to Google Drive to manage sponsorship break playlists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild className="w-full" size="lg">
            <a href="/api/auth/google">Connect Google Drive</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
