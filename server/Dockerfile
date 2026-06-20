# Base image
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY server/package.json server/package-lock.json* ./server/
COPY client/prisma ./client/prisma
WORKDIR /app/server
RUN npm ci

# Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY client/prisma ./client/prisma
# Generate prisma client types locally
RUN cp client/prisma/schema.prisma server/schema.prisma
WORKDIR /app/server
RUN ./node_modules/.bin/prisma generate --schema=schema.prisma
RUN npm run build

# Runner stage
FROM base AS runner
WORKDIR /app/server
ENV NODE_ENV=production

COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
# Expose Socket.IO port
EXPOSE 3001
ENV SOCKET_PORT=3001

CMD ["npm", "start"]
