#!/bin/sh
# Builds the AdLens Live web app with the web-demo App Check token and deploys it to Firebase Hosting.
set -e
cd "$(dirname "$0")/.."
export $(grep -v '^#' .env.web.local | xargs)
npx tsc --noEmit
npx vite build --config vite.app.config.ts
npx firebase deploy --only hosting --non-interactive
