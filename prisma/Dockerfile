# Prisma migrations container
FROM node:24-alpine

WORKDIR /app

# Copy prisma files and package.json
COPY prisma ./prisma
COPY package.json package-lock.json* ./

# Install all dependencies (prisma is in devDeps)
RUN npm ci

# Run migrations
CMD ["npx", "prisma", "migrate", "deploy"]
