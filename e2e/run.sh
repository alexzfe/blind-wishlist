#!/bin/sh
# Browser tests. Playwright is a test-time tool, not a project dependency: it's installed into the
# git-ignored .playwright/ folder on first run. Uses the system Chromium; set CHROME to use another browser.
set -e
cd "$(dirname "$0")/.."
[ -d .playwright/node_modules/playwright ] || npm install --silent --no-save --no-package-lock --prefix .playwright playwright@1.65.1
NODE_PATH=.playwright/node_modules node --test e2e/wishlist.spec.js
