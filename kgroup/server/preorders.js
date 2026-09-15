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
      .catch(async (err) => {
        // Deux instances qui créent la table au même instant : la seconde
        // échoue, mais la table existe bel et bien.
        try {
          const row = await db.one(`select to_regclass('public.preorders') as t`);
          if (row && row.t) return true;
        } catch (_) { /* on signale l'erreur d'origine ci-dessous */ }
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
