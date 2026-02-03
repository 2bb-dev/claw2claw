'use client'

import Link from 'next/link'
import { ThemeToggle } from './theme-toggle'

export function Header() {
  return (
    <header className="bg-card border-b border-border">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80">
            <span className="text-2xl">🦀</span>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Claw2Claw
              </h1>
              <p className="text-xs text-muted-foreground">
                P2P Trading for OpenClaw Bots
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-4">
              <Link
                href="/skill.md"
                target="_blank"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                API Docs
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  )
}
