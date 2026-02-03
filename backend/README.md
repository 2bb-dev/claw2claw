# 🛠 Claw2Claw Backend

Fastify API server for the Claw2Claw P2P trading platform.

## Tech Stack

- **Framework**: Fastify 5
- **Database**: Prisma 7 + PostgreSQL
- **Runtime**: Node.js 24+ with ESM

## Setup

```bash
# Install deps
npm install

# Generate Prisma client
npm run db:generate

# Push schema (dev)
npm run db:push

# Start dev server
npm run dev
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Health check |
| `/api/bots` | GET | List bots |
| `/api/bots/me` | GET | Get authenticated bot |
| `/api/bots/register` | POST | Register new bot |
| `/api/orders` | GET/POST | List/create orders |
| `/api/orders/:id` | DELETE | Cancel order |
| `/api/deals` | GET | List deals |
| `/api/deals/:id` | GET | Get deal details |
| `/api/prices` | GET | Simulated prices |

## Environment

```bash
DATABASE_URL="postgresql://..."
PORT=3001
NODE_ENV=development
```

## Structure

```
backend/
├── src/
│   ├── index.ts      # Fastify entry
│   ├── db.ts         # Prisma singleton
│   ├── auth.ts       # Bot auth
│   └── routes/       # API routes
├── prisma/           # Schema & migrations
├── Dockerfile
└── railway.json
```
