// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import type { ReactNode } from 'react'
import ErrorBanner from './ErrorBanner'
import PageSkeleton from './PageSkeleton'

type PageLayoutProps = {
  title?: string
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  /** Full-page skeleton; use for pages with no meaningful shell during load. */
  loading?: boolean
  /** Spinner in the content area while keeping header and actions visible. */
  contentLoading?: boolean
  error?: string | null
  errorTitle?: string
  errorHints?: string[]
  technicalDetail?: string | null
  errorTone?: 'amber' | 'red'
  onErrorRetry?: () => void
  onErrorDismiss?: () => void
  emptyState?: ReactNode
  /** Rendered before errors and header (e.g. OpenStack sub-nav). */
  prepend?: ReactNode
  /** Tighter vertical spacing (e.g. embedded platform panels). */
  compact?: boolean
  /** When set, skip the default title row (e.g. page uses `<Hero>` in children). */
  hideHeader?: boolean
  className?: string
  contentClassName?: string
}

function ContentSpinner() {
  return (
    <div className="flex items-center justify-center h-32" aria-busy="true" aria-label="Loading">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  )
}

export default function PageLayout({
  title,
  subtitle,
  icon,
  actions,
  children,
  loading,
  contentLoading,
  error,
  errorTitle,
  errorHints,
  technicalDetail,
  errorTone,
  onErrorRetry,
  onErrorDismiss,
  emptyState,
  prepend,
  hideHeader,
  compact,
  className,
  contentClassName,
}: PageLayoutProps) {
  if (loading) {
    return <PageSkeleton />
  }

  return (
    <div className={`${compact ? 'space-y-4' : 'space-y-6'} animate-fade-in ${className ?? ''}`}>
      {prepend}
      {error ? (
        <ErrorBanner
          title={errorTitle}
          headline={error}
          hints={errorHints}
          technicalDetail={technicalDetail ?? undefined}
          tone={errorTone}
          onRetry={onErrorRetry}
          onDismiss={onErrorDismiss}
        />
      ) : null}

      {!hideHeader ? (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {icon && <span className="shrink-0">{icon}</span>}
            <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
          </div>
          {subtitle && <p className="text-sm text-slate-400 mt-0.5 max-w-2xl">{subtitle}</p>}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      ) : null}

      {contentLoading ? (
        <ContentSpinner />
      ) : emptyState ? (
        emptyState
      ) : (
        <div className={contentClassName ?? ''}>{children}</div>
      )}
    </div>
  )
}
