# NFC Card Designer

## Project Overview
Standalone, unbranded NFC card design tool. React + Vite + TypeScript + Tailwind + shadcn/ui + Fabric.js + Zustand + Supabase.

## Rules
- Read all installed skills before doing any work
- Never commit `.env` files
- Use TypeScript throughout — frontend and backend
- Deploy frontend to Vercel on push to main

## Key Paths
- `src/config/materials.ts` — Card materials and variations config (add new materials here)
- `src/store/design-store.ts` — Zustand state for the entire design
- `src/components/canvas/DesignCanvas.tsx` — Fabric.js canvas component
- `src/components/toolbar/` — Design tools and action bar
- `src/lib/save-design.ts` — Supabase save/load logic
- `src/lib/export-pdf.ts` — PDF export via jsPDF
- `supabase/migrations/` — Database schema

## Stack
- React 19, Vite 7, TypeScript 5.9
- Tailwind CSS v4, shadcn/ui
- Fabric.js 7 (canvas)
- Zustand 5 (state)
- Supabase (database, storage, edge functions)
- jsPDF (PDF export)
- react-router-dom v7 (routing)

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Type-check and build
- `npm run lint` — ESLint
