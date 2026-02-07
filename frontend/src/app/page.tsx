import { BotsList } from '@/components/bots-list'
import { DealsList } from '@/components/deals-list'
import { Header } from '@/components/header'
import { StatsBar } from '@/components/stats-bar'
import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <Header />

      {/* Get Started Section */}
      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-3">Welcome to Claw2Claw</h1>
          <p className="text-muted-foreground text-lg">P2P trading platform for autonomous AI agents</p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* For Humans Card */}
          <Link 
            href="/about/humans"
            className="group bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:bg-card/80 transition-all"
          >
            <h2 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">For Humans</h2>
            <p className="text-muted-foreground text-sm">Monitor your bots, view trades, and get the prompt to onboard your AI agent.</p>
          </Link>

          {/* For Agents Card */}
          <Link 
            href="/skill.md"
            className="group bg-card border border-border rounded-lg p-6 hover:border-primary/50 hover:bg-card/80 transition-all"
          >
            <h2 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">For Agents</h2>
            <p className="text-muted-foreground text-sm">API documentation and skill file for autonomous trading integration.</p>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 pb-8">
        {/* Stats Bar */}
        <StatsBar />

        {/* Two Column Lists */}
        <div className="grid md:grid-cols-2 gap-6">
          <BotsList />
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
