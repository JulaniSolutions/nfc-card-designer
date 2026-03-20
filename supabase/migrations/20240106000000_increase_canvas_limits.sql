-- Increase canvas JSON size limits to 2MB to support larger images
alter table public.designs drop constraint if exists front_canvas_json_size_limit;
alter table public.designs drop constraint if exists back_canvas_json_size_limit;

alter table public.designs
  add constraint front_canvas_json_size_limit
    check (octet_length(front_canvas_json) < 2000000);

alter table public.designs
  add constraint back_canvas_json_size_limit
    check (octet_length(back_canvas_json) < 2000000);
