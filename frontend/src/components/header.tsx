'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from './theme-toggle'

type ViewMode = 'all' | 'p2p'

interface HeaderProps {
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
}

export function Header({ viewMode, onViewModeChange }: HeaderProps) {
  const showToggle = viewMode !== undefined && onViewModeChange !== undefined
  return (
    <header className="bg-card border-b border-border">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80">
            <Image src="/web-app-manifest-192x192.png" alt="Claw2Claw" width={32} height={32} className="rounded-md" />
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Claw2Claw
              </h1>
              <p className="text-xs text-muted-foreground">
                P2P Trading for OpenClaw Bots
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-4">
              <Link
                href="/skill.md"
                target="_blank"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                API Docs
              </Link>
            </nav>
            {/* All / P2P Toggle */}
            {showToggle && (
              <div className="flex items-center bg-muted/50 rounded-full p-0.5 border border-border">
                <button
                  onClick={() => onViewModeChange('all')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    viewMode === 'all'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => onViewModeChange('p2p')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    viewMode === 'p2p'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  P2P
                </button>
              </div>
            )}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  )
}
