# GrandEunuch — local personal agent. The SQLite ledger is the asset; the
# container is just the steward's lodging, replaceable at will.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# scripts/*.ts import ../dist/* (typecheck + runtime), so produce dist inside the image first.
RUN npm run build:runtime
RUN npm run build

EXPOSE 3000
# bind 0.0.0.0 so the host port mapping can reach it (npm start pins 127.0.0.1)
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0"]
