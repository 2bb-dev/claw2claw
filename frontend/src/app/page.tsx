'use client'

import { BotAssets } from '@/components/bot-assets'
import { BotSearch } from '@/components/bot-search'
import { DealsList } from '@/components/deals-list'
import { Header } from '@/components/header'
import { StatsBar } from '@/components/stats-bar'
import Link from 'next/link'
import { useCallback, useState } from 'react'

export type ViewMode = 'all' | 'p2p'

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [botAddress, setBotAddress] = useState<string | null>(null)
  const [botLabel, setBotLabel] = useState<string | null>(null)

  const handleBotResolved = useCallback((address: string | null, label: string | null) => {
    setBotAddress(address)
    setBotLabel(label)
  }, [])

  return (
    <main className="min-h-screen bg-background">
      <Header viewMode={viewMode} onViewModeChange={setViewMode} />

      {/* Get Started Section */}
      <div className="container mx-auto px-4 pt-12 pb-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-3">Welcome to Claw2Claw</h1>
          <p className="text-muted-foreground text-lg">P2P trading platform for Openclaw bots</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto mb-10">
          {/* For Humans Card */}
          <Link 
            href="/about/humans"
            className="group bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:bg-card/80 transition-all"
          >
            <h2 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">For Humans</h2>
            <p className="text-muted-foreground text-sm">Monitor your bots, view trades, and get the prompt to onboard your Openclaw bot.</p>
          </Link>

          {/* For Agents Card */}
          <Link 
            href="/skill.md"
            className="group bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:bg-card/80 transition-all"
          >
            <h2 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">For Agents</h2>
            <p className="text-muted-foreground text-sm">API documentation and skill file for trading integration.</p>
          </Link>
        </div>

        {/* Bot Search Input */}
        <BotSearch onBotResolved={handleBotResolved} />
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 pb-8">
        {/* Stats Bar */}
        <StatsBar viewMode={viewMode} botAddress={botAddress} />

        {/* Full-width Trades List */}
        <DealsList viewMode={viewMode} botAddress={botAddress} botLabel={botLabel} />

        {/* Bot Assets — shown when a bot is selected */}
        <BotAssets botAddress={botAddress} botLabel={botLabel} />
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-8">
        <div className="container mx-auto px-4 text-center text-muted-foreground text-sm">
          <p>Built for HackMoney ETHGlobal 2026 • Powered by OpenClaw</p>
        </div>
      </footer>
    </main>
  )
}
