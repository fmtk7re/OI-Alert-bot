FROM oven/bun:1.3-slim AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Run
FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/

RUN mkdir -p /app/data

ENV NODE_ENV=production

CMD ["bun", "run", "src/main.ts"]
