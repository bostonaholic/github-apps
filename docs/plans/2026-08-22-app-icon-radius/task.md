---
topic: app-icon-radius
date: 2026-08-22
phase: task
ticketId: null
---

# Bug: app icons bake in their own corner radius

Both app icons (`dependabot-shepherd/assets/icon.svg`,
`task-list-completed/assets/icon.svg`) draw their dark background as a
rounded square (`rx="224"` on a 1024×1024 canvas). GitHub renders app
avatars inside its own rounded-rectangle frame, so the baked-in radius
shows white notched corners and a mismatched curve next to full-bleed
icons like Cloudflare's.

**Fix:** make the background rect full-bleed (no `rx`), letting GitHub
apply its own avatar radius; regenerate `assets/icon.png` and the
`public/favicon.{svg,png}` copies for both apps.
