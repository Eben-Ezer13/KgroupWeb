/* =========================================================================
   KGROUP — Fil de notifications (logique pure, sans DOM)
   -------------------------------------------------------------------------
   Alimente la cloche de la barre du haut (dashboard.js) et le bloc
   « Dernières notifications » du tableau de bord. Aucune dépendance au
   navigateur : le même fichier est chargé tel quel par les tests Node
   (tests/notifications.test.js).

   Sources fusionnées, du plus récent au plus ancien :
     - le fil de l'équipe (GET /api/notifications) : anniversaires clients,
       réussites de formation. Le serveur filtre déjà par rôle ;
     - les ventes récentes ;
     - les challenges.

   Lu / non lu : est « non lu » tout élément plus récent que le dernier
   passage de l'utilisateur. Ce passage est un horodatage (et non l'id du
   dernier élément vu) : une vente qui arrive au milieu du fil est donc bien
   signalée, quel que soit l'ordre des sources.
   ========================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KGNotifFeed = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_ITEMS = 20;

  /* Type d'événement -> icône, teinte, et page qui permet d'agir dessus.
     Les teintes reprennent celles du bloc du tableau de bord
     (success / info / gold). */
  const KINDS = {
    birthday_today:     { icon: "gift",  tone: "gold",    href: "clients.html" },
    birthday_tomorrow:  { icon: "gift",  tone: "info",    href: "clients.html" },
    training_completed: { icon: "medal", tone: "gold",    href: "formation.html" },
    sale:               { icon: "bag",   tone: "success", href: "sales.html" },
    challenge:          { icon: "flag",  tone: "gold",    href: "challenges.html" },
    team:               { icon: "bell",  tone: "info",    href: null },
  };

  const DEFAULT_LABELS = { newSale: "New sale", newChallenge: "New challenge", by: "by" };

  /** Horodatage en ms, ou 0 si la valeur n'est pas une date exploitable. */
  function toMs(value) {
    if (value == null || value === "") return 0;
    const ms = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }

  /** Les titres viennent de la base (produits, clients, challenges) : on les
      échappe avant toute insertion dans le HTML. */
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function item(id, kindName, title, body, ts) {
    const kind = KINDS[kindName] || KINDS.team;
    return { id, kind: kindName, icon: kind.icon, tone: kind.tone, href: kind.href, title, body: body || "", ts };
  }

  /**
   * Construit le fil trié et marque les éléments non lus.
   *
   * @param {object} src   { team: [], sales: [], challenges: [] }
   *   team        lignes de /api/notifications : { id, type, title, body, created_at }
   *   sales       ventes : { id, product, qty, rep, at } (ou { minsAgo } en démo)
   *   challenges  challenges : { id, title, createdAt }
   * @param {object} opts  { seenAt, now, labels, limit }
   * @returns {Array} éléments { id, kind, icon, tone, href, title, body, ts, unread }
   */
  function buildFeed(src, opts) {
    const s = src || {};
    const o = opts || {};
    const now = toMs(o.now) || Date.now();
    const seenAt = toMs(o.seenAt);
    const labels = Object.assign({}, DEFAULT_LABELS, o.labels || {});
    const limit = o.limit || MAX_ITEMS;
    const feed = [];

    (s.team || []).forEach((n) => {
      if (!n || n.id == null) return;
      const kindName = KINDS[n.type] ? n.type : "team";
      feed.push(item("t:" + n.id, kindName, n.title || "", n.body || "", toMs(n.created_at)));
    });

    (s.sales || []).forEach((sale) => {
      if (!sale || sale.id == null) return;
      const qty = Number(sale.qty) > 1 ? " ×" + sale.qty : "";
      const ts = toMs(sale.at) || (sale.minsAgo != null ? now - sale.minsAgo * 60000 : 0);
      const rep = sale.rep && sale.rep !== "—" ? labels.by + " " + sale.rep : "";
      feed.push(item("s:" + sale.id, "sale", labels.newSale + " — " + (sale.product || "") + qty, rep, ts));
    });

    (s.challenges || []).forEach((c) => {
      if (!c || c.id == null) return;
      feed.push(item("c:" + c.id, "challenge", labels.newChallenge + " — " + (c.title || ""), c.reward && c.reward !== "—" ? "🎁 " + c.reward : "", toMs(c.createdAt)));
    });

    // Un même événement ne doit apparaître qu'une fois (rafraîchissements
    // successifs, sources qui se recouvrent).
    const seen = new Set();
    const unique = feed.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));

    // Tri stable : du plus récent au plus ancien ; les éléments sans date
    // (challenges de démo) restent en fin de fil, dans leur ordre d'origine.
    unique.sort((a, b) => b.ts - a.ts);

    return unique.slice(0, limit).map((n) => Object.assign(n, { unread: n.ts > 0 && n.ts > seenAt }));
  }

  /** Nombre d'éléments non lus. */
  function unreadCount(feed) {
    return (feed || []).filter((n) => n.unread).length;
  }

  /** Texte de la pastille : rien à 0, « 9+ » au-delà de 9. */
  function badgeLabel(count) {
    if (!count || count < 0) return "";
    return count > 9 ? "9+" : String(count);
  }

  /** Nouvel horodatage « vu jusqu'à » après ouverture du fil. On retient la
      date du plus récent élément affiché (et non l'horloge du navigateur) :
      un écart d'horloge entre le poste et le serveur ne peut ni masquer un
      événement futur, ni en faire réapparaître un ancien. */
  function markSeen(feed, previousSeenAt) {
    const latest = (feed || []).reduce((max, n) => Math.max(max, n.ts || 0), 0);
    return Math.max(toMs(previousSeenAt), latest);
  }

  /** « il y a 5 minutes », « hier », « 5 minutes ago »… dans la langue active. */
  function relativeTime(ts, now, lang) {
    const t = toMs(ts);
    if (!t) return "";
    const diff = Math.round((t - (toMs(now) || Date.now())) / 1000); // négatif = passé
    const abs = Math.abs(diff);
    const locale = lang || "en";
    let rtf;
    try { rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }); }
    catch (_) { rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); }
    if (abs < 45) return rtf.format(0, "second");
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), "day");
    return new Date(t).toLocaleDateString(locale);
  }

  /** Clé de stockage du « vu jusqu'à », propre à chaque compte : deux
      personnes qui partagent un navigateur ne se volent pas leurs non-lus. */
  function storageKey(userId) {
    return "kg-notif-seen-at:" + (userId || "anon");
  }

  return { KINDS, MAX_ITEMS, toMs, escapeHtml, buildFeed, unreadCount, badgeLabel, markSeen, relativeTime, storageKey };
});
