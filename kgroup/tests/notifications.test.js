/* =========================================================================
   Tests du fil de notifications (cloche de la barre du haut).
   Logique pure de notifications.js, plus deux garde-fous sur le câblage :
   la cloche est bien à côté du bouton de thème, et chaque page de
   l'application charge le module avant dashboard.js.
   ========================================================================= */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const NF = require("../notifications");

const ROOT = path.join(__dirname, "..");
const NOW = Date.parse("2026-09-11T12:00:00Z");
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

const SOURCES = {
  team: [
    { id: 1, type: "birthday_tomorrow", title: "🎂 Anniversaire demain — Salma", body: "Téléphone : 06 12 34 56 78", created_at: minsAgo(30) },
    { id: 2, type: "training_completed", title: "Youssef a validé le module 3", body: "", created_at: minsAgo(300) },
  ],
  sales: [
    { id: "a", product: "Oud Royal 50ml", qty: 2, rep: "Amine", at: minsAgo(5) },
    { id: "b", product: "Musk 30ml", qty: 1, rep: "Sara", at: minsAgo(120) },
  ],
  challenges: [
    { id: "c1", title: "Sprint de septembre", reward: "Prime 500 DH", createdAt: minsAgo(60) },
  ],
};

/* ================= CONSTRUCTION DU FIL ================================== */

test("les sources sont fusionnées du plus récent au plus ancien", () => {
  const feed = NF.buildFeed(SOURCES, { now: NOW });
  assert.deepStrictEqual(feed.map((n) => n.id), ["s:a", "t:1", "c:c1", "s:b", "t:2"]);
});

test("chaque type ouvre la page où l'on peut agir", () => {
  const byId = Object.fromEntries(NF.buildFeed(SOURCES, { now: NOW }).map((n) => [n.id, n]));
  assert.strictEqual(byId["t:1"].href, "clients.html");
  assert.strictEqual(byId["t:1"].icon, "gift");
  assert.strictEqual(byId["t:2"].href, "formation.html");
  assert.strictEqual(byId["s:a"].href, "sales.html");
  assert.strictEqual(byId["c:c1"].href, "challenges.html");
});

test("un type inconnu reste affiché, sans lien", () => {
  const [n] = NF.buildFeed({ team: [{ id: 9, type: "nouveau_type", title: "X", created_at: minsAgo(1) }] }, { now: NOW });
  assert.strictEqual(n.kind, "team");
  assert.strictEqual(n.href, null);
  assert.strictEqual(n.icon, "bell");
});

test("le titre et le détail d'une vente sont lisibles et traduits", () => {
  const labels = { newSale: "Nouvelle vente", newChallenge: "Nouveau challenge", by: "par" };
  const feed = NF.buildFeed(SOURCES, { now: NOW, labels });
  const sale = feed.find((n) => n.id === "s:a");
  assert.strictEqual(sale.title, "Nouvelle vente — Oud Royal 50ml ×2");
  assert.strictEqual(sale.body, "par Amine");
  const single = feed.find((n) => n.id === "s:b");
  assert.strictEqual(single.title, "Nouvelle vente — Musk 30ml");
  const challenge = feed.find((n) => n.id === "c:c1");
  assert.strictEqual(challenge.title, "Nouveau challenge — Sprint de septembre");
  assert.strictEqual(challenge.body, "🎁 Prime 500 DH");
});

test("les ventes de démonstration (minsAgo) sont datées", () => {
  const [n] = NF.buildFeed({ sales: [{ id: 1, product: "P", qty: 1, minsAgo: 10 }] }, { now: NOW });
  assert.strictEqual(n.ts, NOW - 10 * 60000);
});

test("un même événement n'apparaît qu'une fois, et le fil est plafonné", () => {
  const dup = NF.buildFeed({ sales: [SOURCES.sales[0], SOURCES.sales[0]] }, { now: NOW });
  assert.strictEqual(dup.length, 1);
  const many = Array.from({ length: 50 }, (_, i) => ({ id: i, product: "P", qty: 1, at: minsAgo(i) }));
  assert.strictEqual(NF.buildFeed({ sales: many }, { now: NOW }).length, NF.MAX_ITEMS);
});

test("un élément sans date reste en fin de fil et n'est jamais « non lu »", () => {
  const feed = NF.buildFeed({ challenges: [{ id: "demo", title: "Demo" }], sales: [SOURCES.sales[1]] }, { now: NOW });
  assert.deepStrictEqual(feed.map((n) => n.id), ["s:b", "c:demo"]);
  assert.strictEqual(feed[1].unread, false);
});

test("des sources absentes ou vides donnent un fil vide", () => {
  assert.deepStrictEqual(NF.buildFeed(undefined, { now: NOW }), []);
  assert.deepStrictEqual(NF.buildFeed({ team: null, sales: [], challenges: undefined }, { now: NOW }), []);
});

/* ================= LU / NON LU ========================================== */

test("sans passage précédent, tout est non lu", () => {
  const feed = NF.buildFeed(SOURCES, { now: NOW });
  assert.strictEqual(NF.unreadCount(feed), 5);
});

test("seul ce qui est plus récent que le dernier passage est non lu", () => {
  const feed = NF.buildFeed(SOURCES, { now: NOW, seenAt: Date.parse(minsAgo(45)) });
  assert.deepStrictEqual(feed.filter((n) => n.unread).map((n) => n.id), ["s:a", "t:1"]);
});

test("une vente arrivée au milieu du fil est bien signalée", () => {
  // Régression : l'ancien suivi retenait l'id du premier élément vu, si bien
  // qu'une vente classée après une notification d'équipe restait « lue ».
  const seenAt = NF.markSeen(NF.buildFeed(SOURCES, { now: NOW }), 0);
  const later = { ...SOURCES, sales: [{ id: "new", product: "Ambre", qty: 1, rep: "Amine", at: new Date(NOW + 60000).toISOString() }, ...SOURCES.sales] };
  const feed = NF.buildFeed(later, { now: NOW + 60000, seenAt });
  assert.deepStrictEqual(feed.filter((n) => n.unread).map((n) => n.id), ["s:new"]);
});

test("marquer comme lu retient le plus récent élément, sans jamais reculer", () => {
  const feed = NF.buildFeed(SOURCES, { now: NOW });
  assert.strictEqual(NF.markSeen(feed, 0), Date.parse(minsAgo(5)));
  const future = NOW + 86400000;
  assert.strictEqual(NF.markSeen(feed, future), future);
  assert.strictEqual(NF.markSeen([], 1234), 1234);
  const after = NF.buildFeed(SOURCES, { now: NOW, seenAt: NF.markSeen(feed, 0) });
  assert.strictEqual(NF.unreadCount(after), 0);
});

test("la pastille affiche le nombre, et « 9+ » au-delà de neuf", () => {
  assert.strictEqual(NF.badgeLabel(0), "");
  assert.strictEqual(NF.badgeLabel(-3), "");
  assert.strictEqual(NF.badgeLabel(4), "4");
  assert.strictEqual(NF.badgeLabel(9), "9");
  assert.strictEqual(NF.badgeLabel(10), "9+");
});

test("chaque compte a son propre « vu jusqu'à »", () => {
  assert.notStrictEqual(NF.storageKey("u1"), NF.storageKey("u2"));
  assert.strictEqual(NF.storageKey(undefined), "kg-notif-seen-at:anon");
});

/* ================= AFFICHAGE ============================================ */

test("les textes venus de la base sont échappés", () => {
  const evil = `<img src=x onerror="alert('x')">&`;
  assert.strictEqual(NF.escapeHtml(evil), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
  assert.strictEqual(NF.escapeHtml(null), "");
  assert.strictEqual(NF.escapeHtml(42), "42");
});

test("l'heure relative suit la langue active", () => {
  assert.strictEqual(NF.relativeTime(NOW - 10 * 1000, NOW, "en"), "now");
  assert.strictEqual(NF.relativeTime(NOW - 5 * 60000, NOW, "en"), "5 minutes ago");
  assert.strictEqual(NF.relativeTime(NOW - 5 * 60000, NOW, "fr"), "il y a 5 minutes");
  assert.strictEqual(NF.relativeTime(NOW - 86400000, NOW, "fr"), "hier");
  assert.strictEqual(NF.relativeTime(0, NOW, "fr"), "");
});

/* ================= CÂBLAGE ============================================== */

test("la cloche est dans la barre du haut, juste après le bouton de thème", () => {
  const src = fs.readFileSync(path.join(ROOT, "dashboard.js"), "utf8");
  const theme = src.indexOf('id="themeBtn"');
  const bell = src.indexOf('id="notifDropdown"');
  const avatarAfter = src.indexOf("${avatar(me, 42)}", theme);
  assert.ok(theme > 0, "bouton de thème introuvable");
  assert.ok(bell > theme && bell < avatarAfter, "la cloche doit suivre le bouton de thème");
  for (const id of ["notifBtn", "notifCount", "notifList", "markAll"]) {
    assert.ok(src.includes(`id="${id}"`), `#${id} manquant`);
  }
});

test("chaque page de l'application charge notifications.js avant dashboard.js", () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const appPages = pages.filter((f) => /<body[^>]*\sdata-app[\s>=]/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.ok(appPages.length >= 10, `seulement ${appPages.length} page(s) avec la barre du haut`);
  for (const page of appPages) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const feed = html.indexOf('<script src="notifications.js"></script>');
    const dash = html.indexOf('<script src="dashboard.js"></script>');
    assert.ok(feed !== -1 && feed < dash, `${page} doit charger notifications.js avant dashboard.js`);
  }
});
