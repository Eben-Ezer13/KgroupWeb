/* =========================================================================
   KGROUP — Règles communes aux ventes et aux précommandes
   -------------------------------------------------------------------------
   Utilisé par routes/data.js (ventes) et routes/preorders.js (précommandes),
   pour qu'une précommande livrée devienne une vente exactement comme une
   vente saisie directement.

     resolveRep()     à qui la vente est créditée
     resolveClient()  le client rattaché (retrouvé par son numéro, ou créé)
     applySaleToRep() miroir JavaScript du trigger apply_sale() (schema.sql),
                      utilisé quand un administrateur réattribue une vente
   ========================================================================= */
"use strict";

const db = require("./db");
const crm = require("./crm");
const { HttpError, isAdmin } = require("./policies");

/**
 * Commercial crédité par une vente ou une précommande.
 *
 * Un commercial (ou un chargé de relation client) enregistre toujours à SON
 * nom : le serveur ignore le rep_id envoyé. Le formulaire verrouillait déjà
 * ce champ, mais une réinitialisation du formulaire le repositionnait sur le
 * premier commercial de la liste — la vente suivante était alors créditée à
 * un collègue, et disparaissait de l'historique de son véritable auteur.
 *
 * Un administrateur choisit librement, dans sa propre équipe.
 *
 * @returns {Promise<{id: string, name: string}|null>}
 */
async function resolveRep(req, teamId, requestedRepId) {
  if (!isAdmin(req)) {
    const own = req.profile && req.profile.salesperson_id;
    if (!own) return null;
    return db.one(`select id, name from public.salespersons where id = $1 and team_id = $2`, [own, teamId]);
  }
  if (!requestedRepId) return null;
  const rep = await db.one(
    `select id, name from public.salespersons where id = $1 and team_id = $2`,
    [requestedRepId, teamId]
  );
  // A sale credits its rep through the apply_sale() trigger, so the rep must
  // be on the caller's own team. Supabase's RLS never checked this.
  if (!rep) throw new HttpError(400, "That salesperson is not on your team.");
  return rep;
}

/**
 * Retrouve ou cree le client rattache a une vente.
 *
 * Regle anti-doublon : la cle est le NUMERO normalise, unique par equipe. Si
 * le client existe deja on le reutilise tel quel -- on ne lui vole pas son
 * commercial responsable, meme si la vente est realisee par quelqu un d autre.
 * C est ce qui permet a `clients.rep_id` (responsable de la relation) et
 * `sales.rep_id` (auteur de la vente) de diverger sans perdre l historique.
 *
 * Sans numero exploitable, la vente reste enregistree sans client : le nom
 * libre `sales.customer` continue de faire foi, comme avant cette evolution.
 *
 * @returns {Promise<string|null>} l id du client, ou null
 */
async function resolveClient(req, teamId, body, fields) {
  // 1. Un client explicitement choisi dans le formulaire.
  if (body.client_id) {
    const found = await db.one(
      `select id from public.clients where id = $1 and team_id = $2`, [body.client_id, teamId]
    );
    if (!found) throw new HttpError(400, "Ce client n appartient pas a votre equipe.");
    return found.id;
  }

  const phone = crm.normalizePhone(body.client_phone);
  if (!phone) {
    // Un numero saisi mais invalide doit etre signale, pas ignore en silence.
    if (String(body.client_phone || "").trim()) {
      throw new HttpError(400, "Le numero de telephone du client n est pas valide.");
    }
    return null;
  }

  const existing = await db.one(
    `select id, birthday from public.clients where team_id = $1 and phone_e164 = $2`, [teamId, phone]
  );

  if (existing) {
    // Enrichissement : on complete une date d anniversaire manquante, sans
    // jamais ecraser une valeur deja connue.
    if (!existing.birthday && body.client_birthday) {
      const b = String(body.client_birthday).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(b)) {
        await db.query(`update public.clients set birthday = $2 where id = $1`, [existing.id, b]);
      }
    }
    return existing.id;
  }

  // 2. Creation. Le responsable par defaut est l auteur de la vente.
  const name = String(fields.customer || "").trim();
  if (!name) return null;
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(String(body.client_birthday || "").slice(0, 10))
    ? String(body.client_birthday).slice(0, 10)
    : null;
  const repId = fields.rep_id || (req.profile && req.profile.salesperson_id) || null;

  const { rows } = await db.query(
    `insert into public.clients (team_id, rep_id, name, phone, phone_e164, birthday)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (team_id, phone_e164) where phone_e164 is not null
       do update set name = clients.name
     returning id`,
    [teamId, repId, name, String(body.client_phone).trim(), phone, birthday]
  );
  return rows[0].id;
}

/* ------------------------------------------------------------------ *
 * Statistiques d'un commercial — miroir de apply_sale()               *
 * ------------------------------------------------------------------ */
const LEVELS = ["Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond"];
const XP_PER_LEVEL = 1700;

/** XP d'une vente : ~1 XP pour 60 DHS, 10 au minimum (comme le trigger). */
const xpForAmount = (amount) => Math.max(10, Math.round((Number(amount) || 0) / 60));

/** Niveau atteint pour un total d'XP (6 niveaux, 1700 XP chacun). */
function levelFor(xp) {
  const idx = Math.min(LEVELS.length - 1, Math.floor(Math.max(0, xp) / XP_PER_LEVEL));
  return { level: LEVELS[idx], xp_to_next: (idx + 1) * XP_PER_LEVEL };
}

/**
 * Statistiques d'un commercial après l'ajout (sign = 1) ou le retrait
 * (sign = -1) d'une vente. Aucun compteur ne passe sous zéro.
 *
 * Les badges suivent le trigger à l'ajout ; au retrait ils sont conservés :
 * un badge est une étape franchie, pas un solde.
 *
 * @param {object}  rep      ligne salespersons
 * @param {object}  sale     ligne sales (qty, amount, commission)
 * @param {1|-1}    sign
 * @param {boolean} isToday  la vente compte-t-elle dans today_sales ?
 */
function applySaleToRep(rep, sale, sign, isToday) {
  const qty = (Number(sale.qty) || 0) * sign;
  const amount = (Number(sale.amount) || 0) * sign;
  const commission = (Number(sale.commission) || 0) * sign;
  const xp = xpForAmount(sale.amount) * sign;
  const floor0 = (n) => Math.max(0, n);

  const next = {
    sales: floor0((Number(rep.sales) || 0) + qty),
    today_sales: floor0((Number(rep.today_sales) || 0) + (isToday ? qty : 0)),
    revenue: floor0((Number(rep.revenue) || 0) + amount),
    commission: floor0((Number(rep.commission) || 0) + commission),
    xp: floor0((Number(rep.xp) || 0) + xp),
  };
  Object.assign(next, levelFor(next.xp));

  let badges = Array.isArray(rep.badges) ? rep.badges.slice() : [];
  if (typeof rep.badges === "string") {
    try { badges = JSON.parse(rep.badges) || []; } catch (_) { badges = []; }
  }
  if (sign > 0) {
    if (next.sales >= 1 && !badges.includes("starter")) badges.push("starter");
    if (next.sales >= 50 && !badges.includes("closer")) badges.push("closer");
    if (next.revenue >= 100000 && !badges.includes("revenue")) badges.push("revenue");
  }
  next.badges = badges;
  return next;
}

/** Jour local (Maroc) d'un horodatage, « AAAA-MM-JJ », ou null. */
function localDay(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : crm.todayLocal(crm.TIMEZONE, d);
}

module.exports = {
  resolveRep, resolveClient, applySaleToRep, xpForAmount, levelFor, localDay, LEVELS,
};
