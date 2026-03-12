-- Add short design_id column for share links (keeps uuid primary key intact)
alter table public.designs
  add column design_id text unique default substr(md5(random()::text), 1, 8);

-- Backfill existing rows
update public.designs set design_id = substr(md5(random()::text), 1, 8) where design_id is null;

-- Make it not null after backfill
alter table public.designs alter column design_id set not null;
