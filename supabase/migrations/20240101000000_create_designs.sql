-- Create designs table for storing NFC card designs
create table if not exists public.designs (
  id uuid default gen_random_uuid() primary key,
  material_id text not null,
  variation_id text not null,
  front_canvas_json text,
  back_canvas_json text,
  front_bg_color text not null default '#ffffff',
  back_bg_color text not null default '#ffffff',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable RLS
alter table public.designs enable row level security;

-- Allow anyone to read designs (for sharing)
create policy "Designs are viewable by everyone"
  on public.designs for select
  using (true);

-- Allow anyone to insert designs (no auth required for this tool)
create policy "Anyone can create designs"
  on public.designs for insert
  with check (true);

-- Allow anyone to update designs
create policy "Anyone can update designs"
  on public.designs for update
  using (true);

-- Create storage bucket for uploaded assets
insert into storage.buckets (id, name, public)
values ('design-assets', 'design-assets', true)
on conflict (id) do nothing;

-- Allow public access to design assets
create policy "Public access to design assets"
  on storage.objects for select
  using (bucket_id = 'design-assets');

create policy "Anyone can upload design assets"
  on storage.objects for insert
  with check (bucket_id = 'design-assets');
