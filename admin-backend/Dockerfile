FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install --only=production

# Install drizzle-orm for migrations
RUN npm install drizzle-orm postgres

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/modules/email/templates ./dist/modules/email/templates
COPY --from=builder /app/src/db/migrations ./src/db/migrations
COPY src/db/migrate.js ./src/db/migrate.js
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 4000

CMD ["./docker-entrypoint.sh"]
