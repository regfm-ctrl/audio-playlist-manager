"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { googleDriveService } from "@/lib/google-drive"
import { Loader2, Shield, AlertCircle } from "lucide-react"

interface GoogleAuthProps {
  onAuthenticated: (accessToken: string) => void
}

export function GoogleAuth({ onAuthenticated }: GoogleAuthProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOriginError, setIsOriginError] = useState(false)

  useEffect(() => {
    const initializeGoogleAPI = async () => {
      try {
        console.log("[v0] Starting Google API initialization")
        console.log("[v0] Current window location:", window.location.href)

        const existingScript = document.querySelector('script[src*="accounts.google.com"]')
        if (existingScript) {
          console.log("[v0] Removing existing Google Identity Services script")
          existingScript.remove()
        }

        if (window.google) {
          console.log("[v0] Clearing existing Google Identity Services instance")
          delete window.google
        }

        const script = document.createElement("script")
        script.src = "https://accounts.google.com/gsi/client"
        script.async = true
        script.defer = true

        const scriptPromise = new Promise<void>((resolve, reject) => {
          script.onload = () => {
            console.log("[v0] Google Identity Services script loaded successfully")
            // Wait a bit for the library to initialize
            setTimeout(() => {
              if (window.google?.accounts?.oauth2) {
                console.log("[v0] Google Identity Services is ready")
                resolve()
              } else {
                reject(new Error("Google Identity Services not available after loading"))
              }
            }, 100)
          }
          script.onerror = (error) => {
            console.error("[v0] Failed to load Google Identity Services script:", error)
            reject(new Error("Failed to load Google Identity Services script"))
          }
          script.onabort = () => {
            console.error("[v0] Google Identity Services script loading aborted")
            reject(new Error("Google Identity Services script loading was aborted"))
          }
        })

        document.head.appendChild(script)

        await scriptPromise

        console.log("[v0] Initializing Google Drive service...")
        // Clear any existing authentication state first
        googleDriveService.clearAuthentication()
        await googleDriveService.authenticate()
        console.log("[v0] Google Drive service initialized successfully")

        setIsInitialized(true)
        setError(null)
        setIsOriginError(false)
      } catch (error) {
        console.error("[v0] Google API initialization failed:", error)
        const errorMessage = error instanceof Error ? error.message : "Failed to initialize Google API"

        if (errorMessage.includes("idpiframe_initialization_failed") || errorMessage.includes("Not a valid origin")) {
          setIsOriginError(true)
          setError("OAuth configuration error: This URL needs to be authorized in Google Cloud Console.")
        } else {
          setIsOriginError(false)
          setError(errorMessage)
        }
        setIsInitialized(false)
      }
    }

    initializeGoogleAPI()

    return () => {
      const existingScripts = document.querySelectorAll('script[src*="accounts.google.com"]')
      existingScripts.forEach((script) => {
        if (script.parentNode) {
          script.parentNode.removeChild(script)
        }
      })

      if (window.google) {
        delete window.google
      }
    }
  }, [])

  const handleSignIn = async () => {
    setIsLoading(true)
    setError(null)

    try {
      console.log("[v0] Starting sign-in process")
      console.log("[v0] Current URL:", window.location.href)
      console.log("[v0] Current origin:", window.location.origin)

      if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
        throw new Error(
          "Google Client ID is not configured. Please add NEXT_PUBLIC_GOOGLE_CLIENT_ID to your environment variables.",
        )
      }

      console.log("[v0] Client ID:", process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)

      // Check if Google Identity Services is available
      if (!window.google?.accounts?.oauth2) {
        throw new Error(
          "Google Identity Services is not loaded. Please refresh the page and try again."
        )
      }

      console.log("[v0] Google Identity Services is available, proceeding with sign-in...")
      const accessToken = await googleDriveService.signIn()
      console.log("[v0] Sign-in successful")
      onAuthenticated(accessToken)
    } catch (error) {
      console.error("[v0] Authentication failed:", error)
      const errorMessage = error instanceof Error ? error.message : "Authentication failed. Please try again."
      
      // Check for specific error types
      if (errorMessage.includes("popup_blocked")) {
        setError("Sign-in popup was blocked. Please allow popups for this site and try again.")
      } else if (errorMessage.includes("access_denied")) {
        setError("Sign-in was cancelled or access was denied.")
      } else if (errorMessage.includes("Not a valid origin")) {
        setIsOriginError(true)
        setError("OAuth configuration error: This URL needs to be authorized in Google Cloud Console.")
      } else {
        setError(errorMessage)
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-serif text-2xl">Audio Playlist Manager</CardTitle>
          <CardDescription className="text-balance">
            Connect to your Google Drive to manage audio playlists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error}
                {isOriginError && (
                  <div className="mt-3 space-y-2">
                    <p className="font-medium">To fix this:</p>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>
                        Go to{" "}
                        <a
                          href="https://console.cloud.google.com/apis/credentials"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          Google Cloud Console
                        </a>
                      </li>
                      <li>Edit your OAuth 2.0 Client ID</li>
                      <li>Add this URL to "Authorized JavaScript origins":</li>
                    </ol>
                    <code className="block bg-muted p-2 rounded text-xs break-all">{window.location.origin}</code>
                    <p className="text-xs text-muted-foreground mt-2">
                      Client ID: {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Or add <code>https://*.vusercontent.net</code> to work with all v0 previews.
                    </p>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {isOriginError ? (
            <div className="space-y-2">
              <Button
                onClick={() => {
                  localStorage.clear()
                  sessionStorage.clear()
                  window.location.reload()
                }}
                variant="outline"
                className="w-full"
                size="lg"
              >
                Clear Cache & Retry
              </Button>
              <Button onClick={() => window.location.reload()} variant="secondary" className="w-full" size="lg">
                Retry After Updating OAuth Settings
              </Button>
            </div>
          ) : (
            <Button onClick={handleSignIn} disabled={!isInitialized || isLoading} className="w-full" size="lg">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect Google Drive"
              )}
            </Button>
          )}

          {!isInitialized && !error && (
            <p className="text-center text-sm text-muted-foreground">Loading Google API...</p>
          )}

          {!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Google Client ID is not configured. Please add your NEXT_PUBLIC_GOOGLE_CLIENT_ID environment variable.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
