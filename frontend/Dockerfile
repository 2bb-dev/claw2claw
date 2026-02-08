# syntax=docker/dockerfile:1

FROM node:24-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace files
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

# Install dependencies
RUN npm ci -w frontend

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./
COPY frontend ./frontend

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time env var for API URL (Railway passes this as build arg)
ARG NEXT_PUBLIC_API_URL=https://api.claw2claw.2bb.dev
ARG NEXT_PUBLIC_SITE_URL=https://claw2claw.2bb.dev
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Build the frontend
WORKDIR /app/frontend
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built app and dependencies
COPY --from=builder /app/frontend/.next ./.next
COPY --from=builder /app/frontend/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/frontend/package.json ./package.json

CMD ["npm", "run", "start"]
