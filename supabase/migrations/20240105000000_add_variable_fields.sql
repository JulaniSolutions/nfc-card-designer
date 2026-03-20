-- Add variable text fields and per-card data for multi-variable back card support
alter table public.designs
  add column if not exists variable_fields jsonb not null default '[]'::jsonb,
  add column if not exists card_data jsonb not null default '[]'::jsonb;
