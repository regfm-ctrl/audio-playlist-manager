"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { GoogleAuth } from "@/components/google-auth"
import { PlaylistManager } from "@/components/playlist-manager-v2"
import { ErrorBoundary } from "@/components/error-boundary"
import { SetupGuide } from "@/components/setup-guide"
import { PLAYLIST_FOLDER_ID } from "@/lib/google-drive"

// Re-check / refresh the server-held Google token this often, well inside
// the ~1hr Google access-token lifetime so the UI is never caught out.
const TOKEN_REFRESH_INTERVAL_MS = 20 * 60 * 1000 // 20 minutes

export default function HomePage() {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [showSetupGuide, setShowSetupGuide] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Ask the server for a currently-valid access token. The server refreshes
  // it using the stored refresh token if needed, so this call is silent —
  // no popups, no re-auth, no dependence on the browser's Google session.
  const fetchServerToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/google/token?t=' + Date.now())
      if (!res.ok) return null
      const data = await res.json()
      return data.accessToken ?? null
    } catch (error) {
      console.error("[v0] Failed to fetch server-refreshed Google token:", error)
      return null
    }
  }, [])

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const token = await fetchServerToken()
    setAccessToken(token)
    return token
  }, [fetchServerToken])

  // Check auth on load, then keep silently refreshing in the background.
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const token = await fetchServerToken()
      if (!cancelled) {
        setAccessToken(token)
        setIsCheckingAuth(false)
      }
    }
    init()

    refreshTimer.current = setInterval(() => {
      fetchServerToken().then((token) => {
        if (token) setAccessToken(token)
      })
    }, TOKEN_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      if (refreshTimer.current) clearInterval(refreshTimer.current)
    }
  }, [fetchServerToken])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_auth') === 'success') {
      window.history.replaceState({}, '', '/')
      refreshAccessToken()
    }
  }, [refreshAccessToken])

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("[v0] Unhandled promise rejection:", event.reason)
      event.preventDefault()
    }

    const handleError = (event: ErrorEvent) => {
      console.error("[v0] Global error:", event.error || event.message)
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    window.addEventListener("error", handleError)

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection)
      window.removeEventListener("error", handleError)
    }
  }, [])

  // Called by PlaylistManager when a Drive request comes back unauthorized.
  // Try a silent server-side refresh first — only fall back to the "connect"
  // screen if the server genuinely has no valid token (e.g. refresh token
  // was revoked).
  const handleAuthError = useCallback(async () => {
    console.log("[v0] Drive auth error reported, attempting silent server refresh...")
    const token = await refreshAccessToken()
    if (!token) {
      console.log("[v0] Silent refresh failed, showing connect screen")
    }
  }, [refreshAccessToken])

  const handleConfigureDirectories = () => {
    setShowSetupGuide(false)
  }

  const needsSetup = !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || !PLAYLIST_FOLDER_ID

  return (
    <ErrorBoundary>
      {isCheckingAuth ? (
        <div className="min-h-screen flex items-center justify-center bg-[#f8f8f8]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Checking authentication....</p>
          </div>
        </div>
      ) : needsSetup || showSetupGuide ? (
        <SetupGuide onConfigureDirectories={handleConfigureDirectories} />
      ) : !accessToken ? (
        <GoogleAuth />
      ) : (
        <PlaylistManager accessToken={accessToken} onAuthError={handleAuthError} />
      )}
    </ErrorBoundary>
  )
}
