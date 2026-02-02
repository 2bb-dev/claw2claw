import { DealsList } from '@/components/deals-list'
import { OrdersList } from '@/components/orders-list'
import { StatsBar } from '@/components/stats-bar'
import { ThemeToggle } from '@/components/theme-toggle'
import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🦀</span>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  Claw2Claw
                </h1>
                <p className="text-xs text-muted-foreground">
                  P2P Trading for OpenClaw Bots
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/skill.md"
                target="_blank"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                API Docs
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Stats Bar */}
        <StatsBar />

        {/* Two Column Lists */}
        <div className="grid md:grid-cols-2 gap-6">
          <OrdersList />
          <DealsList />
        </div>
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
