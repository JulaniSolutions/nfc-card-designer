# NFC Card Designer

## Project Overview
Standalone, no-auth web app for designing custom NFC cards (business cards / tags). Users pick a material, design front & back on a Fabric.js canvas, then share via URL/email or export as layered PDF. No accounts needed.

## Core User Flow
1. **Pick material** — Plastic (white/black), Bamboo (natural), Metal (black steel/gold/silver)
2. **Design** — Add text, upload images, choose engraved or printed finish on a Fabric.js canvas (front + back)
3. **Save & Share** — Saves to Supabase, generates a short link, optionally emails it via Postmark
4. **Export PDF** — Layered PDF (85.6×54mm) with discrete objects for print workflows

## Rules
- Read all installed skills before doing any work
- Never commit `.env` files
- Use TypeScript throughout — frontend and backend
- Deploy frontend to Vercel on push to main

## Architecture

| Layer | Tech | Role |
|-------|------|------|
| UI | React 19 + Vite 7 + Tailwind v4 + shadcn/ui | Component framework |
| Canvas | Fabric.js 7 | Two-sided card editor (1012×638px each) |
| State | Zustand 5 | Single global store for material, canvas JSON, colors, metadata |
| Backend | Supabase (Postgres + Edge Functions + Storage) | Persistence, email, asset uploads |
| PDF | jsPDF | Layered export for pre-print |
| Extras | Runware (BG removal), Cloudflare Turnstile (CAPTCHA), Postmark (email) | Optional integrations |

## Key Features
- **Engraved vs Printed** — Engraved forces grayscale + material tint; printed is full color. Metal supports both; plastic/bamboo are always printed.
- **Back card** — Locked QR placeholder + optional name text, layout varies by material
- **NFC wave icon** — Auto-placed on plastic/bamboo front
- **Undo/redo** — Full canvas history stack
- **Recent designs** — Last 20 cached in localStorage
- **Transparency warnings** — Alerts when opaque images may affect print quality
- **Background removal** — AI-powered via Runware API
- **Rate-limited edge functions** — IP-based limits on save (10/min), email (3/min), upload (20/min)

## Pages
- `/` — Main designer editor (`DesignerPage`)
- `/design/:id(/:slug)` — Shared design preview, read-only with "Edit" option (`SharedDesignPage`)

## Key Paths
- `src/config/materials.ts` — Card materials and variations config (add new materials here)
- `src/config/canvas.ts` — Card dimensions (1012×638px)
- `src/store/design-store.ts` — Zustand state for the entire design
- `src/components/canvas/DesignCanvas.tsx` — Fabric.js canvas component
- `src/components/toolbar/` — Design tools and action bar
- `src/lib/save-design.ts` — Supabase save/load logic
- `src/lib/export-pdf.ts` — PDF export via jsPDF
- `src/lib/engraved-filters.ts` — Fabric.js image/text filtering for engraved mode
- `src/lib/back-card.ts` — QR placeholder + name text logic
- `src/lib/wave-icon.ts` — NFC icon placement
- `src/lib/canvas-history.ts` — Undo/redo
- `src/lib/design-history.ts` — Recent designs localStorage cache
- `src/lib/upload-asset.ts` — Asset upload to Supabase Storage
- `src/lib/runware.ts` — Background removal API
- `src/lib/turnstile.ts` — CAPTCHA token generation
- `supabase/migrations/` — Database schema
- `supabase/functions/` — Edge functions (save-design, send-design-email, upload-asset)

## Data Model
Single `designs` table: `design_id` (8-char short ID), material/variation, front/back canvas JSON, bg colors, design method (engraved/printed), back option (qr-only/qr-name), card names, quantity. Public RLS (no auth). Assets in Supabase `design-assets` bucket.

## Stack
- React 19, Vite 7, TypeScript 5.9
- Tailwind CSS v4, shadcn/ui
- Fabric.js 7 (canvas)
- Zustand 5 (state)
- Supabase (database, storage, edge functions)
- jsPDF (PDF export)
- react-router-dom v7 (routing)
- Postmark (email), Runware (BG removal), Cloudflare Turnstile (CAPTCHA)

## Deployment
- Frontend: **Vercel** (auto-deploy on push to `main`)
- Backend: **Supabase** (hosted — Postgres, Edge Functions, Storage)
- Fully serverless, no Docker

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Type-check and build
- `npm run lint` — ESLint
