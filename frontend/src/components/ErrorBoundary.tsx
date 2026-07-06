import { Component, type ReactNode, type ErrorInfo } from 'react'

type Props = { children: ReactNode; fallback?: ReactNode; name?: string }
type State = { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[ErrorBoundary${this.props.name ? ':' + this.props.name : ''}]`, error.message, error.stack)
    if (info.componentStack) {
      console.warn('[ErrorBoundary] componentStack:', info.componentStack)
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          Une erreur est survenue
        </div>
      )
    }
    return this.props.children
  }
}
