-- Reusable design templates.
-- A template is an immutable snapshot of a design, published to its own short link.
-- Viewers can't edit it — they "use" it, which forks a fresh design client-side.
-- Kept in a separate table (not designs.is_template) so that:
--   * read-only is enforced by RLS, not by hiding a button
--   * the author editing the source design can't silently mutate a shared link
--   * per-card personal data (card_data/quantity/card_names) has no column to leak into

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  template_id text unique not null,
  name text not null,
  description text,

  -- frozen design snapshot
  material_id text not null,
  variation_id text not null,
  front_canvas_json text,
  back_canvas_json text,
  front_bg_color text not null default '#ffffff',
  back_bg_color text not null default '#ffffff',
  design_method text not null default 'printed',
  back_option text not null default 'qr-only',
  variable_fields jsonb not null default '[]'::jsonb, -- definitions only, never values

  -- presentation
  front_preview_url text,
  back_preview_url text,

  -- provenance & lifecycle
  source_design_id text,
  edit_token_hash text not null, -- sha256 of the secret returned once at publish
  is_published boolean not null default true,
  is_listed boolean not null default false, -- gallery opt-in, service-role only
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tpl_front_json_size check (octet_length(front_canvas_json) < 2000000),
  constraint tpl_back_json_size check (octet_length(back_canvas_json) < 2000000),
  constraint tpl_name_length check (char_length(name) between 1 and 80),
  constraint tpl_description_length check (description is null or char_length(description) <= 300)
);

alter table public.templates enable row level security;

-- Anyone can read a published template. Unpublished rows disappear entirely,
-- which is what gives us a kill switch for abusive content.
create policy "Published templates are viewable by everyone"
  on public.templates for select
  using (is_published);

-- All writes go through edge functions running as service_role.
create policy "Service role can manage templates"
  on public.templates for all
  to service_role
  using (true)
  with check (true);

-- RLS is row-level only — it never restricts columns. Supabase's default
-- privileges hand new public-schema tables a TABLE-level SELECT grant to
-- anon/authenticated, and Postgres cannot subtract a column from a table-level
-- grant (a column-level REVOKE just warns and does nothing). So the grant has
-- to be dropped and re-issued as an explicit column list.
--
-- Two columns must never reach a client:
--   edit_token_hash  — the ownership secret
--   source_design_id — the author's private /design/:id link, which is itself a
--                      capability: it exposes card_data, card_names and quantity,
--                      the per-card personal data this table exists to keep out.
revoke select on public.templates from anon, authenticated;

grant select (
  template_id,
  name,
  description,
  material_id,
  variation_id,
  front_canvas_json,
  back_canvas_json,
  front_bg_color,
  back_bg_color,
  design_method,
  back_option,
  variable_fields,
  front_preview_url,
  back_preview_url,
  use_count,
  created_at,
  updated_at
) on public.templates to anon, authenticated;

create index if not exists templates_listed_idx
  on public.templates (updated_at desc)
  where is_published and is_listed;

-- Attribution: which template (if any) a design was forked from.
alter table public.designs
  add column if not exists source_template_id text;

-- Count real forks, not page views. AFTER INSERT only, so save-design's
-- upsert-on-retry can never double count.
create or replace function public.bump_template_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_template_id is not null then
    update public.templates
       set use_count = use_count + 1
     where template_id = new.source_template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists designs_bump_template_use on public.designs;
create trigger designs_bump_template_use
  after insert on public.designs
  for each row
  execute function public.bump_template_use();
