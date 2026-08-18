-- The user can now deliberately delete the QR placeholder from a design.
-- Recorded as an explicit flag rather than inferred from the canvas JSON:
-- designs saved before the placeholder existed also have no QR object, and
-- those must keep receiving a QR at the standard position in production.
alter table designs add column if not exists qr_removed boolean not null default false;
alter table templates add column if not exists qr_removed boolean not null default false;

-- templates carries a column-level SELECT grant (see 20240107000000), so the
-- new column has to be granted explicitly or the public template read fails.
grant select (qr_removed) on public.templates to anon, authenticated;
