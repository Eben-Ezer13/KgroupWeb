/* =========================================================================
   KGROUP — Table des précommandes, vérifiée à la demande
   -------------------------------------------------------------------------
   La procédure normale reste `npm run db:migrate` (db/schema-preorders.sql).
   Mais Vercel redéploie à chaque push, AVANT que quiconque ait pu lancer la
   migration : sans cette vérification, la page Commandes afficherait une
   erreur jusqu'à la prochaine intervention manuelle.

   Le SQL ci-dessous est celui du fichier de migration, instruction pour
   instruction (tests/orders.test.js vérifie qu'ils ne divergent pas). Tout
   est en IF NOT EXISTS : l'exécuter sur une base déjà migrée ne change rien.
   Il ne tourne qu'une fois par instance du serveur.
   ========================================================================= */
"use strict";

const db = require("./db");
const { HttpError } = require("./policies");

const SCHEMA_SQL = `
create table if not exists public.preorders (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  owner         uuid references public.users (id) on delete set null,
  rep_id        uuid references public.salespersons (id) on delete set null,
  rep_name      text,
  client_id     uuid references public.clients (id) on delete set null,
  customer      text not null,
  client_phone  text,
  product       text not null,
  perfume_name  text,
  qty           int    not null default 1 check (qty > 0),
  unit_price    bigint not null default 0 check (unit_price >= 0),
  amount        bigint not null default 0 check (amount >= 0),
  commission    bigint not null default 0 check (commission >= 0),
  deposit       bigint not null default 0 check (deposit >= 0),
  pay           text,
  expected_at   date,
  remarks       text,
  status        text   not null default 'pending' check (status in ('pending', 'delivered', 'paid', 'validated', 'cancelled')),
  sale_id       uuid references public.sales (id) on delete set null,
  delivered_at  timestamptz,
  delivered_to_client_at timestamptz,
  paid_at       timestamptz,
  paid_amount   bigint not null default 0 check (paid_amount >= 0),
  migration_review boolean not null default false,
  legacy_status text,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_at    timestamptz default now()
);

alter table public.preorders add column if not exists delivered_to_client_at timestamptz;
alter table public.preorders add column if not exists paid_at timestamptz;
alter table public.preorders add column if not exists paid_amount bigint not null default 0;
alter table public.preorders add column if not exists migration_review boolean not null default false;
alter table public.preorders add column if not exists legacy_status text;
alter table public.preorders drop constraint if exists preorders_status_check;
update public.preorders
   set legacy_status = coalesce(legacy_status, status),
       migration_review = migration_review or (status = 'LIVREE' and sale_id is null),
       status = case
         when status = 'EN_ATTENTE' then 'pending'
         when status = 'ANNULEE' then 'cancelled'
         when status = 'LIVREE' and sale_id is not null then 'validated'
         when status = 'LIVREE' then 'pending'
         else status
       end
 where status in ('EN_ATTENTE', 'LIVREE', 'ANNULEE');
alter table public.preorders alter column status set default 'pending';
alter table public.preorders
  add constraint preorders_status_check
  check (status in ('pending', 'delivered', 'paid', 'validated', 'cancelled'));
alter table public.sales add column if not exists preorder_id uuid references public.preorders (id) on delete set null;
alter table public.sales add column if not exists commission_snapshot jsonb;
create unique index if not exists idx_sales_preorder_uniq
  on public.sales (preorder_id) where preorder_id is not null;
update public.sales s
   set preorder_id = p.id
  from public.preorders p
 where p.sale_id = s.id
   and p.status = 'validated'
   and s.preorder_id is null
   and (select count(*) from public.preorders p2 where p2.sale_id = s.id) = 1;
create table if not exists public.preorder_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  preorder_id uuid not null references public.preorders (id) on delete cascade,
  actor_id uuid references public.users (id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_preorder_events_team_time
  on public.preorder_events (team_id, created_at desc);
create index if not exists idx_preorder_events_preorder
  on public.preorder_events (preorder_id, created_at);
insert into public.preorder_events
  (team_id, preorder_id, action, from_status, to_status, details, created_at)
select p.team_id, p.id, 'migration', p.legacy_status, p.status,
       jsonb_build_object('legacy_status', p.legacy_status, 'migration_review', p.migration_review),
       now()
  from public.preorders p
 where p.legacy_status is not null
   and not exists (
     select 1 from public.preorder_events e
      where e.preorder_id = p.id and e.action = 'migration'
   );

create index if not exists idx_preorders_team   on public.preorders (team_id, created_at desc);
create index if not exists idx_preorders_status on public.preorders (team_id, status);
create index if not exists idx_preorders_rep    on public.preorders (rep_id);
`;

let ready = null;

/**
 * Garantit que la table existe. Une seule tentative réussie par instance ;
 * un échec est retenté à l'appel suivant.
 */
function ensurePreorderSchema() {
  if (!ready) {
    ready = db.query(SCHEMA_SQL)
      .then(() => true)
      .catch((err) => {
        ready = null;
        console.error("[preorders] table indisponible :", err.message);
        throw new HttpError(
          503,
          "Les précommandes ne sont pas encore disponibles : la base de données doit être mise à jour (npm run db:migrate)."
        );
      });
  }
  return ready;
}

/** Pour les tests : oublier la vérification déjà faite. */
function resetPreorderSchemaCheck() {
  ready = null;
}

module.exports = { SCHEMA_SQL, ensurePreorderSchema, resetPreorderSchemaCheck };
