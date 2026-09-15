/* =========================================================================
   KGROUP — /api/*  (the endpoints behind window.KGDB)
   -------------------------------------------------------------------------
   One route per Supabase table call the browser used to make:

     supabase.from("salespersons").select().order("revenue")  -> GET    /api/salespersons
     supabase.from("salespersons").insert()                   -> POST   /api/salespersons
     supabase.from("salespersons").delete().eq("id", …)       -> DELETE /api/salespersons/:id
     supabase.from("sales").select().order("created_at").limit -> GET   /api/sales?limit=
     supabase.from("sales").insert()                          -> POST   /api/sales
     supabase.from("profiles").select().eq("id", uid).single() -> GET   /api/profile
     supabase.from("profiles").update().eq("id", uid)         -> PATCH  /api/profile
     supabase.from("challenges").select().order("created_at") -> GET    /api/challenges
     supabase.from("challenges").insert()                     -> POST   /api/challenges

   Ordering, limits and returned columns match the originals exactly, so
   KGData.hydrate() keeps mapping rows the same way.

   Ajouts (historique des commandes) :
     GET   /api/sales/history      ventes filtrées : commercial, période,
                                   recherche + synthèse par commercial
     PATCH /api/sales/:id/rep      (admin) réattribuer une vente à un autre
                                   commercial, statistiques comprises

   The browser used to send whole objects that Supabase spread straight into the
   INSERT. Here each write picks its columns from an explicit allow-list: the
   client can still set everything the UI ever set, but can no longer forge
   `owner`, `team_id`, `auth_id`, `invite_code`, `claimed` or `id` — the columns
   the authorization rules themselves depend on.
   ========================================================================= */
"use strict";

const crypto = require("crypto");
const express = require("express");

const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError, teamScope, requireAdmin, canMutateSale, isAdmin } = require("../policies");
const crm = require("../crm");
const { resolveRep, resolveClient, applySaleToRep, localDay } = require("../sales");

const router = express.Router();

/** Keeps only allow-listed keys whose value the client actually supplied. */
function pick(source, allowed) {
  const out = {};
  for (const key of allowed) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Builds a parameterised INSERT from a plain object. */
function insertSql(table, values, returning = "*") {
  const keys = Object.keys(values);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  return {
    text: `insert into public.${table} (${cols}) values (${params}) returning ${returning}`,
    values: keys.map((k) => values[k]),
  };
}

/* Every route below takes `requireUser` explicitly. A router-wide guard would
   also swallow unknown paths under /api and answer them 401 instead of 404, so
   the guard is attached per route — every new route MUST include it. */

/* ------------------------------------------------------------------ *
 * SALESPERSONS                                                        *
 * ------------------------------------------------------------------ */
const SALESPERSON_FIELDS = [
  "name", "city", "phone", "email", "level", "status", "target",
  "hue", "sales", "today_sales", "revenue", "commission", "xp", "xp_to_next", "badges",
];

router.get("/salespersons", requireUser, async (req, res, next) => {
  try {
    const rows = await db.many(
      `select s.*, coalesce(p.role, 'salesperson') as role
         from public.salespersons s
         left join public.profiles p on p.salesperson_id = s.id
        where s.team_id = $1
        order by s.revenue desc`,
      [teamScope(req)]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/salespersons", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);

    const fields = pick(req.body || {}, SALESPERSON_FIELDS);
    if (!fields.name || !String(fields.name).trim()) {
      throw new HttpError(400, "A salesperson needs a name.");
    }
    if (fields.badges !== undefined) fields.badges = JSON.stringify(fields.badges);

    // The invite code is generated server-side. The old client generated it and
    // sent it along, which meant a caller could pick a guessable code.
    const inviteCode = crypto.randomBytes(6).toString("hex");

    const { text, values } = insertSql("salespersons", {
      owner: req.user.id,
      team_id: teamId,
      invite_code: inviteCode,
      claimed: false,
      ...fields,
    });
    const { rows } = await db.query(text, values);
    return res.status(201).json(rows[0]); // includes invite_code -> builds the invite link
  } catch (err) {
    return next(err);
  }
});

router.patch("/salespersons/:id", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const requestedRole = req.body && req.body.role !== undefined
      ? String(req.body.role)
      : null;
    if (requestedRole !== null) {
      const { ASSIGNABLE_ROLES } = require("../policies");
      if (!ASSIGNABLE_ROLES.includes(requestedRole)) {
        throw new HttpError(400, `Rôle invalide. Valeurs acceptées : ${ASSIGNABLE_ROLES.join(", ")}.`);
      }
    }
    const fields = pick(req.body || {}, SALESPERSON_FIELDS);
    if (fields.name !== undefined && !String(fields.name).trim()) {
      throw new HttpError(400, "A salesperson needs a name.");
    }
    if (fields.badges !== undefined) fields.badges = JSON.stringify(fields.badges);
    const keys = Object.keys(fields);
    if (!keys.length && requestedRole === null) {
      throw new HttpError(400, "No salesperson changes supplied.");
    }

    let rows;
    if (keys.length) {
      const setSql = keys.map((key, index) => `"${key}" = $${index + 2}`).join(", ");
      const result = await db.query(
        `update public.salespersons set ${setSql}
           where id = $1 and team_id = $${keys.length + 2}
         returning *`,
        [req.params.id, ...keys.map((key) => fields[key]), teamScope(req)]
      );
      rows = result.rows;
    } else {
      const row = await db.one(
        `select * from public.salespersons where id = $1 and team_id = $2`,
        [req.params.id, teamScope(req)]
      );
      rows = row ? [row] : [];
    }
    if (!rows.length) throw new HttpError(404, "That salesperson is not on your team.");
    if (requestedRole !== null) {
      const { rowCount } = await db.query(
        `update public.profiles p
            set role = $2
           from public.salespersons s
          where s.id = $1 and s.team_id = $3 and p.salesperson_id = s.id`,
        [req.params.id, requestedRole, teamScope(req)]
      );
      if (!rowCount) {
        throw new HttpError(400, "Ce commercial doit d'abord activer son invitation.");
      }
      rows[0].role = requestedRole;
    }
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete("/salespersons/:id", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rowCount } = await db.query(
      `delete from public.salespersons where id = $1 and team_id = $2`,
      [req.params.id, teamScope(req)]
    );
    if (!rowCount) throw new HttpError(404, "That salesperson is not on your team.");
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * SALES                                                               *
 * ------------------------------------------------------------------ */
const SALE_FIELDS = [
  "customer", "product", "perfume_name", "qty", "amount", "commission",
  "pay", "rep_id", "rep_name", "remarks", "created_at",
];
const PERFUME_NAME_MAX = 120;

/* Le client d'une vente (section CLIENT du formulaire : client_id,
   client_phone, client_birthday) est résolu par resolveClient(), partagé
   avec les précommandes dans server/sales.js. */

router.get("/sales", requireUser, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 5000);
    const rows = await db.many(
      `select * from public.sales where team_id = $1 order by created_at desc limit $2`,
      [teamScope(req), limit]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/sales", requireUser, async (req, res, next) => {
  try {
    const teamId = teamScope(req);
    const fields = pick(req.body || {}, SALE_FIELDS);

    if (!fields.customer || !String(fields.customer).trim()) {
      throw new HttpError(400, "A sale needs a customer.");
    }
    if (!fields.product || !String(fields.product).trim()) {
      throw new HttpError(400, "A sale needs a product.");
    }
    // Nom du parfum : facultatif pour l'API (anciens clients, imports), mais
    // toujours propre en base — texte coupé, vide ramené à null.
    if (fields.perfume_name !== undefined) {
      const name = String(fields.perfume_name || "").trim();
      if (name.length > PERFUME_NAME_MAX) {
        throw new HttpError(400, `Perfume name is too long (${PERFUME_NAME_MAX} characters max).`);
      }
      fields.perfume_name = name || null;
    }
    // Le commercial credite : impose pour un commercial (le sien), choisi et
    // verifie dans l'equipe pour un administrateur. Le nom enregistre est
    // celui du roster, pas un libelle recopie depuis le formulaire.
    const rep = await resolveRep(req, teamId, fields.rep_id || null);
    fields.rep_id = rep ? rep.id : null;
    if (rep) fields.rep_name = rep.name;
    else if (!isAdmin(req)) fields.rep_name = null;

    // Le client est resolu AVANT l insertion : le trigger on_sale_insert_client
    // met a jour ses totaux au moment ou la vente est ecrite.
    const clientId = await resolveClient(req, teamId, req.body || {}, fields);

    const { text, values } = insertSql("sales", {
      owner: req.user.id,
      team_id: teamId,
      ...(clientId ? { client_id: clientId } : {}),
      ...fields,
    });
    const { rows } = await db.query(text, values);
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * HISTORIQUE DES VENTES                                               *
 * -------------------------------------------------------------------
 * GET /api/sales/history?rep_id=&from=AAAA-MM-JJ&to=AAAA-MM-JJ&q=&limit=
 *
 * Périmètre, appliqué en clause WHERE :
 *   admin        toute l'équipe, ou un commercial (rep_id)
 *   autres rôles leurs propres ventes, quel que soit le rep_id demandé
 *
 * « Les ventes d'un commercial » = celles qui lui sont créditées (rep_id)
 * ET celles saisies depuis son compte (owner). Une vente saisie par une
 * commerciale mais créditée à un collègue reste ainsi visible dans SON
 * historique, signalée (attribution_mismatch) pour que l'administrateur
 * puisse la réattribuer.
 *
 * Les dates sont des jours locaux (Africa/Casablanca), comme la paie : une
 * vente du 31 à 23 h ne bascule pas sur le mois suivant.
 * ------------------------------------------------------------------ */
const HISTORY_LIMIT_MAX = 5000;

function dayParam(value, label) {
  const s = String(value || "").trim();
  if (!s) return null;
  // Le format ET le calendrier : « 2026-13-01 » ou « 2026-02-30 » ne doivent
  // pas atteindre la base, où la conversion échouerait en erreur 500.
  const d = new Date(s + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new HttpError(400, `${label} doit être une date valide au format AAAA-MM-JJ.`);
  }
  return s;
}

router.get("/sales/history", requireUser, async (req, res, next) => {
  try {
    const teamId = teamScope(req);
    const from = dayParam(req.query.from, "La date de début");
    const to = dayParam(req.query.to, "La date de fin");
    if (from && to && from > to) throw new HttpError(400, "La date de début doit précéder la date de fin.");
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), HISTORY_LIMIT_MAX);
    const q = String(req.query.q || "").trim().slice(0, 100).toLowerCase();

    const where = ["s.team_id = $1"];
    const params = [teamId];
    const bind = (value) => { params.push(value); return `$${params.length}`; };

    let scope = "team";
    let rep = null;
    if (!isAdmin(req)) {
      scope = "me";
      const own = req.profile && req.profile.salesperson_id;
      where.push(own
        ? `(s.rep_id = ${bind(own)} or s.owner = ${bind(req.user.id)})`
        : `s.owner = ${bind(req.user.id)}`);
    } else if (req.query.rep_id) {
      rep = await db.one(
        `select id, name, auth_id from public.salespersons where id = $1 and team_id = $2`,
        [String(req.query.rep_id), teamId]
      );
      if (!rep) throw new HttpError(404, "That salesperson is not on your team.");
      scope = "rep";
      where.push(rep.auth_id
        ? `(s.rep_id = ${bind(rep.id)} or s.owner = ${bind(rep.auth_id)})`
        : `s.rep_id = ${bind(rep.id)}`);
    }
    if (from) where.push(`(s.created_at at time zone 'Africa/Casablanca')::date >= ${bind(from)}::date`);
    if (to) where.push(`(s.created_at at time zone 'Africa/Casablanca')::date <= ${bind(to)}::date`);
    if (q) {
      const p = bind(`%${q}%`);
      where.push(`(lower(s.customer) like ${p} or lower(coalesce(s.perfume_name, '')) like ${p}
               or lower(s.product) like ${p} or lower(coalesce(s.rep_name, '')) like ${p})`);
    }
    const whereSql = where.join(" and ");

    const rows = await db.many(
      `select s.id, s.created_at, s.customer, s.product, s.perfume_name, s.qty, s.amount,
              s.commission, s.pay, s.rep_id, s.rep_name, s.remarks, s.client_id, s.owner,
              p.full_name as recorded_by, p.salesperson_id as recorded_by_rep
         from public.sales s
         left join public.profiles p on p.id = s.owner
        where ${whereSql}
        order by s.created_at desc
        limit $${params.length + 1}`,
      [...params, limit]
    );

    // Agrégats sur TOUTE la sélection, pas seulement sur les lignes renvoyées.
    const groups = await db.many(
      `select s.rep_id, coalesce(max(r.name), max(s.rep_name)) as rep_name,
              count(*)::int as sales_count,
              coalesce(sum(s.qty), 0)::int as units,
              coalesce(sum(s.amount), 0)::bigint as revenue,
              coalesce(sum(s.commission), 0)::bigint as commission,
              max(s.created_at) as last_sale_at
         from public.sales s
         left join public.salespersons r on r.id = s.rep_id
        where ${whereSql}
        group by s.rep_id`,
      params
    );

    const byRep = groups.map((g) => ({
      rep_id: g.rep_id,
      rep_name: g.rep_name || (g.rep_id ? "—" : "Sans commercial"),
      sales_count: Number(g.sales_count) || 0,
      units: Number(g.units) || 0,
      revenue: Number(g.revenue) || 0,
      commission: Number(g.commission) || 0,
      last_sale_at: g.last_sale_at || null,
    }));

    // Vue équipe : chaque commercial apparaît, même sans vente sur la période
    // — c'est précisément ce qu'un administrateur cherche à voir.
    if (scope === "team" && !q) {
      const roster = await db.many(
        `select id, name from public.salespersons where team_id = $1 order by name`, [teamId]
      );
      for (const r of roster) {
        if (!byRep.some((g) => g.rep_id === r.id)) {
          byRep.push({ rep_id: r.id, rep_name: r.name, sales_count: 0, units: 0, revenue: 0, commission: 0, last_sale_at: null });
        }
      }
    }
    byRep.sort((a, b) => b.revenue - a.revenue || a.rep_name.localeCompare(b.rep_name, "fr"));

    const summary = byRep.reduce((acc, g) => {
      acc.sales_count += g.sales_count;
      acc.units += g.units;
      acc.revenue += g.revenue;
      acc.commission += g.commission;
      return acc;
    }, { sales_count: 0, units: 0, revenue: 0, commission: 0 });
    summary.avg_basket = summary.sales_count ? Math.round(summary.revenue / summary.sales_count) : 0;

    const out = rows.map((s) => ({
      ...s,
      amount: Number(s.amount) || 0,
      commission: Number(s.commission) || 0,
      // Saisie depuis le compte d'un commercial, mais créditée à un autre.
      attribution_mismatch: Boolean(s.recorded_by_rep && s.recorded_by_rep !== s.rep_id),
    }));

    return res.json({
      scope,
      rep: rep ? { id: rep.id, name: rep.name } : null,
      from, to,
      timezone: crm.TIMEZONE,
      rows: out,
      summary,
      by_rep: byRep,
      truncated: summary.sales_count > out.length,
      mismatches: out.filter((s) => s.attribution_mismatch).length,
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * RÉATTRIBUER UNE VENTE (administrateur)                              *
 * -------------------------------------------------------------------
 * PATCH /api/sales/:id/rep   { rep_id }
 *
 * Déplace la vente ET ce qu'elle a apporté (unités, CA, commission, XP) de
 * l'ancien commercial vers le nouveau, dans une seule transaction. Les mois
 * de paie déjà clôturés sont figés : une vente de ces mois-là ne bouge plus.
 * ------------------------------------------------------------------ */
router.patch("/sales/:id/rep", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);
    const targetId = String((req.body && req.body.rep_id) || "").trim();
    if (!targetId) throw new HttpError(400, "Choisissez le commercial à créditer.");

    const result = await db.tx(async (client) => {
      const one = async (text, values) => (await client.query(text, values)).rows[0] || null;

      const sale = await one(
        `select * from public.sales where id = $1 and team_id = $2 for update`, [req.params.id, teamId]
      );
      if (!sale) throw new HttpError(404, "That sale is not on your team.");
      const target = await one(
        `select id, name from public.salespersons where id = $1 and team_id = $2`, [targetId, teamId]
      );
      if (!target) throw new HttpError(400, "That salesperson is not on your team.");
      // Rien à déplacer : on le dit, plutôt que de répondre « réattribuée »
      // alors que la liste ne peut pas changer.
      if (sale.rep_id === target.id) {
        throw new HttpError(400, `Cette vente est déjà créditée à ${target.name}. Choisissez un autre commercial.`);
      }

      const saleDay = localDay(sale.created_at) || crm.todayLocal();
      const locked = await one(
        `select 1 as locked from public.payroll_periods
          where team_id = $1 and period = $2 and rep_id = any($3::uuid[])
            and status in ('CLOTURE', 'VALIDEE', 'PAYEE')
          limit 1`,
        [teamId, crm.periodStart(saleDay), [sale.rep_id, target.id].filter(Boolean)]
      );
      if (locked) {
        throw new HttpError(409, "La paie de ce mois est clôturée : cette vente ne peut plus changer de commercial.");
      }

      const isToday = saleDay === crm.todayLocal();
      const reps = (await client.query(
        `select * from public.salespersons where id = any($1::uuid[]) and team_id = $2 for update`,
        [[sale.rep_id, target.id].filter(Boolean), teamId]
      )).rows;

      const save = (repRow, stats) => client.query(
        `update public.salespersons
            set sales = $2, today_sales = $3, revenue = $4, commission = $5,
                xp = $6, level = $7, xp_to_next = $8, badges = $9::jsonb
          where id = $1`,
        [repRow.id, stats.sales, stats.today_sales, stats.revenue, stats.commission,
         stats.xp, stats.level, stats.xp_to_next, JSON.stringify(stats.badges)]
      );
      const previous = reps.find((r) => r.id === sale.rep_id);
      const next = reps.find((r) => r.id === target.id);
      if (previous) await save(previous, applySaleToRep(previous, sale, -1, isToday));
      if (next) await save(next, applySaleToRep(next, sale, 1, isToday));

      return one(
        `update public.sales set rep_id = $2, rep_name = $3 where id = $1 returning *`,
        [sale.id, target.id, target.name]
      );
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

/* Kept for parity with the "sales: mine or admin update/delete" policies, which
   the current UI does not call but the schema granted. */
router.delete("/sales/:id", requireUser, async (req, res, next) => {
  try {
    const sale = await db.one(
      `select id, owner from public.sales where id = $1 and team_id = $2`,
      [req.params.id, teamScope(req)]
    );
    if (!sale) throw new HttpError(404, "That sale is not on your team.");
    if (!canMutateSale(req, sale)) throw new HttpError(403, "You can only remove your own sales.");
    await db.query(`delete from public.sales where id = $1`, [sale.id]);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * PROFILE                                                             *
 * ------------------------------------------------------------------ */
const PROFILE_FIELDS = ["full_name", "city", "hue"];

router.get("/profile", requireUser, async (req, res, next) => {
  try {
    const row = await db.one(`select * from public.profiles where id = $1`, [req.user.id]);
    return res.json(row || null);
  } catch (err) {
    return next(err);
  }
});

router.patch("/profile", requireUser, async (req, res, next) => {
  try {
    // "profiles: self update" — the WHERE clause is the caller's own id, so
    // there is no path to another user's row. `role` and `team_id` are not in
    // the allow-list: they were writable under RLS, which let any user promote
    // themselves to admin.
    const fields = pick(req.body || {}, PROFILE_FIELDS);
    const keys = Object.keys(fields);
    if (!keys.length) return res.json({ ok: true });

    const setSql = keys.map((k, i) => `"${k}" = $${i + 2}`).join(", ");
    await db.query(
      `update public.profiles set ${setSql} where id = $1`,
      [req.user.id, ...keys.map((k) => fields[k])]
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * CHALLENGES                                                          *
 * ------------------------------------------------------------------ */
const CHALLENGE_FIELDS = ["title", "description", "reward", "icon", "hue", "target", "current", "ends"];

router.get("/challenges", requireUser, async (req, res, next) => {
  try {
    const rows = await db.many(
      `select * from public.challenges where team_id = $1 order by created_at desc`,
      [teamScope(req)]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/challenges", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);
    const fields = pick(req.body || {}, CHALLENGE_FIELDS);
    if (!fields.title || !String(fields.title).trim()) {
      throw new HttpError(400, "A challenge needs a title.");
    }
    const target = Number(fields.target);
    if (!Number.isInteger(target) || target <= 0) {
      throw new HttpError(400, "A challenge needs a positive target in units.");
    }
    fields.target = target;
    fields.current = fields.current === undefined ? 0 : Number(fields.current);
    if (!Number.isInteger(fields.current) || fields.current < 0 || fields.current > target) {
      throw new HttpError(400, "Challenge progress must be between zero and the target.");
    }
    if (fields.ends === "") fields.ends = null;

    const { text, values } = insertSql("challenges", {
      owner: req.user.id,
      team_id: teamId,
      ...fields,
    });
    const { rows } = await db.query(text, values);
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
