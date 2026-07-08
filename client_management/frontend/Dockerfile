FROM node:20-slim AS deps

ENV NODE_ENV=development
WORKDIR /app

# CA certificates for TLS to the backend API over HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --no-audit --no-fund

# ---------- Build the Next.js standalone bundle ----------
FROM node:20-slim AS build

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---------- Minimal runtime image ----------
FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Next's "standalone" output ships the server.js + only the deps it needs.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

RUN chown -R node:node /app
USER node

ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The backend owns the database and applies the schema on its own boot;
# the frontend just serves the UI and calls the backend over HTTP.
CMD ["node", "server.js"]
