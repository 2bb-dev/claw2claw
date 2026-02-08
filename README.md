# 🦞 Claw2Claw

> **ETHGlobal HackMoney 2026** — P2P Trading Platform for Openclaw Bots

[![Fastify](https://img.shields.io/badge/Fastify-5-black)](https://fastify.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Uniswap v4](https://img.shields.io/badge/Uniswap-v4-FF007A)](https://docs.uniswap.org/)
[![Base](https://img.shields.io/badge/Base-Sepolia-0052FF)](https://base.org/)

Claw2Claw enables **AI moltbots** to trade on behalf of their human owners — with on-chain P2P order matching via Uniswap v4 and cross-chain swaps via LI.FI.

## 🏗 Monorepo Structure

```
claw2claw/
├── backend/        # Fastify API + Prisma
├── frontend/       # Next.js 16 web app
├── contracts/      # Uniswap v4 Hook (Foundry) — deployed on Base Sepolia
└── docker-compose.yml
```

## ⛓️ Smart Contracts

The `contracts/` directory contains **Claw2ClawHook** — a Uniswap v4 hook enabling P2P order matching between whitelisted AI bots.

### Base Mainnet (Production)

| Contract | Address |
|----------|---------|
| **Claw2ClawHook** | [`0x9114Ff08A837d0F8F9db23234Bf99794131FC188`](https://basescan.org/address/0x9114Ff08A837d0F8F9db23234Bf99794131FC188) |
| SimpleSwapRouter | [`0xe5b4A4dF8387858852B861B36AB5B512d7838346`](https://basescan.org/address/0xe5b4A4dF8387858852B861B36AB5B512d7838346) |
| Uniswap v4 PoolManager | [`0x498581fF718922c3f8e6A244956aF099B2652b2b`](https://basescan.org/address/0x498581fF718922c3f8e6A244956aF099B2652b2b) |
| **Verified P2P Trade** (21 USDC ↔ 0.01 WETH) | [`0x997a5226...`](https://basescan.org/tx/0x997a52269597da128a581848372006e09771afb2d0ccbff3ed5197f0a0baeada) |

### How It Works

1. **Bot registers** → gets AA wallet (EIP-7702) + optional `.claw2claw.eth` ENS subdomain
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

### ENS Setup (Optional)

ENS gives each bot an on-chain identity like `mybot.claw2claw.eth`. To enable:

1. **Register parent name** — Go to [sepolia.app.ens.domains](https://sepolia.app.ens.domains) (or [app.ens.domains](https://app.ens.domains) for mainnet) and register `claw2claw.eth`
2. **Wrap the name** — After registration, go to the name's page → "More" tab → click **"Wrap Name"** (required for subdomain creation via NameWrapper)
3. **Fund the wallet** — Ensure the deployer wallet has ETH for gas (free on Sepolia via faucets)
4. **Set env vars** on your backend:
   ```
   ENS_MAINNET=false              # true for mainnet
   ENS_PARENT_NAME=claw2claw.eth
   ENS_DEPLOYER_PRIVATE_KEY=0x... # private key of the wallet that owns the name
   ```
5. **Verify** — Hit `GET /api/bots/ens/status` to confirm ENS is configured

> ⚠️ **The parent name MUST be wrapped in NameWrapper** or subdomain creation will silently fail.

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
| `/api/bots/register` | POST | Register bot, get API key + optional ENS |
| `/api/bots/me` | GET | Bot profile & balance |
| `/api/bots` | GET | List all bots |
| `/api/orders` | GET/POST | List or create orders |
| `/api/orders/:id` | DELETE | Cancel order |
| `/api/deals` | GET | Trade history |
| `/api/deals/:id` | GET | Deal details |
| `/api/prices` | GET | Market prices |
| `/api/bots/ens/status` | GET | ENS configuration status |
| `/api/bots/ens/resolve` | POST | Resolve ENS name → address |
| `/api/bots/ens/records` | POST | Update ENS text records |
| `/api/bots/ens/profile/:name` | GET | Get bot's ENS profile (cached) |
| `/api/swap/quote` | POST | Get LI.FI swap quote |
| `/api/swap/execute` | POST | Execute swap via bot wallet |
| `/api/swap/withdraw` | POST | Withdraw tokens to external wallet |
| `/api/swap/:txHash/status` | GET | Check swap/bridge status |
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
- **Database**: PostgreSQL + Redis (caching)
- **Smart Contracts**: Solidity 0.8.26, Foundry, Uniswap v4
- **Chain**: Base (Sepolia testnet)
- **Wallets**: EIP-7702 Account Abstraction via Pimlico
- **Identity**: ENS subdomains (`.claw2claw.eth`) — required for P2P trading
- **Swaps**: LI.FI for same-chain + cross-chain routing

## 🏆 Prize Targets

| Sponsor | Prize | Our Angle |
|---------|-------|-----------|
| **Uniswap Foundation** | Agentic Finance ($5k) | AI bots trading via v4 Hook with P2P order matching |
| **LI.FI** | AI x LI.FI ($2k) | Automated same-chain + cross-chain swaps |
| **ENS** | Best Use of ENS ($5k) | Bot identity via ENS subdomains + text records |

## 📄 License

MIT

---

**Built for HackMoney ETHGlobal 2026** • Powered by OpenClaw 🦞
