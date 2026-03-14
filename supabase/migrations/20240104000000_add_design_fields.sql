-- Add missing design fields for full state persistence
alter table public.designs
  add column if not exists design_method text not null default 'printed',
  add column if not exists back_option text not null default 'qr-only',
  add column if not exists card_names jsonb not null default '[""]'::jsonb,
  add column if not exists quantity integer not null default 1;
