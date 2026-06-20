# Base image
FROM node:20-alpine AS base

# Install compatibility packages
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json package-lock.json* ./
# Copy prisma schema so client can be generated
COPY prisma ./prisma/
RUN npm ci

# Builder stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma Client types
RUN ./node_modules/.bin/prisma generate
# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runner stage
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]
