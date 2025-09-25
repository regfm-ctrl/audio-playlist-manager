"use client"

import { useState, useEffect } from "react"
import { GoogleAuth } from "@/components/google-auth"
import { PlaylistManager } from "@/components/playlist-manager"
import { ErrorBoundary } from "@/components/error-boundary"
import { SetupGuide } from "@/components/setup-guide"
import { googleDriveService, PLAYLIST_FOLDER_ID } from "@/lib/google-drive"

export default function HomePage() {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [showSetupGuide, setShowSetupGuide] = useState(false)

  // Check for existing authentication on page load
  useEffect(() => {
    const checkExistingAuth = () => {
      try {
        console.log("[v0] Checking for existing authentication...")
        const sessionInfo = googleDriveService.getSessionInfo()
        console.log("[v0] Session info:", sessionInfo)
        
        const storedToken = googleDriveService.loadTokenFromStorage()
        if (storedToken) {
          console.log("[v0] Found existing token, auto-authenticating")
          setAccessToken(storedToken)
        } else {
          console.log("[v0] No existing token found")
        }
      } catch (error) {
        console.error("[v0] Error checking existing auth:", error)
      } finally {
        setIsCheckingAuth(false)
      }
    }

    checkExistingAuth()
  }, [])

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("[v0] Unhandled promise rejection:", event.reason)

      // Prevent the default browser behavior (logging to console)
      event.preventDefault()

      // Show user-friendly error message
      const errorMessage =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === "string"
            ? event.reason
            : "An unexpected error occurred"

      console.error("[v0] Promise rejection details:", {
        reason: event.reason,
        promise: event.promise,
        stack: event.reason?.stack,
      })

      // You could also show a toast notification here
      // For now, we'll just ensure it's properly logged
    }

    const handleError = (event: ErrorEvent) => {
      console.error("[v0] Global error:", event.error || event.message)
    }

    // Add global error handlers
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    window.addEventListener("error", handleError)

    // Cleanup
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection)
      window.removeEventListener("error", handleError)
    }
  }, [])

  const handleAuthenticated = (token: string) => {
    console.log("[v0] Authentication successful, setting access token")
    setAccessToken(token)
  }

  const handleAuthError = () => {
    console.log("[v0] Authentication error detected, clearing token and showing auth screen")
    setAccessToken(null)
    // Clear authentication state in the service
    googleDriveService.clearAuthentication()
  }

  const handleConfigureDirectories = () => {
    setShowSetupGuide(false)
    // This will be handled by the PlaylistManager component
  }

  // Check if we need to show setup guide
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
        <GoogleAuth onAuthenticated={handleAuthenticated} />
      ) : (
        <PlaylistManager accessToken={accessToken} onAuthError={handleAuthError} />
      )}
    </ErrorBoundary>
  )
}
