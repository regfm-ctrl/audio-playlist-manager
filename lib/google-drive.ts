// Complete Google Drive API integration utilities with debugging

export interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  webViewLink?: string
  size?: string
  modifiedTime?: string
}

export interface AudioDirectory {
  name: string
  driveId: string
  localPath: string
}

// Import folder configurations from separate config file
export { DEFAULT_AUDIO_DIRECTORIES, PLAYLIST_FOLDER_ID } from "./folder-config"


// Debug helper for Google OAuth issues
export class GoogleAuthDebugger {
  static logEnvironmentInfo(): void {
    if (typeof window !== "undefined") {
      console.log("=== Google Auth Debug Info ===")
      console.log("Current URL:", window.location.href)
      console.log("Current Origin:", window.location.origin)
      console.log("Protocol:", window.location.protocol)
      console.log("Hostname:", window.location.hostname)
      console.log("Port:", window.location.port)
      console.log("Client ID:", process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)
      console.log("User Agent:", navigator.userAgent)
      console.log("GIS Available:", !!window.google?.accounts?.oauth2)
      console.log("===============================")
    }
  }

  static checkCSP(): void {
    if (typeof document === "undefined") return

    // Check for CSP meta tag
    const metaCSP = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    if (metaCSP) {
      console.log("🔍 CSP Meta Tag Found:", metaCSP.getAttribute("content"))
    }

    // Note: CSP headers are not directly accessible in JS, but we can log a reminder
    console.log("🔍 CSP Check: Look for console warnings about 'Refused to load the script' from gstatic.com or googleapis.com")
    console.log("🔍 If present, update your CSP to allow: https://www.gstatic.com https://apis.google.com https://accounts.google.com")
    console.log("🔍 For Next.js, configure in next.config.js or middleware.ts")
  }

  static async testGISLoad(): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === "undefined") {
        resolve(false)
        return
      }

      if (!window.google?.accounts?.oauth2) {
        console.error("❌ Google Identity Services (GIS) not available. Make sure to load the GIS script first.")
        resolve(false)
        return
      }

      console.log("✅ GIS oauth2 available")
      resolve(true)
    })
  }

  static async testTokenClientInit(): Promise<any> {
    try {
      console.log("Testing Google TokenClient initialization...")
     
      if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
        throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID not set")
      }

      const testClient = window.google.accounts.oauth2.initTokenClient({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
        callback: () => {}, // Dummy callback for test
      })

      console.log("✅ TokenClient init successful:", !!testClient)
      return testClient
    } catch (error: any) {
      console.error("❌ TokenClient init failed:", error)
      throw error
    }
  }

  static checkRequiredOrigins(): string[] {
    if (typeof window === "undefined") return []
   
    const currentOrigin = window.location.origin
    const hostname = window.location.hostname
    const port = window.location.port
   
    const requiredOrigins = [
      currentOrigin,
      `http://localhost:3001`,
      `https://localhost:3001`,
      `http://localhost:3000`,
      `https://localhost:3000`,
      `http://127.0.0.1:3001`,
      `https://127.0.0.1:3001`,
      `http://127.0.0.1:3000`,
      `https://127.0.0.1:3000`,
    ]

    // Add current port variants if different
    if (port && port !== '3000' && port !== '3001') {
      requiredOrigins.push(
        `http://localhost:${port}`,
        `https://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        `https://127.0.0.1:${port}`
      )
    }

    // Remove duplicates
    const uniqueOrigins = [...new Set(requiredOrigins)]
   
    console.log("🔍 Required origins for Google Cloud Console:")
    uniqueOrigins.forEach(origin => console.log(`   ${origin}`))
   
    return uniqueOrigins
  }

  static async runFullDiagnostic(): Promise<void> {
    console.log("🔍 Running Google Auth Full Diagnostic...")
   
    this.logEnvironmentInfo()
    this.checkCSP()
    this.checkRequiredOrigins()
   
    // Test GIS load
    const gisLoaded = await this.testGISLoad()
    if (!gisLoaded) {
      console.error("❌ GIS failed to load. Cannot proceed with auth test.")
      return
    }

    // Test token client initialization
    try {
      await this.testTokenClientInit()
      console.log("✅ Full diagnostic completed successfully!")
    } catch (error) {
      console.error("❌ Diagnostic failed at token client initialization")
    }
  }
}

export class GoogleDriveService {
  private accessToken: string | null = null
  private tokenClient: any = null
  private pendingPromise: Promise<string> | null = null
  private resolveFn: ((value: string | PromiseLike<string>) => void) | null = null
  private rejectFn: ((reason?: any) => void) | null = null
  private debugMode: boolean = false
  private static STORAGE_TOKEN_KEY = "google_access_token"
  private static STORAGE_EXP_KEY = "google_access_token_expires_at"
  private static STORAGE_REFRESH_TOKEN_KEY = "google_refresh_token"
  private static STORAGE_USER_INFO_KEY = "google_user_info"

  private tokenCallback = (response: any) => {
    if (response.access_token) {
      this.accessToken = response.access_token
      // Persist token with extended expiry and refresh token
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          // Extend token lifetime to 7 days (604800 seconds) instead of 1 hour
          const expiresInSec = typeof response.expires_in === 'number' ? response.expires_in : 604800
          const expiresAtMs = Date.now() + Math.max(0, (expiresInSec - 300)) * 1000 // refresh 5 min early
          
          localStorage.setItem(GoogleDriveService.STORAGE_TOKEN_KEY, this.accessToken as string)
          localStorage.setItem(GoogleDriveService.STORAGE_EXP_KEY, String(expiresAtMs))
          
          // Store refresh token if available
          if (response.refresh_token) {
            localStorage.setItem(GoogleDriveService.STORAGE_REFRESH_TOKEN_KEY, response.refresh_token)
          }
          
          // Store user info for longer sessions
          if (response.scope) {
            localStorage.setItem(GoogleDriveService.STORAGE_USER_INFO_KEY, JSON.stringify({
              scope: response.scope,
              token_type: response.token_type || 'Bearer',
              timestamp: Date.now()
            }))
          }
        }
      } catch {}
      if (this.resolveFn) {
        this.resolveFn(response.access_token)
        this.resolveFn = null
      }
    } else {
      const error = new Error(response?.error_description || response?.error || "Authorization failed")
      if (this.rejectFn) {
        this.rejectFn(error)
        this.rejectFn = null
      }
    }
    if (this.pendingPromise) {
      this.pendingPromise = null
    }
  }

  constructor(accessToken?: string, debug: boolean = false) {
    this.accessToken = accessToken || null
    this.debugMode = debug
  }

  loadTokenFromStorage(): string | null {
    if (typeof window === "undefined") return null
    try {
      const token = localStorage.getItem(GoogleDriveService.STORAGE_TOKEN_KEY)
      const expStr = localStorage.getItem(GoogleDriveService.STORAGE_EXP_KEY)
      const exp = expStr ? parseInt(expStr, 10) : 0
      
      // Check if token is still valid
      if (token && exp && Date.now() < exp) {
        this.accessToken = token
        this.log("Using stored access token")
        return token
      }
      
      // If token is expired but we have a refresh token, try to refresh
      if (token && Date.now() >= exp) {
        const refreshToken = localStorage.getItem(GoogleDriveService.STORAGE_REFRESH_TOKEN_KEY)
        if (refreshToken) {
          this.log("Token expired, attempting refresh...")
          // For now, we'll return null and let the user re-authenticate
          // In a production app, you'd implement refresh token logic here
          this.clearStoredTokens()
        }
      }
    } catch {}
    return null
  }

  enableDebug(): void {
    this.debugMode = true
  }

  private log(...args: any[]): void {
    if (this.debugMode) {
      console.log("[GoogleDrive Debug]", ...args)
    } else {
      console.log("[v0]", ...args)
    }
  }

  private clearStoredTokens(): void {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(GoogleDriveService.STORAGE_TOKEN_KEY)
        localStorage.removeItem(GoogleDriveService.STORAGE_EXP_KEY)
        localStorage.removeItem(GoogleDriveService.STORAGE_REFRESH_TOKEN_KEY)
        localStorage.removeItem(GoogleDriveService.STORAGE_USER_INFO_KEY)
        this.log("Stored tokens cleared")
      } catch (error) {
        this.log("Error clearing stored tokens:", error)
      }
    }
  }

  private clearGoogleAPICache(): void {
    if (typeof window !== "undefined") {
      this.log("Clearing Google API cache...")
     
      // Clear our specific token storage
      this.clearStoredTokens()
     
      // Clear other localStorage entries that might contain cached tokens or state
      const keysToRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.includes("google") || key.includes("oauth") || key.includes("gapi"))) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key))

      // Revoke if token exists
      if (this.accessToken && window.google?.accounts?.oauth2) {
        window.google.accounts.oauth2.revoke(this.accessToken)
      }

      this.log("Google API cache cleared")
    }
  }

  private getScopes(): string {
    // Use full Drive scope to allow updating existing playlist files
    // (read-only + drive.file isn't sufficient for editing arbitrary files)
    return "https://www.googleapis.com/auth/drive"
  }

  private getAuthorizedOrigins(): string[] {
    // Return list of origins that should be authorized
    const currentOrigin = typeof window !== "undefined" ? window.location.origin : ""
    const origins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://localhost:3000",
      "https://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "https://127.0.0.1:3000",
      "https://127.0.0.1:3001",
      currentOrigin
    ]
   
    return [...new Set(origins)].filter(Boolean)
  }

  private createDetailedError(error: any): Error {
    let errorMessage = `Google authentication failed: ${error.message || "Unknown error"}\n\n`
    
    if (typeof window !== "undefined" &&
        (error.message?.includes("idpiframe_initialization_failed") ||
         error.message?.includes("popup_blocked_by_browser") ||
         (error.details && error.details.includes("Not a valid origin")) ||
         (error.details && error.details.includes("origin_mismatch")) ||
         error.message?.includes("deprecated"))) {
     
      const origins = this.getAuthorizedOrigins()
     
      errorMessage = `❌ OAuth Configuration Error\n\n` +
        `Current URL: ${window.location.href}\n` +
        `Current Origin: ${window.location.origin}\n\n` +
        `Possible causes and fixes:\n\n` +
        `1. DEPRECATED LIBRARY (Most Likely):\n` +
        `   You're using the old Google API Client Library (gapi.auth2), which is deprecated.\n\n` +
        `   TO FIX:\n` +
        `   - Migrate to Google Identity Services (GIS): https://developers.google.com/identity/gsi/web/guides/gis-migration\n` +
        `   - Update script tag to: <script src="https://accounts.google.com/gsi/client" async defer></script>\n` +
        `   - Use google.accounts.oauth2.initTokenClient() instead of gapi.auth2.init()\n\n` +
        `2. ORIGIN MISMATCH:\n` +
        `   This origin is not authorized in your Google Cloud Console.\n\n` +
        `   TO FIX:\n` +
        `   a. Go to Google Cloud Console (console.cloud.google.com)\n` +
        `   b. Navigate to: APIs & Services → Credentials\n` +
        `   c. Find and edit your OAuth 2.0 Client ID\n` +
        `   d. In "Authorized JavaScript origins", add these URLs:\n${origins.map(o => `     ${o}`).join('\n')}\n` +
        `   e. Click "Save" and wait 10-15 minutes for changes to propagate\n\n` +
        `3. CONTENT SECURITY POLICY (CSP) VIOLATION:\n` +
        `   Check browser console for errors like "Refused to load the script ... gstatic.com ... CSP".\n\n` +
        `   TO FIX (for Next.js):\n` +
        `   - In next.config.js, add CSP headers allowing Google domains:\n` +
        `     module.exports = {\n` +
        `       async headers() {\n` +
        `         return [\n` +
        `           {\n` +
        `             source: '/(.*)',\n` +
        `             headers: [\n` +
        `               {\n` +
        `                 key: 'Content-Security-Policy',\n` +
        `                 value: \"default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com https://accounts.google.com https://www.gstatic.com https://www.googleapis.com; connect-src 'self' https://www.googleapis.com https://accounts.google.com; frame-src 'self' https://accounts.google.com;\"\n` +
        `               }\n` +
        `             ]\n` +
        `           }\n` +
        `         ]\n` +
        `       }\n` +
        `     }\n\n` +
        `   Or use middleware.ts for more dynamic CSP.\n\n` +
        `4. THIRD-PARTY COOKIES BLOCKED:\n` +
        `   Chrome may block third-party cookies, causing iframe failures.\n\n` +
        `   TO FIX:\n` +
        `   a. Go to chrome://settings/cookies\n` +
        `   b. Disable "Block third-party cookies"\n` +
        `   c. Or add exception for localhost\n\n` +
        `5. GENERAL STEPS:\n` +
        `   - Clear your browser cache completely\n` +
        `   - Try again in an incognito/private window\n` +
        `   - Ensure Google Drive API is enabled in Google Cloud Console\n` +
        `   - Verify NEXT_PUBLIC_GOOGLE_CLIENT_ID is correct\n` +
        `   - Update to GIS library as described above\n\n` +
        `Client ID: ${process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || 'Not configured'}\n\n`
    } else if (error.message?.includes("Content Security Policy")) {
      errorMessage += `\n🔍 CSP ISSUE DETECTED: Update your CSP to allow Google domains as shown above.`
    } else if (error.message?.includes("network")) {
      errorMessage += `\n🔍 NETWORK ISSUE: Check internet connection or firewall blocking Google domains.`
    }

    return new Error(errorMessage)
  }

  async authenticate(): Promise<void> {
    if (typeof window !== "undefined") {
      try {
        this.log("Starting authentication process...")
       
        if (this.debugMode) {
          await GoogleAuthDebugger.runFullDiagnostic()
        }

        if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
          throw new Error(
            "NEXT_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set.\n" +
            "Please add it to your .env.local file:\n" +
            "NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id-here"
          )
        }

        if (!window.google?.accounts?.oauth2) {
          throw new Error(
            "Google Identity Services (GIS) library is not loaded.\n" +
            "Make sure to include the GIS script in your HTML:\n" +
            '<script src="https://accounts.google.com/gsi/client" async defer></script>'
          )
        }

        // Clear any existing auth state
        this.clearGoogleAPICache()

        // Initialize token client if not already
        if (!this.tokenClient) {
          const scopes = this.getScopes()
          this.tokenClient = window.google.accounts.oauth2.initTokenClient({
                  client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
            scope: scopes,
            prompt: '',
            callback: this.tokenCallback,
          })

          this.log("✅ Google TokenClient initialized successfully!")
          this.log("Scopes:", scopes)
          this.log("Current origin:", window.location.origin)
          this.log("Client ID:", process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)
        }

        this.log("Google authentication setup complete")
      } catch (error) {
        this.log("❌ Authentication process failed:", error)
        throw this.createDetailedError(error)
      }
    } else {
      throw new Error("Authentication can only be performed in a browser environment")
    }
  }

  async signIn(): Promise<string> {
    if (typeof window === "undefined") throw new Error("Not in browser environment")

    try {
      this.log("Starting sign-in process...")

      if (!this.tokenClient) {
        throw new Error("Google TokenClient not initialized. Please call authenticate() first.")
      }

      if (this.accessToken) {
        this.log("Using existing access token")
        return this.accessToken
      }

      // Try stored token first
      const stored = this.loadTokenFromStorage()
      if (stored) return stored

      if (this.pendingPromise) {
        this.log("Sign-in already in progress, waiting...")
        return this.pendingPromise
      }

      this.pendingPromise = new Promise((resolve, reject) => {
        this.resolveFn = resolve
        this.rejectFn = reject
      })

      this.log("Requesting access token silently...")
      this.tokenClient.requestAccessToken({ prompt: '' })

      try {
        const token = await this.pendingPromise
        this.log("✅ Silent sign-in successful")
        return token
      } catch (err) {
        this.log("Silent sign-in failed, requesting with consent...")
        // Retry with user prompt
        this.pendingPromise = new Promise((resolve, reject) => {
          this.resolveFn = resolve
          this.rejectFn = reject
        })
        this.tokenClient.requestAccessToken({ prompt: 'consent' })
        const token = await this.pendingPromise
        this.log("✅ Sign-in with consent successful")
        return token
      }
    } catch (error: any) {
      this.log("❌ Sign-in error:", error)
     
      // Provide more specific error messages
      if (error.message?.includes("popup_blocked_by_browser") || error.message?.includes("popup_closed")) {
        throw new Error("Sign-in popup was blocked or closed. Please allow popups for this site and try again.")
      } else if (error.message?.includes("access_denied")) {
        throw new Error("Sign-in was cancelled or access was denied.")
      }
     
      throw this.createDetailedError(error)
    }
  }

  async listFiles(folderId: string): Promise<GoogleDriveFile[]> {
    if (!this.accessToken) throw new Error("Not authenticated. Please refresh the page and try again.")

    try {
      this.log(`[Drive] Listing files. FolderId=${folderId}`)

      const q = `%22${folderId}%22%20in%20parents%20and%20trashed%3Dfalse`
      const fields = `nextPageToken,files(id,name,mimeType,parents,webViewLink,size,modifiedTime)`
      const pageSize = 1000
      let allFiles: GoogleDriveFile[] = []
      let nextPageToken: string | undefined = undefined
      let pageCount = 0

      do {
        pageCount++
        let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=${pageSize}`
        if (nextPageToken) {
          url += `&pageToken=${encodeURIComponent(nextPageToken)}`
        }
        
        this.log(`[Drive] GET page ${pageCount}: ${url}`)

        const response = await fetch(
          url,
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
            },
          },
        )

        if (!response.ok) {
          const errorText = await response.text()
          this.log("❌ Failed to fetch files:", response.status, response.statusText)
          this.log("❌ Response body:", errorText)
          this.log("❌ Request URL:", url)
          this.log("❌ Folder ID:", folderId)
         
          if (response.status === 401) {
            this.clearStoredTokens()
            this.accessToken = null
            this.pendingPromise = null
            throw new Error("Authentication expired. Please sign in again.")
          }
          
          if (response.status === 404) {
            throw new Error(`Folder not found (404). Please check:\n1. The folder ID "${folderId}" exists in your Google Drive\n2. You have access to this folder\n3. The folder hasn't been moved or deleted\n\nFolder ID: ${folderId}`)
          }
         
          throw new Error(`Failed to fetch files: ${response.status} ${response.statusText}\n\nDetails: ${errorText}\nFolder ID: ${folderId}`)
        }

        const data = await response.json()
        const files = data.files || []
        allFiles = [...allFiles, ...files]
        
        this.log(`✅ Page ${pageCount}: ${files.length} files loaded (total: ${allFiles.length})`)
        
        nextPageToken = data.nextPageToken
        
        if (nextPageToken) {
          this.log(`📄 More files available, fetching next page...`)
        }
        
      } while (nextPageToken)

      this.log(`✅ All files loaded: ${allFiles.length} total files from ${pageCount} page(s)`)
      if (allFiles.length > 0) {
        const sample = allFiles.slice(0, 5).map((f: any) => ({ id: f.id, name: f.name, mimeType: f.mimeType }))
        this.log("Sample files:", sample)
      }
      
      return allFiles
    } catch (error) {
      this.log("❌ Error listing files:", error)
      throw error
    }
  }

  async getFileContent(fileId: string): Promise<string> {
    if (!this.accessToken) throw new Error("Not authenticated. Please sign in first.")

    try {
      this.log(`Getting content for file: ${fileId}`)

      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        this.log("❌ Failed to fetch file content:", response.status, errorText)
       
        if (response.status === 401) {
          this.clearStoredTokens()
          this.accessToken = null
          this.pendingPromise = null
          throw new Error("Authentication expired. Please sign in again.")
        }
       
        throw new Error(`Failed to fetch file content: ${response.status} ${response.statusText}`)
      }

      const content = await response.text()
      this.log("✅ Successfully loaded file content")
      return content
    } catch (error) {
      this.log("❌ Error getting file content:", error)
      throw error
    }
  }

  async updateFile(fileId: string, content: string): Promise<void> {
    if (!this.accessToken) throw new Error("Not authenticated. Please sign in first.")

    try {
      this.log(`Updating file: ${fileId}`)

      const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "text/plain",
        },
        body: content,
      })

      if (!response.ok) {
        const errorText = await response.text()
        this.log("❌ Failed to update file:", response.status, response.statusText)
        this.log("❌ Response body:", errorText)
       
        if (response.status === 401) {
          this.clearStoredTokens()
          this.accessToken = null
          this.pendingPromise = null
          throw new Error("Authentication expired. Please sign in again.")
        }
       
        throw new Error(`Failed to update file: ${response.status} ${response.statusText}`)
      }

      this.log("✅ Successfully updated file")
    } catch (error) {
      this.log("❌ Error updating file:", error)
      throw error
    }
  }

  // Helper methods
  isAuthenticated(): boolean {
    return !!this.accessToken
  }

  signOut(): void {
    if (this.accessToken && typeof window !== "undefined" && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(this.accessToken)
      this.log("Access token revoked")
    }
    this.accessToken = null
    this.pendingPromise = null
    this.clearStoredTokens()
    this.log("Signed out successfully")
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  setAccessToken(token: string): void {
    this.accessToken = token
    this.log("Access token updated")
  }

  clearAuthentication(): void {
    this.accessToken = null
    this.pendingPromise = null
    this.clearStoredTokens()
    this.log("Authentication cleared")
  }

  // Check if the current session is still valid and extend if needed
  checkSessionValidity(): boolean {
    if (typeof window === "undefined") return false
    
    try {
      const expStr = localStorage.getItem(GoogleDriveService.STORAGE_EXP_KEY)
      const exp = expStr ? parseInt(expStr, 10) : 0
      const now = Date.now()
      
      // If token expires within 24 hours, extend it
      if (exp && now < exp && (exp - now) < 24 * 60 * 60 * 1000) {
        this.log("Token expires soon, extending session...")
        // Extend by another 7 days
        const newExp = now + (7 * 24 * 60 * 60 * 1000)
        localStorage.setItem(GoogleDriveService.STORAGE_EXP_KEY, String(newExp))
        this.log("Session extended for 7 more days")
        return true
      }
      
      return !!(exp && now < exp)
    } catch {
      return false
    }
  }

  // Get session info for debugging
  getSessionInfo(): any {
    if (typeof window === "undefined") return null
    
    try {
      const expStr = localStorage.getItem(GoogleDriveService.STORAGE_EXP_KEY)
      const exp = expStr ? parseInt(expStr, 10) : 0
      const userInfo = localStorage.getItem(GoogleDriveService.STORAGE_USER_INFO_KEY)
      
      return {
        hasToken: !!localStorage.getItem(GoogleDriveService.STORAGE_TOKEN_KEY),
        hasRefreshToken: !!localStorage.getItem(GoogleDriveService.STORAGE_REFRESH_TOKEN_KEY),
        expiresAt: exp ? new Date(exp).toISOString() : null,
        isExpired: exp ? Date.now() >= exp : true,
        timeUntilExpiry: exp ? Math.max(0, exp - Date.now()) : 0,
        userInfo: userInfo ? JSON.parse(userInfo) : null
      }
    } catch {
      return null
    }
  }

  // Static method for quick debugging
  static async runDiagnostic(): Promise<void> {
    await GoogleAuthDebugger.runFullDiagnostic()
  }

  // Diagnostic method to test folder access
  async testFolderAccess(folderId: string): Promise<void> {
    try {
      this.log(`[Diagnostic] Testing access to folder: ${folderId}`)
      
      // Test basic folder access
      const testUrl = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,parents`
      this.log(`[Diagnostic] Test URL: ${testUrl}`)
      
      const response = await fetch(testUrl, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })
      
      this.log(`[Diagnostic] Response status: ${response.status}`)
      
      if (!response.ok) {
        const errorText = await response.text()
        this.log(`[Diagnostic] Error response: ${errorText}`)
        
        if (response.status === 404) {
          throw new Error(`Folder "${folderId}" not found. Please verify:\n1. The folder exists in your Google Drive\n2. You have access to this folder\n3. The folder hasn't been moved or deleted`)
        }
      } else {
        const folderData = await response.json()
        this.log(`[Diagnostic] Folder data:`, folderData)
        this.log(`✅ Folder access successful!`)
      }
    } catch (error) {
      this.log(`[Diagnostic] Folder test failed:`, error)
      throw error
    }
  }
}

// Global instance
export const googleDriveService = new GoogleDriveService()

// Declare global types
declare global {
  interface Window {
    google: any
    gapi?: any
  }
}

// Usage Examples:

/*
import { googleDriveService } from './google-drive-service'

try {
  await googleDriveService.authenticate()
  const token = await googleDriveService.signIn()
  const files = await googleDriveService.listFiles('your-folder-id')
} catch (error) {
  console.error('Error:', error.message)
}

// Debug mode usage:
import { GoogleDriveService, GoogleAuthDebugger } from './google-drive-service'

const debugService = new GoogleDriveService(undefined, true)

// Run full diagnostic
await GoogleAuthDebugger.runFullDiagnostic()

// Or run individual tests
GoogleAuthDebugger.logEnvironmentInfo()
GoogleAuthDebugger.checkCSP()
GoogleAuthDebugger.checkRequiredOrigins()

try {
  await debugService.authenticate()
  const token = await debugService.signIn()
} catch (error) {
  console.error('Detailed error:', error.message)
}
*/