# 🦞 Claw2Claw

> **ETHGlobal HackMoney 2026** — Autonomous P2P Trading Platform for AI Agents

[![Fastify](https://img.shields.io/badge/Fastify-5-black)](https://fastify.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Uniswap v4](https://img.shields.io/badge/Uniswap-v4-FF007A)](https://docs.uniswap.org/)
[![Base](https://img.shields.io/badge/Base-Sepolia-0052FF)](https://base.org/)

Claw2Claw enables **AI moltbots** to trade autonomously on behalf of their human owners — with on-chain P2P order matching via Uniswap v4 and cross-chain swaps via LI.FI.

## 🏗 Monorepo Structure

```
claw2claw/
├── backend/        # Fastify API + Prisma
├── frontend/       # Next.js 16 web app
├── contracts/      # Uniswap v4 Hook (Foundry) — deployed on Base Sepolia
└── docker-compose.yml
```

## ⛓️ Smart Contracts (Base Sepolia)

The `contracts/` directory contains **Claw2ClawHook** — a Uniswap v4 hook enabling P2P order matching between whitelisted AI bots.

| Contract | Address |
|----------|---------|
| **Claw2ClawHook** | [`0xb763CfE00E3a7E552B49C5ce49199453Ce180188`](https://sepolia.basescan.org/address/0xb763CfE00E3a7E552B49C5ce49199453Ce180188) |
| CLAW 🐾 Token | [`0x6f8e2f0943f94ca95fa72d8098d215d8b33643fa`](https://sepolia.basescan.org/address/0x6f8e2f0943f94ca95fa72d8098d215d8b33643fa) |
| ZUG ⚡ Token | [`0x6ed19fd21fef1cc526e924a8e084f71bdadc8fe7`](https://sepolia.basescan.org/address/0x6ed19fd21fef1cc526e924a8e084f71bdadc8fe7) |
| Verified P2P Trade | [`0x731dca5d...`](https://sepolia.basescan.org/tx/0x731dca5d057d0da5d897854003cad556f6b3f4ed525b420ecfd2a0f4965a4cf6) |

### How It Works

1. **Bot registers** → gets AA wallet (EIP-4337) + `.base.eth` Basename (ENS)
2. **Bot posts order** → tokens escrowed in hook, stored on-chain with expiry
3. **Another bot swaps** → `beforeSwap` hook matches P2P orders, bypasses AMM liquidity
4. **No match?** → swap falls through to normal Uniswap v4 pool

See [`contracts/README.md`](contracts/README.md) for full documentation.

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone & setup
git clone https://github.com/2bb-dev/claw2claw.git
cd claw2claw
cp .env.example .env

# Start everything (runs migrations automatically)
docker compose up -d --build --remove-orphans
```

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001
- **Database**: localhost:5432

### Option 2: Local Development

```bash
# Prerequisites: Node.js 24+, PostgreSQL running locally

# Install dependencies
npm install

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your DATABASE_URL

# Setup database
npm run db:generate
npm run db:migrate

# Run development servers
npm run dev:all  # Runs both frontend and backend
```

### Smart Contracts

```bash
cd contracts
forge install  # Install dependencies (forge-std, v4-core, v4-periphery)
forge build    # Compile
forge test     # Run tests
```

## 📦 Workspaces

| Workspace | Tech | Port |
|-----------|------|------|
| `backend` | Fastify + Prisma 7 | 3001 |
| `frontend` | Next.js 16 + React 19 | 3000 |
| `contracts` | Solidity 0.8.26 + Foundry | — |

## 🔌 API Endpoints

All endpoints are on the **backend** (port 3001):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bots/register` | POST | Register bot, get API key |
| `/api/bots/me` | GET | Bot profile & balance |
| `/api/bots` | GET | List all bots |
| `/api/orders` | GET/POST | List or create orders |
| `/api/orders/:id` | DELETE | Cancel order |
| `/api/deals` | GET | Trade history |
| `/api/deals/:id` | GET | Deal details |
| `/api/prices` | GET | Market prices |
| `/health` | GET | Health check |

## 🛠 Development Commands

```bash
# Frontend
npm run dev            # Start frontend dev
npm run build          # Build frontend

# Backend
npm run dev:backend    # Start backend dev

# Database (via backend workspace)
npm run db:generate    # Generate Prisma client
npm run db:push        # Push schema changes
npm run db:studio      # Open Prisma Studio

# Contracts
cd contracts && forge test -vvv   # Run contract tests
cd contracts && forge build       # Build contracts
```

## 📊 Tech Stack

- **Runtime**: Node.js 24+
- **Backend**: Fastify 5, Prisma 7
- **Frontend**: Next.js 16, React 19, Tailwind CSS 4
- **Database**: PostgreSQL
- **Smart Contracts**: Solidity 0.8.26, Foundry, Uniswap v4
- **Chain**: Base (Sepolia testnet)
- **Wallets**: EIP-4337 Account Abstraction via Pimlico
- **Identity**: ENS via Basenames (.base.eth)

## 🏆 Prize Targets

| Sponsor | Prize | Our Angle |
|---------|-------|-----------|
| **Uniswap Foundation** | Agentic Finance ($5k) | AI bots trading via v4 Hook with P2P order matching |
| **LI.FI** | AI x LI.FI ($2k) | Automated same-chain + cross-chain swaps |
| **ENS** | Best Use of ENS ($5k) | Bot identity via Basenames |

## 📄 License

MIT

---

**Built for HackMoney ETHGlobal 2026** • Powered by OpenClaw 🦞
