'use client'

import { Component, type ReactNode } from 'react'

/**
 * One tab that throws must not take the page down with it: the filters, the
 * banner, the other tabs and the export button still work, and the reader is
 * told plainly that this tab could not be drawn. Keyed on the tab by the page,
 * so switching tabs starts clean.
 */
export class TabErrorBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err: unknown) {
    console.error('[finance] a tab failed to render:', err)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-6 text-center text-sm">
        <p className="font-medium text-red-700 dark:text-red-400">
          The {this.props.label} tab could not be drawn. No figure on it is shown, rather than a wrong one.
        </p>
        <p className="mt-1 text-muted-foreground">
          The other tabs still work. Nothing was changed.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="mt-3 rounded-md border border-border bg-card px-3 py-1 text-[13px] hover:bg-accent"
        >
          Try again
        </button>
      </div>
    )
  }
}
