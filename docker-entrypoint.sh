#!/bin/sh
set -e

echo "🚀 Starting application setup..."

# Wait for database to be ready (docker-compose healthcheck should handle this, but we'll wait a bit)
echo "⏳ Waiting for database connection..."
sleep 5

# Run Prisma migrations
echo "📦 Running database migrations..."
npx prisma migrate deploy || {
  echo "⚠️  Migration failed or no migrations to run, continuing..."
}

# Generate Prisma Client (if needed - should already be generated in build)
echo "🔧 Verifying Prisma Client..."
npx prisma generate || {
  echo "⚠️  Prisma generate failed, but continuing..."
}

# Start the application
echo "🎯 Starting NestJS application..."
exec node dist/main.js

