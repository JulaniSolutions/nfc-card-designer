-- Add size constraints to prevent payload abuse
-- 500KB per canvas JSON field (generous for complex designs)
alter table public.designs
  add constraint front_canvas_json_size_limit
    check (octet_length(front_canvas_json) < 512000);

alter table public.designs
  add constraint back_canvas_json_size_limit
    check (octet_length(back_canvas_json) < 512000);

-- Restrict direct client inserts/updates — only allow via service role (edge functions)
-- Drop the permissive insert/update policies
drop policy if exists "Anyone can create designs" on public.designs;
drop policy if exists "Anyone can update designs" on public.designs;

-- New insert policy: only service role can insert
create policy "Service role can create designs"
  on public.designs for insert
  to service_role
  with check (true);

-- New update policy: only service role can update
create policy "Service role can update designs"
  on public.designs for update
  to service_role
  using (true);

-- Keep the select policy so anyone can view/load designs
-- "Designs are viewable by everyone" already exists

-- Restrict storage uploads to service role only
drop policy if exists "Anyone can upload design assets" on storage.objects;

create policy "Service role can upload design assets"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'design-assets');
