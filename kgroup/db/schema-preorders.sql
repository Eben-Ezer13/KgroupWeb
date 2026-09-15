-- =========================================================================
-- KGROUP — Précommandes   (migration v3.3)
-- Appliquée après schema.sql et schema-crm.sql par `npm run db:migrate`.
-- Idempotente : que des CREATE ... IF NOT EXISTS.
--
-- Une précommande est une vente PROMISE : le client réserve un parfum (souvent
-- en versant un acompte), la vente n'existe qu'une fois validée — paiement
-- reçu ou parfum remis.
--
--   EN_ATTENTE  enregistrée, non validée — ne compte NI dans les ventes, NI
--               dans le chiffre d'affaires, NI dans la commission
--   LIVREE      convertie en vente (sale_id), affichée « Vendue » : la vente
--               passe par les triggers habituels (apply_sale,
--               apply_sale_client) et compte dans le mois de la date de vente
--               choisie, comme une vente « validée » au sens de l'Art. 4
--   ANNULEE     abandonnée ; rien n'est comptabilisé
--
-- Une table à part plutôt qu'un statut sur `sales` : aucun des calculs
-- existants (classements, paie, statistiques clients) n'a à apprendre à
-- ignorer les précommandes.
--
-- Le serveur vérifie aussi cette table au premier appel des routes
-- /api/preorders (server/preorders.js, même SQL), pour qu'un déploiement
-- fonctionne avant même que la migration n'ait été lancée.
-- =========================================================================

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
  status        text   not null default 'EN_ATTENTE' check (status in ('EN_ATTENTE', 'LIVREE', 'ANNULEE')),
  sale_id       uuid references public.sales (id) on delete set null,
  delivered_at  timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_at    timestamptz default now()
);

create index if not exists idx_preorders_team   on public.preorders (team_id, created_at desc);
create index if not exists idx_preorders_status on public.preorders (team_id, status);
create index if not exists idx_preorders_rep    on public.preorders (rep_id);
