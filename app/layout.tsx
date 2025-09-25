import type React from "react"
import type { Metadata } from "next"
import { Space_Grotesk, DM_Sans } from "next/font/google"
import Script from "next/script"
import { Analytics } from "@vercel/analytics/next"
import { Suspense } from "react"
import { Toaster } from "@/components/ui/toaster"
import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
})

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600"],
})

export const metadata: Metadata = {
  title: "Audio Playlist Manager",
  description: "Manage your Google Drive audio playlists with ease",
  generator: "v0.app",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${spaceGrotesk.variable} ${dmSans.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"  // Loads after page is interactive; alternatives: 'beforeInteractive' or 'lazyOnload'
          />
          <Suspense fallback={null}>{children}</Suspense>
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}
