#!/bin/sh
set -e

echo "Running database migrations..."
node src/db/migrate.js

echo "Starting application..."
exec node dist/main
