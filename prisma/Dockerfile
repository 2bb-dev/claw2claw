# Prisma migrations container
FROM node:24-alpine

WORKDIR /app

# Copy prisma files and config
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Run migrations
CMD ["npx", "prisma", "migrate", "deploy"]
