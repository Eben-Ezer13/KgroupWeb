-- Move all company accounts and scoped business data into one shared workspace.
-- Existing records are retained; only their workspace key is consolidated.
create table if not exists public.platform_compensation_settings_archive (
  source_team_id uuid primary key,
  source_team_name text,
  settings jsonb not null,
  archived_at timestamptz not null default now()
);

do $migration$
declare
  v_team uuid;
  v_row record;
  v_table record;
begin
  select id into v_team
    from public.teams
   order by created_at nulls last, id
   limit 1;

  -- Keep empty installs ready for the first admin to create the shared team.
  if v_team is null then return; end if;

  -- Keep the oldest workspace's active payroll rules. Preserve every other
  -- workspace's distinct configuration in an audit archive before removing
  -- its live duplicate (the app has one shared payroll configuration).
  insert into public.platform_compensation_settings_archive
    (source_team_id, source_team_name, settings)
  select c.team_id, t.name, to_jsonb(c)
    from public.compensation_settings c
    left join public.teams t on t.id = c.team_id
   where c.team_id <> v_team
  on conflict (source_team_id) do nothing;

  if not exists (select 1 from public.compensation_settings where team_id = v_team) then
    select * into v_row
      from public.compensation_settings c
      left join public.teams t on t.id = c.team_id
     order by t.created_at nulls last, c.team_id
     limit 1;
    if found then
      insert into public.compensation_settings
        (team_id, salary_base, commission_mode, commission_rate, bonus_tiers, currency, updated_at, updated_by)
      values
        (v_team, v_row.salary_base, v_row.commission_mode, v_row.commission_rate,
         v_row.bonus_tiers, v_row.currency, v_row.updated_at, v_row.updated_by)
      on conflict (team_id) do nothing;
    end if;
  end if;
  delete from public.compensation_settings where team_id <> v_team;

  -- Repoint every table that is scoped by team_id, including null-linked
  -- profiles. Use catalog-checked identifiers and parameterize the workspace.
  for v_table in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'team_id'
       and t.table_type = 'BASE TABLE'
       and c.table_name not in ('teams', 'compensation_settings')
     order by c.table_name
  loop
    execute format('update public.%I set team_id = $1 where team_id is distinct from $1', v_table.table_name)
      using v_team;
  end loop;

end
$migration$;

-- The shared team must outlive its original owner account, including on a
-- fresh install before the first workspace is created.
alter table public.teams alter column owner drop not null;
alter table public.teams drop constraint if exists teams_owner_fkey;
alter table public.teams
  add constraint teams_owner_fkey foreign key (owner)
  references public.users (id) on delete set null;
