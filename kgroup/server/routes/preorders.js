/* =========================================================================
   KGROUP — /api/preorders/*   (précommandes)
   -------------------------------------------------------------------------
     GET    /api/preorders                 liste : status, rep_id, q, limit
     POST   /api/preorders                 enregistrer une précommande
     PATCH  /api/preorders/:id             modifier (acompte, date prévue…)
     POST   /api/preorders/:id/deliver     valider en vente (paiement reçu ou
                                           parfum remis) -> crée la vente
     POST   /api/preorders/:id/cancel      annuler

   PÉRIMÈTRE (clause WHERE, comme partout ailleurs)
     admin         toutes les précommandes de l'équipe
     autres rôles  celles qui leur sont créditées ou qu'ils ont saisies

   Une précommande ne compte nulle part tant qu'elle n'est pas validée en
   vente — quand le client a payé ou reçu son parfum. Une vente ordinaire est
   alors insérée : les triggers apply_sale() et apply_sale_client() mettent à
   jour le commercial et le client, et la commission entre dans la paie du
   mois de la date de vente choisie.
   ========================================================================= */
"use strict";

const express = require("express");

const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError, teamScope, isAdmin } = require("../policies");
const crm = require("../crm");
const { resolveRep, resolveClient } = require("../sales");
const { ensurePreorderSchema } = require("../preorders");

const router = express.Router();

const STATUSES = ["EN_ATTENTE", "LIVREE", "ANNULEE"];
const TEXT_MAX = { customer: 120, product: 60, perfume_name: 120, pay: 40, remarks: 1000, cancel_reason: 300, client_phone: 40 };

/* ------------------------------------------------------------------ *
 * Validation                                                          *
 * ------------------------------------------------------------------ */
function text(value, field, { required = false, label } = {}) {
  const s = String(value == null ? "" : value).trim();
  if (!s) {
    if (required) throw new HttpError(400, `${label || field} est obligatoire.`);
    return null;
  }
  if (TEXT_MAX[field] && s.length > TEXT_MAX[field]) {
    throw new HttpError(400, `${label || field} est trop long (${TEXT_MAX[field]} caractères maximum).`);
  }
  return s;
}

function amount(value, label, { max = 100_000_000 } = {}) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `${label} doit être un montant positif.`);
  return Math.round(n);
}

function day(value, label) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return null;
  // Format ET calendrier : « 2026-02-30 » est refusé ici plutôt qu'en base.
  const d = new Date(s + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new HttpError(400, `${label} doit être une date valide au format AAAA-MM-JJ.`);
  }
  return s;
}

/** Périmètre du demandeur, en fragment SQL sur l'alias `p`. */
function scopeFor(req) {
  const teamId = teamScope(req);
  if (isAdmin(req)) return { where: "p.team_id = $1", params: [teamId] };
  const own = req.profile && req.profile.salesperson_id;
  if (own) return { where: "p.team_id = $1 and (p.rep_id = $2 or p.owner = $3)", params: [teamId, own, req.user.id] };
  return { where: "p.team_id = $1 and p.owner = $2", params: [teamId, req.user.id] };
}

/** Champs dérivés affichés tels quels par le navigateur. */
function decorate(row, today) {
  const amt = Number(row.amount) || 0;
  const deposit = Number(row.deposit) || 0;
  const expected = row.expected_at ? String(row.expected_at).slice(0, 10) : null;
  return {
    ...row,
    unit_price: Number(row.unit_price) || 0,
    amount: amt,
    commission: Number(row.commission) || 0,
    deposit,
    balance: Math.max(0, amt - deposit),
    expected_at: expected,
    overdue: row.status === "EN_ATTENTE" && Boolean(expected) && expected < today,
  };
}

async function findInScope(client, req, id, lock) {
  const scope = scopeFor(req);
  const { rows } = await client.query(
    `select p.* from public.preorders p
      where ${scope.where} and p.id = $${scope.params.length + 1}${lock ? " for update" : ""}`,
    [...scope.params, id]
  );
  if (!rows[0]) throw new HttpError(404, "Précommande introuvable.");
  return rows[0];
}

const frDate = (ts) => {
  const d = crm.todayLocal(crm.TIMEZONE, new Date(ts));
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
};

/* ------------------------------------------------------------------ *
 * LISTE                                                               *
 * ------------------------------------------------------------------ */
router.get("/preorders", requireUser, async (req, res, next) => {
  try {
    await ensurePreorderSchema();
    const scope = scopeFor(req);
    const params = [...scope.params];
    const bind = (v) => { params.push(v); return `$${params.length}`; };
    const filters = [scope.where];

    if (isAdmin(req) && req.query.rep_id) filters.push(`p.rep_id = ${bind(String(req.query.rep_id))}`);
    const q = String(req.query.q || "").trim().slice(0, 100).toLowerCase();
    if (q) {
      const p = bind(`%${q}%`);
      filters.push(`(lower(p.customer) like ${p} or lower(coalesce(p.perfume_name, '')) like ${p}
                  or lower(p.product) like ${p} or coalesce(p.client_phone, '') like ${p})`);
    }
    const baseWhere = filters.join(" and ");

    // Compteurs par statut : ils alimentent les onglets, quel que soit le
    // statut affiché.
    const counts = await db.many(
      `select p.status, count(*)::int as n,
              coalesce(sum(p.amount), 0)::bigint as amount,
              coalesce(sum(p.deposit), 0)::bigint as deposit
         from public.preorders p where ${baseWhere} group by p.status`,
      params
    );

    const status = String(req.query.status || "").toUpperCase();
    const listFilters = [baseWhere];
    const listParams = [...params];
    if (status && status !== "ALL") {
      if (!STATUSES.includes(status)) throw new HttpError(400, "Statut invalide.");
      listParams.push(status);
      listFilters.push(`p.status = $${listParams.length}`);
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000);
    listParams.push(limit);

    const rows = await db.many(
      `select p.*, r.name as current_rep_name
         from public.preorders p
         left join public.salespersons r on r.id = p.rep_id
        where ${listFilters.join(" and ")}
        order by case when p.status = 'EN_ATTENTE' then 0 else 1 end,
                 p.expected_at asc nulls last, p.created_at desc
        limit $${listParams.length}`,
      listParams
    );

    const today = crm.todayLocal();
    const summary = Object.fromEntries(STATUSES.map((s) => [s, { count: 0, amount: 0, deposit: 0 }]));
    for (const c of counts) {
      if (summary[c.status]) {
        summary[c.status] = { count: Number(c.n) || 0, amount: Number(c.amount) || 0, deposit: Number(c.deposit) || 0 };
      }
    }
    return res.json({
      scope: isAdmin(req) ? "team" : "me",
      today,
      summary,
      rows: rows.map((r) => decorate(r, today)),
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * CRÉATION                                                            *
 * ------------------------------------------------------------------ */
router.post("/preorders", requireUser, async (req, res, next) => {
  try {
    await ensurePreorderSchema();
    const teamId = teamScope(req);
    const b = req.body || {};

    const customer = text(b.customer, "customer", { required: true, label: "Le nom du client" });
    const product = text(b.product, "product", { required: true, label: "Le produit" });
    const perfumeName = text(b.perfume_name, "perfume_name", { label: "Le nom du parfum" });
    const qty = Number(b.qty === undefined ? 1 : b.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
      throw new HttpError(400, "La quantité doit être un nombre entier entre 1 et 1000.");
    }
    const unitPrice = amount(b.unit_price, "Le prix unitaire");
    const total = b.amount === undefined || b.amount === null || b.amount === ""
      ? unitPrice * qty
      : amount(b.amount, "Le montant");
    const commission = amount(b.commission, "La commission");
    const deposit = amount(b.deposit, "L'acompte");
    if (deposit > total) throw new HttpError(400, "L'acompte ne peut pas dépasser le montant de la précommande.");
    const expectedAt = day(b.expected_at, "La date de livraison prévue");
    if (expectedAt && expectedAt < crm.todayLocal()) {
      throw new HttpError(400, "La date de livraison prévue ne peut pas être déjà passée.");
    }

    const rep = await resolveRep(req, teamId, b.rep_id || null);
    const clientId = await resolveClient(req, teamId, b, { customer, rep_id: rep ? rep.id : null });

    const { rows } = await db.query(
      `insert into public.preorders
         (team_id, owner, rep_id, rep_name, client_id, customer, client_phone, product,
          perfume_name, qty, unit_price, amount, commission, deposit, pay, expected_at, remarks)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       returning *`,
      [teamId, req.user.id, rep ? rep.id : null, rep ? rep.name : null, clientId, customer,
       text(b.client_phone, "client_phone", { label: "Le numéro de téléphone" }), product, perfumeName, qty, unitPrice, total,
       commission, deposit, text(b.pay, "pay", { label: "Le mode de paiement" }), expectedAt,
       text(b.remarks, "remarks", { label: "La remarque" })]
    );
    return res.status(201).json(decorate(rows[0], crm.todayLocal()));
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * MODIFICATION (précommande en attente uniquement)                    *
 * ------------------------------------------------------------------ */
router.patch("/preorders/:id", requireUser, async (req, res, next) => {
  try {
    await ensurePreorderSchema();
    const b = req.body || {};
    const updated = await db.tx(async (client) => {
      const po = await findInScope(client, req, req.params.id, true);
      if (po.status !== "EN_ATTENTE") throw new HttpError(409, "Seule une précommande en attente peut être modifiée.");

      const sets = {};
      if (b.deposit !== undefined) {
        const deposit = amount(b.deposit, "L'acompte");
        if (deposit > Number(po.amount)) throw new HttpError(400, "L'acompte ne peut pas dépasser le montant de la précommande.");
        sets.deposit = deposit;
      }
      if (b.expected_at !== undefined) sets.expected_at = day(b.expected_at, "La date de livraison prévue");
      if (b.remarks !== undefined) sets.remarks = text(b.remarks, "remarks", { label: "La remarque" });
      if (b.pay !== undefined) sets.pay = text(b.pay, "pay", { label: "Le mode de paiement" });
      const keys = Object.keys(sets);
      if (!keys.length) return po;

      const { rows } = await client.query(
        `update public.preorders set ${keys.map((k, i) => `"${k}" = $${i + 2}`).join(", ")}
          where id = $1 returning *`,
        [po.id, ...keys.map((k) => sets[k])]
      );
      return rows[0];
    });
    return res.json(decorate(updated, crm.todayLocal()));
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * VALIDATION EN VENTE (paiement reçu ou parfum remis)                 *
 * -------------------------------------------------------------------
 * body: { pay, sale_date }
 *   pay        mode de paiement du solde
 *   sale_date  jour de la vente (AAAA-MM-JJ), aujourd'hui par défaut : le
 *              jour où le client a payé. C'est lui qui décide du mois de paie
 *              où la commission est comptée.
 * ------------------------------------------------------------------ */
router.post("/preorders/:id/deliver", requireUser, async (req, res, next) => {
  try {
    await ensurePreorderSchema();
    const b = req.body || {};
    const saleDay = day(b.sale_date, "La date de la vente");
    const result = await db.tx(async (client) => {
      const po = await findInScope(client, req, req.params.id, true);
      if (po.status !== "EN_ATTENTE") {
        throw new HttpError(409, po.status === "LIVREE"
          ? "Cette précommande est déjà validée en vente."
          : "Cette précommande est annulée : elle ne peut plus devenir une vente.");
      }

      const today = crm.todayLocal();
      const orderedDay = crm.todayLocal(crm.TIMEZONE, new Date(po.created_at));
      if (saleDay && saleDay > today) {
        throw new HttpError(400, "La date de la vente ne peut pas être dans le futur.");
      }
      if (saleDay && saleDay < orderedDay) {
        throw new HttpError(400, `La vente ne peut pas précéder la précommande (${frDate(po.created_at)}).`);
      }
      // Un mois de paie clôturé est figé : y ajouter une vente créerait une
      // commission que la paie déjà arrêtée n'inclut pas.
      if (po.rep_id) {
        const { rows: locked } = await client.query(
          `select 1 as locked from public.payroll_periods
            where team_id = $1 and period = $2 and rep_id = any($3::uuid[])
              and status in ('CLOTURE', 'VALIDEE', 'PAYEE')
            limit 1`,
          [po.team_id, crm.periodStart(saleDay || today), [po.rep_id]]
        );
        if (locked.length) {
          throw new HttpError(409, "La paie de ce mois est clôturée : choisissez une date dans un mois ouvert.");
        }
      }

      const deposit = Number(po.deposit) || 0;
      const remarks = [
        `Précommande du ${frDate(po.created_at)}`,
        deposit > 0 ? `acompte ${deposit} DHS` : null,
        po.remarks,
      ].filter(Boolean).join(" — ");

      // La vente garde son auteur (le compte qui a pris la précommande) : elle
      // apparaît dans SON activité, même si c'est l'administrateur qui valide.
      // Aujourd'hui : l'heure exacte ; un jour passé : midi, heure du Maroc.
      const { rows: saleRows } = await client.query(
        `insert into public.sales
           (owner, team_id, rep_id, rep_name, client_id, customer, product, perfume_name,
            qty, amount, commission, pay, remarks, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 coalesce(($14::date + time '12:00') at time zone 'Africa/Casablanca', now()))
         returning *`,
        [po.owner || req.user.id, po.team_id, po.rep_id, po.rep_name, po.client_id, po.customer,
         po.product, po.perfume_name, po.qty, po.amount, po.commission,
         text(b.pay, "pay", { label: "Le mode de paiement" }) || po.pay || null, remarks,
         saleDay && saleDay !== today ? saleDay : null]
      );
      const sale = saleRows[0];

      // delivered_at = date de la vente : la liste affiche « vente du … ».
      const { rows } = await client.query(
        `update public.preorders set status = 'LIVREE', sale_id = $2, delivered_at = $3
          where id = $1 returning *`,
        [po.id, sale.id, sale.created_at]
      );
      return { preorder: rows[0], sale };
    });
    return res.json({ preorder: decorate(result.preorder, crm.todayLocal()), sale: result.sale });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * ANNULATION                                                          *
 * ------------------------------------------------------------------ */
router.post("/preorders/:id/cancel", requireUser, async (req, res, next) => {
  try {
    await ensurePreorderSchema();
    const reason = text((req.body || {}).reason, "cancel_reason", { label: "Le motif" });
    const updated = await db.tx(async (client) => {
      const po = await findInScope(client, req, req.params.id, true);
      if (po.status !== "EN_ATTENTE") {
        throw new HttpError(409, "Seule une précommande en attente peut être annulée.");
      }
      const { rows } = await client.query(
        `update public.preorders set status = 'ANNULEE', cancelled_at = now(), cancel_reason = $2
          where id = $1 returning *`,
        [po.id, reason]
      );
      return rows[0];
    });
    return res.json(decorate(updated, crm.todayLocal()));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
