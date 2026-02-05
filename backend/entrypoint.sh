#!/bin/sh
set -e

# Run database migrations
npx prisma migrate deploy

# Start application
exec npx tsx src/index.ts
