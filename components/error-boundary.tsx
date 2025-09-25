"use client"

import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[v0] Error boundary caught an error:", error, errorInfo)
    this.setState({ error, errorInfo })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback

      if (FallbackComponent && this.state.error) {
        return <FallbackComponent error={this.state.error} retry={this.handleRetry} />
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle className="font-serif text-2xl">Something went wrong</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{this.state.error?.message || "An unexpected error occurred"}</AlertDescription>
              </Alert>

              <Button onClick={this.handleRetry} className="w-full" size="lg">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Technical Details
                </summary>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">{this.state.error?.stack}</pre>
              </details>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
