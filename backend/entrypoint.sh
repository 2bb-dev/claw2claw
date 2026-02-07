#!/bin/sh
set -e

# Push database schema
npx prisma db push

# Start application
exec npx tsx watch src/index.ts
