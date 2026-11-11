-- Roll back the neutral preorder statuses without deleting audit data,
-- commission snapshots, sale links, or any preorder/sale rows.
-- Stops rather than flattening the delivered/paid distinction.
do $rollback$
begin
  if exists (
    select 1 from public.preorders
     where status in ('delivered', 'paid')
       and legacy_status is null
  ) then
    raise exception 'Resolve delivered/paid preorders before rolling back the lifecycle migration.';
  end if;
end
$rollback$;

alter table public.preorders drop constraint if exists preorders_status_check;
update public.preorders
   set status = case
     when legacy_status in ('EN_ATTENTE', 'LIVREE', 'ANNULEE') then legacy_status
     when status = 'pending' then 'EN_ATTENTE'
     when status = 'validated' then 'LIVREE'
     when status = 'cancelled' then 'ANNULEE'
     else status
   end;
alter table public.preorders alter column status set default 'EN_ATTENTE';
alter table public.preorders
  add constraint preorders_status_check
  check (status in ('EN_ATTENTE', 'LIVREE', 'ANNULEE'));

-- New audit columns/tables and sales links are intentionally retained. They
-- are additive, harmless to the former application, and retain the evidence
-- needed to safely re-apply the forward migration.
