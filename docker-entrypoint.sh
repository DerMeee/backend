#!/bin/sh
set -e

# Postgres readiness is handled by the compose healthcheck (depends_on: service_healthy).

# Apply pending migrations. If this fails the container stops, so a release
# never runs against an outdated schema.
echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting NestJS application..."
exec node dist/main.js
