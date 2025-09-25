"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, AlertCircle, ExternalLink, Copy, Settings } from "lucide-react"
import { useState } from "react"

interface SetupGuideProps {
  onConfigureDirectories: () => void
}

export function SetupGuide({ onConfigureDirectories }: SetupGuideProps) {
  const [copiedStep, setCopiedStep] = useState<number | null>(null)

  const copyToClipboard = (text: string, step: number) => {
    navigator.clipboard.writeText(text)
    setCopiedStep(step)
    setTimeout(() => setCopiedStep(null), 2000)
  }

  const steps = [
    {
      title: "1. Set up Google OAuth",
      description: "Create a Google Cloud project and get your Client ID",
      details: [
        "Go to Google Cloud Console (console.cloud.google.com)",
        "Create a new project or select an existing one",
        "Enable the Google Drive API",
        "Go to APIs & Services → Credentials",
        "Create OAuth 2.0 Client ID credentials",
        "Add your domain to authorized JavaScript origins",
      ],
      code: `# Add to .env.local file
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id-here`,
      isCode: true,
    },
    {
      title: "2. Configure Google Drive Folders",
      description: "Set up your audio directories and playlist folder",
      details: [
        "Create folders in Google Drive for your audio files",
        "Create a folder for your playlists (.m3u8 files)",
        "Get the folder IDs from the URLs",
        "Configure them in the app settings",
      ],
      code: "Click the 'Configure Directories' button below to set up your folders",
      isCode: false,
    },
    {
      title: "3. Test the Setup",
      description: "Verify everything is working correctly",
      details: [
        "Sign in with your Google account",
        "Check that your folders are accessible",
        "Create a test playlist",
        "Add audio files to the playlist",
      ],
      code: "",
      isCode: false,
    },
  ]

  const authorizedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001", 
    "https://localhost:3000",
    "https://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "https://127.0.0.1:3000",
    "https://127.0.0.1:3001",
  ]

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold font-serif">Setup Guide</h1>
        <p className="text-muted-foreground">
          Follow these steps to configure your Audio Playlist Manager
        </p>
      </div>

      {steps.map((step, index) => (
        <Card key={index}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {step.title}
              <Badge variant="outline">Required</Badge>
            </CardTitle>
            <p className="text-muted-foreground">{step.description}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {step.details.map((detail, detailIndex) => (
                <li key={detailIndex} className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm">{detail}</span>
                </li>
              ))}
            </ul>

            {step.code && (
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{step.code}</code>
                </pre>
                {step.isCode && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(step.code, index)}
                  >
                    {copiedStep === index ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Important: Authorized JavaScript Origins
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Make sure to add these origins to your Google OAuth client configuration:
            </AlertDescription>
          </Alert>
          <div className="mt-4 space-y-2">
            {authorizedOrigins.map((origin, index) => (
              <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                <code className="text-sm">{origin}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(origin, 100 + index)}
                >
                  {copiedStep === 100 + index ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={onConfigureDirectories} size="lg" className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Configure Directories
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Need Help?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              If you're having trouble with the setup, check the browser console for detailed error messages.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Open Google Cloud Console
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
