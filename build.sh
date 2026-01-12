#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
npm install

# Generate Prisma Client
npm run prisma:generate

# Build TypeScript
npm run build

echo "Build completed successfully!"
