/* =========================================================================
   Commandes : attribution des ventes, historique par commercial,
   réattribution, précommandes et paie par commercial.

   Même principe que tests/api.test.js : la vraie application Express tourne,
   seule l'exécution SQL est simulée en mémoire. Les sessions sont signées
   directement (server/auth.js) sur des comptes pré-remplis, pour tester les
   règles d'accès sans refaire tout le parcours d'inscription.
   ========================================================================= */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

process.env.JWT_SECRET = "test-secret-that-is-definitely-long-enough-32";
process.env.SERVE_STATIC = "false";
process.env.NODE_ENV = "test";

const TZ = "Africa/Casablanca";
const localDay = (ts) => new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(ts));
const uuid = () => crypto.randomUUID();

/* ------------------------------------------------------------------ *
 * Données                                                             *
 * ------------------------------------------------------------------ */
const store = {
  users: [], profiles: [], salespersons: [], sales: [], preorders: [], preorderEvents: [], clients: [],
  payroll: [], settings: [], payrollAnnouncements: [], teamNotifications: [],
  teamMessages: [], messageReads: [], directNotifications: [], ddl: 0,
  notifications: [], notificationReads: [],
};

const TEAM_A = uuid();
const TEAM_B = uuid();

function addUser(email, profile) {
  const user = { id: uuid(), email, raw_user_meta_data: {}, created_at: new Date() };
  store.users.push(user);
  store.profiles.push({ id: user.id, email, city: null, hue: 150, salesperson_id: null, ...profile });
  return user;
}
function addRep(teamId, name, authId) {
  const rep = {
    id: uuid(), team_id: teamId, name, auth_id: authId || null, sales: 0, today_sales: 0,
    revenue: 0, commission: 0, xp: 0, level: "Rookie", xp_to_next: 1700, badges: [],
  };
  store.salespersons.push(rep);
  return rep;
}

const adminA = addUser("admin@a.test", { full_name: "Admin A", role: "admin", team_id: TEAM_A });
const adminB = addUser("admin@b.test", { full_name: "Admin B", role: "admin", team_id: TEAM_B });
const u1 = addUser("sofia@a.test", { full_name: "Sofia", role: "salesperson", team_id: TEAM_A });
const u2 = addUser("amine@a.test", { full_name: "Amine", role: "salesperson", team_id: TEAM_A });
const S1 = addRep(TEAM_A, "Sofia Benali", u1.id);
const S2 = addRep(TEAM_A, "Amine El Amrani", u2.id);
const S3 = addRep(TEAM_A, "Nadia (sans vente)", null);
const SB = addRep(TEAM_B, "Rep équipe B", null);
store.profiles.find((p) => p.id === u1.id).salesperson_id = S1.id;
store.profiles.find((p) => p.id === u2.id).salesperson_id = S2.id;

/* ------------------------------------------------------------------ *
 * SQL simulé                                                          *
 * ------------------------------------------------------------------ */
const norm = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();
const P = (params, n) => params[Number(n) - 1];
const ok = (rows) => ({ rows, rowCount: rows.length });

/** Colonnes d'un INSERT, quotées ou non. */
function insertColumns(sql, table) {
  const m = new RegExp(`insert into public\\.${table}\\s*\\(([^)]*)\\)`, "i").exec(sql);
  return m[1].split(",").map((c) => c.trim().replace(/"/g, ""));
}

/** Miroir de apply_sale() (unités, CA, commission, XP). */
function applySale(sale) {
  if (!sale.rep_id) return;
  const rep = store.salespersons.find((s) => s.id === sale.rep_id);
  if (!rep) return;
  rep.sales += sale.qty || 0;
  rep.today_sales += sale.qty || 0;
  rep.revenue += Number(sale.amount) || 0;
  rep.commission += Number(sale.commission) || 0;
  rep.xp += Math.max(10, Math.round((Number(sale.amount) || 0) / 60));
}

function insertSale(sql, params) {
  const row = { id: uuid(), created_at: new Date().toISOString(), qty: 1, amount: 0, commission: 0 };
  insertColumns(sql, "sales").forEach((c, i) => {
    if (c === "created_at") {
      // Validation d'une précommande : jour « AAAA-MM-JJ » (midi au Maroc)
      // ou null pour « maintenant », comme le coalesce(...) de la requête.
      const v = params[i];
      if (v) row.created_at = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T11:00:00.000Z` : v;
      return;
    }
    row[c] = params[i];
  });
  if (row.created_at instanceof Date) row.created_at = row.created_at.toISOString();
  store.sales.push(row);
  applySale(row);
  return row;
}

/** Filtre de /api/sales/history, lu sur la clause WHERE générée. */
function salesFilter(q, params) {
  const where = q.split(" where ")[1].split(/ order by | group by /)[0];
  const conds = [];
  let m = /s\.team_id = \$(\d+)/.exec(where);
  const team = P(params, m[1]);
  conds.push((s) => s.team_id === team);
  if ((m = /\(s\.rep_id = \$(\d+) or s\.owner = \$(\d+)\)/.exec(where))) {
    const rep = P(params, m[1]); const owner = P(params, m[2]);
    conds.push((s) => s.rep_id === rep || s.owner === owner);
  } else if ((m = /s\.owner = \$(\d+)/.exec(where))) {
    const owner = P(params, m[1]);
    conds.push((s) => s.owner === owner);
  } else if ((m = /s\.rep_id = \$(\d+)/.exec(where))) {
    const rep = P(params, m[1]);
    conds.push((s) => s.rep_id === rep);
  }
  if ((m = /::date >= \$(\d+)::date/.exec(where))) { const d = P(params, m[1]); conds.push((s) => localDay(s.created_at) >= d); }
  if ((m = /::date <= \$(\d+)::date/.exec(where))) { const d = P(params, m[1]); conds.push((s) => localDay(s.created_at) <= d); }
  if ((m = /lower\(s\.customer\) like \$(\d+)/.exec(where))) {
    const needle = P(params, m[1]).replace(/%/g, "");
    conds.push((s) => [s.customer, s.perfume_name, s.product, s.rep_name].some((v) => String(v || "").toLowerCase().includes(needle)));
  }
  return (s) => conds.every((c) => c(s));
}

function preorderFilter(q, params) {
  const where = q.split(" where ")[1].split(/ order by | group by | for update/)[0];
  const conds = [];
  let m = /p\.team_id = \$(\d+)/.exec(where);
  const team = P(params, m[1]);
  conds.push((p) => p.team_id === team);
  if ((m = /\(p\.rep_id = \$(\d+) or p\.owner = \$(\d+)\)/.exec(where))) {
    const rep = P(params, m[1]); const owner = P(params, m[2]);
    conds.push((p) => p.rep_id === rep || p.owner === owner);
  } else if ((m = /p\.owner = \$(\d+)/.exec(where))) {
    const owner = P(params, m[1]); conds.push((p) => p.owner === owner);
  }
  // Filtre administrateur « and p.rep_id = $n » (le périmètre, lui, est entre parenthèses).
  if ((m = /and p\.rep_id = \$(\d+)/.exec(where))) {
    const rep = P(params, m[1]); conds.push((p) => p.rep_id === rep);
  }
  if ((m = /p\.status = \$(\d+)/.exec(where))) { const st = P(params, m[1]); conds.push((p) => p.status === st); }
  if ((m = /p\.id = \$(\d+)/.exec(where))) { const id = P(params, m[1]); conds.push((p) => p.id === id); }
  if ((m = /lower\(p\.customer\) like \$(\d+)/.exec(where))) {
    const needle = P(params, m[1]).replace(/%/g, "");
    conds.push((p) => [p.customer, p.perfume_name, p.product].some((v) => String(v || "").toLowerCase().includes(needle)));
  }
  return (p) => conds.every((c) => c(p));
}

function monthsBack(n) {
  const [y, mo] = localDay(Date.now()).split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1 - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function execute(sql, params = []) {
  const q = norm(sql);

  /* ---- session ---- */
  if (q.startsWith("select") && q.includes("from public.users where id =")) {
    return ok(store.users.filter((u) => u.id === params[0]));
  }
  if (q.startsWith("select * from public.profiles where id =")) {
    return ok(store.profiles.filter((p) => p.id === params[0]).map((p) => ({ ...p })));
  }

  /* ---- DDL des précommandes ---- */
  if (q.includes("create table if not exists public.preorders")) store.ddl++;
  if (/^(create|alter) (table|index)/.test(q)) return ok([]);

  /* ---- salespersons ---- */
  if (q.startsWith("select id, name from public.salespersons where id = $1 and team_id = $2") ||
      q.startsWith("select id, name, auth_id from public.salespersons where id = $1 and team_id = $2")) {
    return ok(store.salespersons.filter((s) => s.id === params[0] && s.team_id === params[1]));
  }
  if (q.startsWith("select id, name from public.salespersons where team_id = $1 order by name")) {
    return ok(store.salespersons.filter((s) => s.team_id === params[0]));
  }
  if (q.startsWith("select * from public.salespersons where id = any($1::uuid[]) and team_id = $2")) {
    return ok(store.salespersons.filter((s) => params[0].includes(s.id) && s.team_id === params[1]).map((s) => ({ ...s })));
  }
  if (q.startsWith("update public.salespersons set sales = $2")) {
    const rep = store.salespersons.find((s) => s.id === params[0]);
    Object.assign(rep, {
      sales: params[1], today_sales: params[2], revenue: params[3], commission: params[4],
      xp: params[5], level: params[6], xp_to_next: params[7], badges: JSON.parse(params[8]),
    });
    return ok([]);
  }
  if (q.startsWith("select count(*)::int as n from public.salespersons")) {
    return ok([{ n: store.salespersons.filter((s) => s.team_id === params[0]).length }]);
  }

  /* ---- sales ---- */
  if (q.startsWith("insert into public.sales")) return ok([insertSale(sql, params)]);
  if (q.startsWith("select s.id, s.created_at") && q.includes("from public.sales s")) {
    const keep = salesFilter(q, params);
    const rows = store.sales.filter(keep)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, params[params.length - 1])
      .map((s) => {
        const p = store.profiles.find((x) => x.id === s.owner);
        return { ...s, recorded_by: p ? p.full_name : null, recorded_by_rep: p ? p.salesperson_id : null };
      });
    return ok(rows);
  }
  if (q.startsWith("select s.rep_id, coalesce(max(r.name)")) {
    const keep = salesFilter(q, params);
    const groups = new Map();
    for (const s of store.sales.filter(keep)) {
      const g = groups.get(s.rep_id) || { rep_id: s.rep_id, rep_name: null, sales_count: 0, units: 0, revenue: 0, commission: 0, last_sale_at: null };
      const rep = store.salespersons.find((r) => r.id === s.rep_id);
      g.rep_name = rep ? rep.name : s.rep_name;
      g.sales_count++; g.units += s.qty; g.revenue += Number(s.amount); g.commission += Number(s.commission);
      if (!g.last_sale_at || s.created_at > g.last_sale_at) g.last_sale_at = s.created_at;
      groups.set(s.rep_id, g);
    }
    return ok([...groups.values()]);
  }
  if (q.startsWith("select * from public.sales where id = $1 and team_id = $2")) {
    return ok(store.sales.filter((s) => s.id === params[0] && s.team_id === params[1]).map((s) => ({ ...s })));
  }
  if (q.startsWith("update public.sales set rep_id = $2, rep_name = $3")) {
    const s = store.sales.find((x) => x.id === params[0]);
    s.rep_id = params[1]; s.rep_name = params[2];
    return ok([{ ...s }]);
  }
  if (q.startsWith("update public.sales set rep_name = $2")) {
    const s = store.sales.find((x) => x.id === params[0]);
    s.rep_name = params[1];
    return ok([{ ...s }]);
  }

  /* ---- clients (création au fil des ventes) ---- */
  if (q.startsWith("select id, birthday from public.clients where team_id = $1 and phone_e164 = $2")) {
    return ok(store.clients.filter((c) => c.team_id === params[0] && c.phone_e164 === params[1]));
  }
  if (q.startsWith("insert into public.clients")) {
    const c = { id: uuid(), team_id: params[0], rep_id: params[1], name: params[2], phone: params[3], phone_e164: params[4], birthday: params[5] };
    store.clients.push(c);
    return ok([{ id: c.id }]);
  }

  /* ---- paie ---- */
  if (q.startsWith("select id from public.profiles where id = $1 and team_id = $2")) {
    return ok(store.profiles.filter((p) => p.id === params[0] && p.team_id === params[1]).map((p) => ({ id: p.id })));
  }
  if (q.startsWith("select id from public.profiles where team_id = $1 and id = any($2::uuid[])")) {
    return ok(store.profiles.filter((p) => p.team_id === params[0] && params[1].includes(p.id)).map((p) => ({ id: p.id })));
  }
  if (q.startsWith("select id, full_name, role from public.profiles where team_id = $1")) {
    return ok(store.profiles.filter((p) => p.team_id === params[0] && p.id !== params[1])
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map(({ id, full_name, role }) => ({ id, full_name, role })));
  }
  if (q.startsWith("insert into public.team_messages")) {
    const row = { id: uuid(), created_at: new Date().toISOString() };
    insertColumns(sql, "team_messages").forEach((column, i) => { row[column] = params[i]; });
    store.teamMessages.push(row);
    return ok([{ ...row }]);
  }
  if (q.startsWith("insert into public.notifications") && q.includes("values ($1,$2,$3,$4,'mention'")) {
    store.directNotifications.push({ team_id: params[0], actor_id: params[1], actor_name: params[2],
      recipient_id: params[3], title: params[4], body: params[5] });
    return ok([]);
  }
  if (q.startsWith("select n.id, n.actor_id")) {
    const [teamId, userId, limit] = params;
    const profile = store.profiles.find((p) => p.id === userId);
    const adminView = !q.includes("and (n.actor_id = $2 or n.recipient_id = $2)");
    const rows = store.notifications.filter((n) => n.team_id === teamId &&
      (n.recipient_id == null || n.recipient_id === userId) &&
      (adminView || n.actor_id === userId || n.recipient_id === userId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
      .map((n) => {
        const read = store.notificationReads.find((r) => r.notification_id === n.id && r.user_id === userId);
        return { ...n, read_at: read ? read.read_at : null };
      });
    return ok(rows);
  }
  if (q.startsWith("insert into public.notification_reads")) {
    const [teamId, userId, ids] = params;
    const profile = store.profiles.find((p) => p.id === userId);
    const inserted = [];
    for (const notification of store.notifications.filter((n) => n.team_id === teamId && ids.includes(n.id) &&
      (n.recipient_id == null || n.recipient_id === userId) &&
      (n.actor_id === userId || n.recipient_id === userId || ["admin", "relation_client"].includes(profile.role)))) {
      if (!store.notificationReads.some((r) => r.notification_id === notification.id && r.user_id === userId)) {
        store.notificationReads.push({ notification_id: notification.id, user_id: userId, read_at: new Date().toISOString() });
        inserted.push({ notification_id: notification.id });
      }
    }
    return ok(inserted);
  }
  if (q.startsWith("select m.id, m.sender_id, m.recipient_id")) {
    const [teamId, userId, before, beforeId, limit] = params;
    const messages = store.teamMessages.filter((message) => message.team_id === teamId &&
      (message.recipient_id == null || message.recipient_id === userId || message.sender_id === userId) &&
      (!before || message.created_at < before || (message.created_at === before && (!beforeId || message.id < beforeId))))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, limit)
      .map((message) => {
        const sender = store.profiles.find((p) => p.id === message.sender_id);
        const receiver = store.profiles.find((p) => p.id === message.recipient_id);
        const isRead = store.messageReads.some((read) => read.message_id === message.id && read.user_id === userId);
        return { ...message, sender_name: sender && sender.full_name, recipient_name: receiver && receiver.full_name,
          read: isRead, unread: message.sender_id !== userId && !isRead };
      });
    return ok(messages);
  }
  if (q.startsWith("insert into public.team_message_reads")) {
    const [teamId, userId, ids] = params;
    const inserted = [];
    for (const message of store.teamMessages.filter((m) => m.team_id === teamId && ids.includes(m.id) &&
      (m.recipient_id == null || m.recipient_id === userId))) {
      if (!store.messageReads.some((r) => r.message_id === message.id && r.user_id === userId)) {
        store.messageReads.push({ message_id: message.id, user_id: userId });
        inserted.push({ message_id: message.id });
      }
    }
    return ok(inserted);
  }
  if (q.startsWith("select pg_advisory_xact_lock")) return ok([]);
  if (q.startsWith("select status from public.payroll_periods")) {
    return ok(store.payroll.filter((p) => p.team_id === params[0] && p.period === params[1]).map((p) => ({ status: p.status })));
  }
  if (q.startsWith("select status from public.payroll_announcements")) {
    return ok(store.payrollAnnouncements.filter((a) => a.team_id === params[0] && a.period === params[1])
      .map((a) => ({ status: a.status })));
  }
  if (q.startsWith("select id, name from public.salespersons where team_id = $1 order by name")) {
    return ok(store.salespersons.filter((s) => s.team_id === params[0]).map((s) => ({ id: s.id, name: s.name })));
  }
  if (q.startsWith("select s.rep_id,") && q.includes("date_trunc('month'")) {
    const [teamId, period] = params;
    const byRep = new Map();
    for (const sale of store.sales) {
      if (sale.team_id !== teamId || !sale.rep_id || localDay(sale.created_at).slice(0, 7) !== period.slice(0, 7)) continue;
      const line = byRep.get(sale.rep_id) || { rep_id: sale.rep_id, sales_count: 0, units: 0, revenue: 0, commission: 0 };
      line.sales_count++;
      line.units += sale.qty || 0;
      line.revenue += Number(sale.amount) || 0;
      line.commission += Number(sale.commission) || 0;
      byRep.set(sale.rep_id, line);
    }
    return ok([...byRep.values()]);
  }
  if (q.startsWith("select * from public.payroll_periods where team_id = $1 and period = $2")) {
    return ok(store.payroll.filter((p) => p.team_id === params[0] && p.period === params[1]).map((p) => ({ ...p })));
  }
  if (q.startsWith("insert into public.payroll_periods")) {
    const row = { id: uuid() };
    insertColumns(sql, "payroll_periods").forEach((column, i) => { row[column] = params[i]; });
    row.settings = JSON.parse(row.settings);
    const existing = store.payroll.find((p) => p.rep_id === row.rep_id && p.period === row.period);
    if (existing) Object.assign(existing, row, { updated_at: new Date().toISOString() });
    else store.payroll.push(row);
    return ok([{ ...(existing || row) }]);
  }
  if (q.startsWith("insert into public.payroll_announcements")) {
    if (store.payrollAnnouncements.some((a) => a.team_id === params[0] && a.period === params[1] && a.status === params[2])) return ok([]);
    store.payrollAnnouncements.push({ id: uuid(), team_id: params[0], period: params[1], status: params[2], actor_id: params[3] });
    return ok([{ id: store.payrollAnnouncements[store.payrollAnnouncements.length - 1].id }]);
  }
  if (q.startsWith("insert into public.notifications") && q.includes("select $1, $2, $3, p.id")) {
    store.teamNotifications.push(...store.profiles.filter((p) => p.team_id === params[0]).map((p) => ({
      team_id: params[0], actor_id: params[1], recipient_id: p.id, title: params[3], body: params[4],
    })));
    return ok([]);
  }
  if (q.startsWith("select 1 as locked from public.payroll_periods")) {
    const hit = store.payroll.find((p) => p.team_id === params[0] && p.period === params[1] &&
      params[2].includes(p.rep_id) && ["CLOTURE", "VALIDEE", "PAYEE"].includes(p.status));
    return ok(hit ? [{ locked: 1 }] : []);
  }
  if (q.startsWith("select * from public.compensation_settings")) {
    return ok(store.settings.filter((s) => s.team_id === params[0]));
  }
  if (q.startsWith("insert into public.compensation_settings")) return ok([]);
  if (q.startsWith("with periods as")) {
    const [team, months, rep] = params;
    const rows = [];
    for (const period of monthsBack(months)) {
      const inMonth = store.sales.filter((s) => s.team_id === team && s.rep_id &&
        localDay(s.created_at).slice(0, 7) === period.slice(0, 7) && (!rep || s.rep_id === rep));
      const reps = [...new Set(inMonth.map((s) => s.rep_id))];
      if (!reps.length) rows.push({ period, rep_id: null, revenue: 0, commission: 0, sales_count: 0 });
      for (const r of reps) {
        const mine = inMonth.filter((s) => s.rep_id === r);
        rows.push({
          period, rep_id: r, sales_count: mine.length,
          revenue: mine.reduce((n, s) => n + Number(s.amount), 0),
          commission: mine.reduce((n, s) => n + Number(s.commission), 0),
        });
      }
    }
    return ok(rows);
  }
  if (q.startsWith("select period, status, total")) {
    return ok(store.payroll.filter((p) => p.team_id === params[0] && (params.length < 2 || p.rep_id === params[1])));
  }

  /* ---- précommandes ---- */
  if (q.startsWith("select p.status, count(*)::int as n")) {
    const keep = preorderFilter(q, params);
    const by = {};
    for (const p of store.preorders.filter(keep)) {
      const g = by[p.status] || (by[p.status] = { status: p.status, n: 0, amount: 0, deposit: 0 });
      g.n++; g.amount += Number(p.amount); g.deposit += Number(p.deposit);
    }
    return ok(Object.values(by));
  }
  if (q.startsWith("select p.*, r.name as current_rep_name")) {
    const keep = preorderFilter(q, params);
    return ok(store.preorders.filter(keep).slice(0, params[params.length - 1]).map((p) => ({ ...p })));
  }
  if (q.startsWith("select p.* from public.preorders p")) {
    const keep = preorderFilter(q, params);
    return ok(store.preorders.filter(keep).map((p) => ({ ...p })));
  }
  if (q.startsWith("select e.*, u.email as actor_email") && q.includes("from public.preorder_events e")) {
    const rows = store.preorderEvents.filter((e) => e.team_id === params[0]).map((e) => {
      const preorder = store.preorders.find((p) => p.id === e.preorder_id) || {};
      const actor = store.users.find((u) => u.id === e.actor_id) || {};
      return { ...e, customer: preorder.customer, rep_name: preorder.rep_name, actor_email: actor.email };
    });
    return ok(rows.slice(0, params[1]));
  }
  if (q.startsWith("insert into public.preorders")) {
    const row = { id: uuid(), status: "pending", created_at: new Date(), sale_id: null };
    insertColumns(sql, "preorders").forEach((c, i) => { row[c] = params[i]; });
    store.preorders.push(row);
    return ok([{ ...row }]);
  }
  if (q.startsWith("insert into public.preorder_events")) {
    store.preorderEvents.push({ team_id: params[0], preorder_id: params[1], actor_id: params[2],
      action: params[3], from_status: params[4], to_status: params[5], details: JSON.parse(params[6]) });
    return ok([]);
  }
  if (q.startsWith("update public.preorders set status = 'delivered'")) {
    const p = store.preorders.find((x) => x.id === params[0]);
    Object.assign(p, { status: "delivered", delivered_to_client_at: new Date() });
    return ok([{ ...p }]);
  }
  if (q.startsWith("update public.preorders") && q.includes("set status = 'paid'")) {
    const p = store.preorders.find((x) => x.id === params[0]);
    Object.assign(p, { status: "paid", pay: params[1], paid_at: new Date(), paid_amount: p.amount });
    return ok([{ ...p }]);
  }
  if (q.startsWith("update public.preorders") && q.includes("set status = 'validated'")) {
    const p = store.preorders.find((x) => x.id === params[0]);
    Object.assign(p, { status: "validated", sale_id: params[1], delivered_at: params[2], commission: params[3] });
    return ok([{ ...p }]);
  }
  if (q.startsWith("update public.preorders set status = 'cancelled'")) {
    const p = store.preorders.find((x) => x.id === params[0]);
    Object.assign(p, { status: "cancelled", cancelled_at: new Date(), cancel_reason: params[1] });
    return ok([{ ...p }]);
  }
  if (q.startsWith("update public.preorders set")) {
    const p = store.preorders.find((x) => x.id === params[0]);
    [...sql.matchAll(/"([a-z_]+)" = \$(\d+)/g)].forEach((m) => { p[m[1]] = params[Number(m[2]) - 1]; });
    return ok([{ ...p }]);
  }

  throw new Error("Unhandled SQL in the orders test stub: " + q.slice(0, 140));
}

const fakeDb = {
  pool: { end: async () => {} },
  isConfigured: () => true,
  MISSING_URL_MESSAGE: "DATABASE_URL is not set.",
  query: async (sql, params) => execute(sql, params),
  one: async (sql, params) => execute(sql, params).rows[0] || null,
  many: async (sql, params) => execute(sql, params).rows,
  tx: async (fn) => fn({ query: async (sql, params) => execute(sql, params) }),
  ping: async () => true,
};
{
  const real = require("../server/db");
  const missing = Object.keys(real).filter((k) => !(k in fakeDb));
  if (missing.length) throw new Error(`fakeDb incomplet : ${missing.join(", ")}`);
}
const dbPath = require.resolve("../server/db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const app = require("../server/app");
const { signSession } = require("../server/auth");
const { applySaleToRep, levelFor } = require("../server/sales");
const { SCHEMA_SQL } = require("../server/preorders");

/* ------------------------------------------------------------------ *
 * Harnais                                                             *
 * ------------------------------------------------------------------ */
let baseUrl;
let server;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); });

function as(user) {
  const token = signSession(user);
  return async (method, urlPath, body) => {
    const res = await fetch(baseUrl + urlPath, {
      method,
      headers: { Accept: "application/json", Authorization: "Bearer " + token,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}
const admin = as(adminA);
const sofia = as(u1);
const amine = as(u2);
const otherAdmin = as(adminB);

const repOf = (rep) => store.salespersons.find((s) => s.id === rep.id);
const SALE = { customer: "Client", product: "Parfum 100 ml", perfume_name: "Oud Royal", qty: 1, amount: 150, commission: 15, pay: "Espèces" };

function seedSale(fields) {
  const row = {
    id: uuid(), team_id: TEAM_A, qty: 1, amount: 80, commission: 8, product: "Parfum 50 ml",
    customer: "Seed", pay: "Espèces", created_at: new Date().toISOString(), ...fields,
  };
  store.sales.push(row);
  return row;
}

/* ------------------------------------------------------------------ *
 * Attribution des ventes                                              *
 * ------------------------------------------------------------------ */
test("les ventes directes sont refusées au profit du parcours précommande", async () => {
  const before = store.sales.length;
  for (const actor of [sofia, admin]) {
    const res = await actor("POST", "/api/sales", SALE);
    assert.strictEqual(res.status, 410, JSON.stringify(res.body));
    assert.match(res.body.error, /précommande payée/);
  }
  assert.strictEqual(store.sales.length, before, "aucune vente ne peut contourner le parcours");
});

/* ------------------------------------------------------------------ *
 * Historique                                                          *
 * ------------------------------------------------------------------ */
test("l'historique équipe détaille chaque commercial, même sans vente", async () => {
  store.sales.length = 0;
  const today = localDay(Date.now());
  seedSale({ owner: u1.id, rep_id: S1.id, rep_name: "Sofia Benali", qty: 2, amount: 300, commission: 30 });
  seedSale({ owner: adminA.id, rep_id: S1.id, rep_name: "Sofia Benali", amount: 150, commission: 15 });
  seedSale({ owner: u2.id, rep_id: S2.id, rep_name: "Amine El Amrani", amount: 50, commission: 5 });
  seedSale({ owner: u1.id, rep_id: S1.id, rep_name: "Sofia Benali", created_at: "2020-01-15T10:00:00Z" }); // hors période
  seedSale({ team_id: TEAM_B, owner: adminB.id, rep_id: SB.id, amount: 999 });

  const res = await admin("GET", `/api/sales/history?from=${today}&to=${today}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.scope, "team");
  assert.strictEqual(res.body.rows.length, 3, "la période et l'équipe sont respectées");
  assert.deepStrictEqual(res.body.summary, { sales_count: 3, units: 4, revenue: 500, commission: 50, avg_basket: 167 });
  const names = res.body.by_rep.map((g) => g.rep_name);
  assert.ok(names.includes("Nadia (sans vente)"), "un commercial sans vente reste listé");
  assert.strictEqual(res.body.by_rep[0].rep_name, "Sofia Benali", "trié par chiffre d'affaires");
  assert.strictEqual(res.body.by_rep[0].revenue, 450);
  assert.strictEqual(res.body.rows[0].recorded_by !== undefined, true, "l'auteur de la saisie est renvoyé");
});

test("l'historique d'un commercial inclut ses saisies créditées à tort à un autre", async () => {
  store.sales.length = 0;
  seedSale({ owner: u1.id, rep_id: S1.id, rep_name: "Sofia Benali" });
  const misplaced = seedSale({ owner: u1.id, rep_id: S2.id, rep_name: "Amine El Amrani", customer: "Égarée" });
  seedSale({ owner: u2.id, rep_id: S2.id, rep_name: "Amine El Amrani" });

  const res = await admin("GET", `/api/sales/history?rep_id=${S1.id}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.scope, "rep");
  assert.strictEqual(res.body.rep.name, "Sofia Benali");
  assert.strictEqual(res.body.rows.length, 2);
  const flagged = res.body.rows.find((r) => r.id === misplaced.id);
  assert.strictEqual(flagged.attribution_mismatch, true, "la vente mal attribuée est signalée");
  assert.strictEqual(res.body.mismatches, 1);

  const search = await admin("GET", `/api/sales/history?rep_id=${S1.id}&q=%C3%A9gar`);
  assert.strictEqual(search.body.rows.length, 1, "la recherche porte aussi sur le client");
});

test("un commercial ne voit que son propre historique", async () => {
  const res = await sofia("GET", `/api/sales/history?rep_id=${S2.id}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.scope, "me", "le rep_id demandé est ignoré");
  assert.ok(res.body.rows.every((r) => r.rep_id === S1.id || r.owner === u1.id));
  assert.ok(!res.body.rows.some((r) => r.owner === u2.id && r.rep_id === S2.id));
});

test("l'historique valide ses paramètres et isole les équipes", async () => {
  assert.strictEqual((await admin("GET", "/api/sales/history?from=15/09/2026")).status, 400);
  assert.strictEqual((await admin("GET", "/api/sales/history?from=2026-13-01")).status, 400, "mois impossible");
  assert.strictEqual((await admin("GET", "/api/sales/history?to=2026-02-30")).status, 400, "jour impossible");
  assert.strictEqual((await admin("GET", "/api/sales/history?from=2026-09-10&to=2026-09-01")).status, 400);
  assert.strictEqual((await otherAdmin("GET", `/api/sales/history?rep_id=${S1.id}`)).status, 404);
  const b = await otherAdmin("GET", "/api/sales/history");
  assert.ok(b.body.rows.every((r) => r.team_id === undefined || r.team_id === TEAM_B));
  assert.ok(!b.body.rows.some((r) => r.rep_id === S1.id || r.rep_id === S2.id));
});

/* ------------------------------------------------------------------ *
 * Réattribution                                                       *
 * ------------------------------------------------------------------ */
test("réattribuer une vente déplace aussi ses statistiques", async () => {
  store.sales.length = 0;
  Object.assign(repOf(S1), { sales: 0, today_sales: 0, revenue: 0, commission: 0, xp: 0, badges: [] });
  Object.assign(repOf(S2), { sales: 3, today_sales: 3, revenue: 450, commission: 45, xp: 30, badges: ["starter"] });
  const sale = seedSale({ owner: u1.id, rep_id: S2.id, rep_name: "Amine El Amrani", qty: 3, amount: 450, commission: 45 });

  assert.strictEqual((await sofia("PATCH", `/api/sales/${sale.id}/rep`, { rep_id: S1.id })).status, 403,
    "réservé à l'administrateur");

  const res = await admin("PATCH", `/api/sales/${sale.id}/rep`, { rep_id: S1.id });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.rep_id, S1.id);
  assert.strictEqual(res.body.rep_name, "Sofia Benali");

  const s1 = repOf(S1); const s2 = repOf(S2);
  assert.deepStrictEqual([s1.sales, s1.revenue, s1.commission, s1.today_sales], [3, 450, 45, 3]);
  assert.deepStrictEqual([s2.sales, s2.revenue, s2.commission, s2.today_sales], [0, 0, 0, 0]);
  assert.strictEqual(s1.xp, 10, "XP d'une vente à 450 DHS : max(10, round(450/60)) = 8 -> 10");
  assert.ok(s1.badges.includes("starter"), "le badge de première vente est décerné");
  assert.ok(s2.badges.includes("starter"), "un badge acquis n'est jamais retiré");

  // Même commercial : rien ne bouge, et on le dit au lieu d'annoncer un succès.
  const same = await admin("PATCH", `/api/sales/${sale.id}/rep`, { rep_id: S1.id });
  assert.strictEqual(same.status, 400);
  assert.match(same.body.error, /déjà créditée à Sofia Benali/);
  assert.deepStrictEqual([repOf(S1).sales, repOf(S1).revenue], [3, 450], "statistiques inchangées");
});

test("une vente d'un mois de paie clôturé ne change plus de commercial", async () => {
  const sale = seedSale({ owner: u1.id, rep_id: S2.id, created_at: "2026-01-10T12:00:00Z" });
  store.payroll.push({ team_id: TEAM_A, rep_id: S2.id, period: "2026-01-01", status: "CLOTURE" });
  const res = await admin("PATCH", `/api/sales/${sale.id}/rep`, { rep_id: S1.id });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(store.sales.find((s) => s.id === sale.id).rep_id, S2.id);
  assert.strictEqual((await admin("PATCH", `/api/sales/${sale.id}/rep`, { rep_id: SB.id })).status, 400);
  assert.strictEqual((await otherAdmin("PATCH", `/api/sales/${sale.id}/rep`, { rep_id: SB.id })).status, 404);
});

test("les statistiques suivent exactement le trigger apply_sale()", () => {
  const rep = { sales: 49, today_sales: 0, revenue: 99_950, commission: 0, xp: 1695, badges: ["starter"] };
  const up = applySaleToRep(rep, { qty: 1, amount: 150, commission: 15 }, 1, false);
  assert.strictEqual(up.sales, 50);
  assert.strictEqual(up.today_sales, 0, "une vente d'un autre jour ne touche pas today_sales");
  assert.strictEqual(up.xp, 1705);
  assert.strictEqual(up.level, "Bronze");
  assert.strictEqual(up.xp_to_next, 3400);
  assert.deepStrictEqual(up.badges.sort(), ["closer", "revenue", "starter"]);
  const down = applySaleToRep({ sales: 0, revenue: 0, commission: 0, xp: 5 }, { qty: 2, amount: 100, commission: 10 }, -1, true);
  assert.deepStrictEqual([down.sales, down.revenue, down.commission, down.xp], [0, 0, 0, 0], "jamais sous zéro");
  assert.deepStrictEqual(levelFor(99999), { level: "Diamond", xp_to_next: 10200 });
});

/* ------------------------------------------------------------------ *
 * Précommandes                                                        *
 * ------------------------------------------------------------------ */
const PRE = {
  customer: "Yasmine", client_phone: "0612345678", product: "Parfum 100 ml", perfume_name: "Oud Royal",
  qty: 2, unit_price: 150, commission: 30, deposit: 100, pay: "Espèces",
};

test("le SQL de la table précommandes est le même que celui de la migration", () => {
  const statements = (sql) => sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const file = fs.readFileSync(path.join(__dirname, "..", "db", "schema-preorders.sql"), "utf8");
  assert.deepStrictEqual(statements(SCHEMA_SQL), statements(file));
});

test("une précommande est créditée à son auteur et ne compte pas encore", async () => {
  store.preorders.length = 0;
  store.preorderEvents.length = 0;
  const before = { ...repOf(S1) };
  const res = await sofia("POST", "/api/preorders", { ...PRE, rep_id: S2.id });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.status, "pending");
  assert.strictEqual(res.body.rep_id, S1.id, "une commerciale précommande à son nom");
  assert.strictEqual(res.body.amount, 300, "montant = prix unitaire × quantité");
  assert.strictEqual(res.body.balance, 200, "reste à payer = montant − acompte");
  assert.strictEqual(res.body.commission, 30, "la commission est calculée côté serveur");
  assert.ok(res.body.client_id, "le client est rattaché par son numéro");
  assert.strictEqual(repOf(S1).sales, before.sales, "aucune vente n'est comptée avant la livraison");
  assert.strictEqual(repOf(S1).commission, before.commission);
  assert.deepStrictEqual(store.preorderEvents.map((e) => e.action), ["created"]);
  assert.ok(store.ddl >= 1, "la table est vérifiée avant usage");
});

test("une précommande invalide est refusée avec un message clair", async () => {
  const cases = [
    [{ ...PRE, deposit: 500 }, /acompte/i],
    [{ ...PRE, unit_price: 1 }, /prix unitaire/i],
    [{ ...PRE, qty: 0 }, /quantité/i],
    [{ ...PRE, customer: "  " }, /client/i],
    [{ ...PRE, expected_at: "2000-01-01" }, /passée/i],
    [{ ...PRE, expected_at: "demain" }, /AAAA-MM-JJ/],
    [{ ...PRE, expected_at: "2030-02-30" }, /date valide/],
  ];
  for (const [body, message] of cases) {
    const res = await sofia("POST", "/api/preorders", body);
    assert.strictEqual(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, message);
  }
});

test("chacun voit ses précommandes, l'administrateur celles de l'équipe", async () => {
  store.preorders.length = 0;
  await sofia("POST", "/api/preorders", PRE);
  await amine("POST", "/api/preorders", { ...PRE, customer: "Reda" });
  await admin("POST", "/api/preorders", { ...PRE, customer: "Lina", rep_id: S2.id });

  const mine = await sofia("GET", "/api/preorders");
  assert.strictEqual(mine.body.scope, "me");
  assert.deepStrictEqual(mine.body.rows.map((r) => r.customer), ["Yasmine"]);

  const team = await admin("GET", "/api/preorders");
  assert.strictEqual(team.body.rows.length, 3);
  assert.strictEqual(team.body.summary.pending.count, 3);
  assert.strictEqual(team.body.summary.pending.deposit, 300);

  const amineOnly = await admin("GET", `/api/preorders?rep_id=${S2.id}`);
  assert.deepStrictEqual(amineOnly.body.rows.map((r) => r.customer).sort(), ["Lina", "Reda"]);

  assert.strictEqual((await otherAdmin("GET", "/api/preorders")).body.rows.length, 0, "équipes isolées");
  assert.strictEqual((await admin("GET", "/api/preorders?status=PERDUE")).status, 400);
});

test("le journal des précommandes est réservé aux admins", async () => {
  store.preorders.length = 0;
  store.preorderEvents.length = 0;
  await sofia("POST", "/api/preorders", PRE);
  assert.strictEqual((await sofia("GET", "/api/preorders/audit")).status, 403);
  const res = await admin("GET", "/api/preorders/audit");
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].action, "created");
  assert.strictEqual(res.body[0].customer, PRE.customer);
});

test("livrer puis payer et valider crée une vente une seule fois", async () => {
  store.preorders.length = 0;
  store.preorderEvents.length = 0;
  const created = (await sofia("POST", "/api/preorders", PRE)).body;
  const before = { ...repOf(S1) };

  // Un collègue ne peut pas livrer la précommande d'un autre.
  assert.strictEqual((await amine("POST", `/api/preorders/${created.id}/deliver`, {})).status, 404);

  const delivered = await admin("POST", `/api/preorders/${created.id}/deliver`, {});
  assert.strictEqual(delivered.status, 200, JSON.stringify(delivered.body));
  assert.strictEqual(delivered.body.status, "delivered");
  assert.strictEqual((await sofia("POST", `/api/preorders/${created.id}/deliver`, {})).status, 409);

  const paid = await admin("POST", `/api/preorders/${created.id}/paid`, { pay: "Virement" });
  assert.strictEqual(paid.status, 200, JSON.stringify(paid.body));
  assert.strictEqual(paid.body.status, "paid");
  const res = await admin("POST", `/api/preorders/${created.id}/validate`, {});
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.preorder.status, "validated");
  assert.strictEqual(res.body.preorder.sale_id, res.body.sale.id);
  const sale = res.body.sale;
  assert.strictEqual(sale.owner, u1.id, "la vente garde l'auteur de la précommande");
  assert.strictEqual(sale.rep_id, S1.id);
  assert.strictEqual(Number(sale.amount), 300);
  assert.strictEqual(Number(sale.commission), 30);
  assert.strictEqual(sale.pay, "Virement");
  assert.match(sale.remarks, /Précommande du .* — acompte 100 DHS/);
  assert.strictEqual(repOf(S1).sales, before.sales + 2, "les unités comptent à la validation");
  assert.strictEqual(repOf(S1).commission, before.commission + 30, "la commission aussi");
  const again = await sofia("POST", `/api/preorders/${created.id}/validate`, {});
  assert.strictEqual(again.status, 409, "une vente ne peut pas être validée deux fois");
  assert.deepStrictEqual(store.preorderEvents.map((e) => e.action), ["created", "delivered", "paid", "validated"]);
});

test("la commission est recalculée et figée selon les règles à la validation", async () => {
  store.preorders.length = 0;
  store.settings = [{ team_id: TEAM_A, commission_mode: "percent", commission_rate: 7 }];
  const created = await sofia("POST", "/api/preorders", { ...PRE, commission: 9999 });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.commission, 21, "la commission envoyée par le client est ignorée");

  await sofia("POST", `/api/preorders/${created.body.id}/deliver`, {});
  await sofia("POST", `/api/preorders/${created.body.id}/paid`, { pay: "Espèces" });
  const validated = await sofia("POST", `/api/preorders/${created.body.id}/validate`, {});
  assert.strictEqual(validated.status, 200, JSON.stringify(validated.body));
  assert.strictEqual(Number(validated.body.sale.commission), 21);
  assert.deepStrictEqual(JSON.parse(validated.body.sale.commission_snapshot), {
    mode: "percent", rate: 7, currency: "DHS",
  });

  store.settings[0].commission_rate = 90;
  assert.strictEqual(Number(store.sales.find((s) => s.id === validated.body.sale.id).commission), 21,
    "une modification ultérieure des règles ne change pas la vente validée");
  store.settings.length = 0;
});

test("une précommande payée plus tôt devient une vente datée du jour du paiement", async () => {
  store.preorders.length = 0;
  store.payroll.length = 0;
  const created = (await sofia("POST", "/api/preorders", PRE)).body;
  // Précommande prise il y a 10 jours, payée il y a 3 jours.
  const po = store.preorders.find((p) => p.id === created.id);
  po.created_at = new Date(Date.now() - 10 * 86400000);
  const ordered = localDay(po.created_at);
  const paid = localDay(Date.now() - 3 * 86400000);
  const future = localDay(Date.now() + 2 * 86400000);
  const tooEarly = localDay(Date.now() - 20 * 86400000);

  await sofia("POST", `/api/preorders/${po.id}/deliver`, {});
  await sofia("POST", `/api/preorders/${po.id}/paid`, { pay: "Mobile Money" });
  assert.strictEqual((await sofia("POST", `/api/preorders/${po.id}/validate`, { sale_date: future })).status, 400, "pas de vente future");
  const early = await sofia("POST", `/api/preorders/${po.id}/validate`, { sale_date: tooEarly });
  assert.strictEqual(early.status, 400, "pas avant la précommande");
  assert.match(early.body.error, /précéder la précommande/);

  // Mois de paie clôturé pour la commerciale : refusé.
  store.payroll.push({ team_id: TEAM_A, rep_id: S1.id, period: `${paid.slice(0, 7)}-01`, status: "PAYEE" });
  assert.strictEqual((await sofia("POST", `/api/preorders/${po.id}/validate`, { sale_date: paid })).status, 409);
  store.payroll.length = 0;

  const res = await sofia("POST", `/api/preorders/${po.id}/validate`, { sale_date: paid });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(localDay(res.body.sale.created_at), paid, "la vente porte la date du paiement");
  assert.strictEqual(localDay(res.body.preorder.delivered_at), paid, "la précommande affiche la même date");
  assert.strictEqual(res.body.sale.pay, "Mobile Money");
  assert.ok(ordered < paid);
});

test("annuler ou modifier une précommande en attente", async () => {
  const created = (await sofia("POST", "/api/preorders", PRE)).body;
  const edited = await sofia("PATCH", `/api/preorders/${created.id}`, { deposit: 250, remarks: "Rappeler vendredi" });
  assert.strictEqual(edited.status, 200, JSON.stringify(edited.body));
  assert.strictEqual(edited.body.deposit, 250);
  assert.strictEqual(edited.body.balance, 50);
  assert.strictEqual((await sofia("PATCH", `/api/preorders/${created.id}`, { deposit: 999 })).status, 400);

  assert.strictEqual((await sofia("POST", `/api/preorders/${created.id}/cancel`, { reason: "Client injoignable" })).status, 403);
  const cancelled = await admin("POST", `/api/preorders/${created.id}/cancel`, { reason: "Client injoignable" });
  assert.strictEqual(cancelled.status, 200);
  assert.strictEqual(cancelled.body.status, "cancelled");
  assert.strictEqual(cancelled.body.cancel_reason, "Client injoignable");
  assert.strictEqual((await sofia("POST", `/api/preorders/${created.id}/deliver`, {})).status, 409);
  assert.strictEqual((await sofia("PATCH", `/api/preorders/${created.id}`, { deposit: 0 })).status, 409);
});

/* ------------------------------------------------------------------ *
 * Rémunération par commercial                                         *
 * ------------------------------------------------------------------ */
test("l'administrateur consulte la rémunération mensuelle d'un commercial", async () => {
  store.sales.length = 0;
  for (let i = 0; i < 20; i++) seedSale({ owner: u1.id, rep_id: S1.id, amount: 150, commission: 15 });
  for (let i = 0; i < 5; i++) seedSale({ owner: u2.id, rep_id: S2.id, amount: 80, commission: 8 });

  const res = await admin("GET", `/api/payroll/history?months=3&rep_id=${S1.id}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.scope, "rep");
  assert.strictEqual(res.body.rep.name, "Sofia Benali");
  assert.strictEqual(res.body.months.length, 3);
  const current = res.body.months[res.body.months.length - 1];
  assert.deepStrictEqual(
    [current.sales_count, current.revenue, current.commission, current.bonus, current.total],
    [20, 3000, 300, 100, 400],
    "20 ventes : commission 300 + bonus du palier 20 (100)"
  );

  assert.strictEqual((await admin("GET", `/api/payroll/history?rep_id=${SB.id}`)).status, 404);
  const own = await amine("GET", `/api/payroll/history?rep_id=${S1.id}`);
  assert.strictEqual(own.body.scope, "me", "un commercial ne consulte que sa propre paie");
  assert.strictEqual(own.body.months[own.body.months.length - 1].sales_count, 5);
});

test("le bonus d'équipe additionne les paliers individuels", async () => {
  // 10 + 10 ventes : l'équipe cumule 20 ventes, mais personne n'atteint le
  // palier individuel de 20. Aucun bonus n'est dû.
  store.sales.length = 0;
  for (let i = 0; i < 10; i++) seedSale({ owner: u1.id, rep_id: S1.id, amount: 100, commission: 10 });
  for (let i = 0; i < 10; i++) seedSale({ owner: u2.id, rep_id: S2.id, amount: 100, commission: 10 });
  const res = await admin("GET", "/api/payroll/history?months=1");
  const m = res.body.months[0];
  assert.strictEqual(res.body.scope, "team");
  assert.deepStrictEqual([m.sales_count, m.commission, m.bonus, m.total], [20, 200, 0, 200]);
});

test("les clôtures de paie sont monotones et leurs annonces persistantes sont idempotentes", async () => {
  const savedPayroll = store.payroll.slice();
  const savedSettings = store.settings.slice();
  const savedAnnouncements = store.payrollAnnouncements.slice();
  const savedNotifications = store.teamNotifications.slice();
  const savedReps = store.salespersons.slice();
  store.payroll.length = 0;
  store.payrollAnnouncements.length = 0;
  store.teamNotifications.length = 0;
  store.settings.length = 0;
  seedSale({ created_at: "2020-01-15T12:00:00.000Z", rep_id: S1.id, owner: u1.id, amount: 150, commission: 15 });

  const close = (status) => admin("POST", "/api/payroll/close", { month: "2020-01", status });
  const first = await close("CLOTURE");
  assert.strictEqual(first.status, 200, JSON.stringify(first.body));
  assert.strictEqual(first.body.announced, true);
  assert.strictEqual(store.payroll.length, 3);
  assert.strictEqual(store.payrollAnnouncements.length, 1);
  const notificationsAfterFirst = store.teamNotifications.length;
  const originalSettings = store.payroll[0].settings;
  store.settings.push({
    team_id: TEAM_A, salary_base: 999, commission_mode: "percent", commission_rate: 99,
    bonus_tiers: [], currency: "USD",
  });

  const repeated = await close("CLOTURE");
  assert.strictEqual(repeated.status, 200);
  assert.strictEqual(repeated.body.announced, false);
  assert.strictEqual(store.payrollAnnouncements.length, 1);
  assert.strictEqual(store.teamNotifications.length, notificationsAfterFirst);

  assert.strictEqual((await close("VALIDEE")).status, 200);
  assert.deepStrictEqual(store.payroll[0].settings, originalSettings, "une transition ne modifie pas les paramètres figés");
  assert.strictEqual((await close("PAYEE")).status, 200);
  const backwards = await close("CLOTURE");
  assert.strictEqual(backwards.status, 409);
  assert.ok(store.payroll.every((line) => line.status === "PAYEE"));
  assert.deepStrictEqual(store.payrollAnnouncements.map((item) => item.status), ["CLOTURE", "VALIDEE", "PAYEE"]);

  store.payroll.length = 0;
  store.payrollAnnouncements.length = 0;
  store.salespersons = store.salespersons.filter((rep) => rep.team_id !== TEAM_A);
  const noRepsFirst = await close("PAYEE");
  assert.strictEqual(noRepsFirst.status, 200);
  assert.strictEqual(noRepsFirst.body.closed, 0);
  assert.strictEqual((await close("CLOTURE")).status, 409, "le jalon équipe est monotone même sans ligne commerciale");

  store.payroll = savedPayroll;
  store.settings = savedSettings;
  store.payrollAnnouncements = savedAnnouncements;
  store.teamNotifications = savedNotifications;
  store.salespersons = savedReps;
});

test("la messagerie isole les conversations privées et les mentions d'équipe", async () => {
  const savedMessages = store.teamMessages.slice();
  const savedReads = store.messageReads.slice();
  const savedNotifications = store.directNotifications.slice();
  store.teamMessages.length = 0;
  store.messageReads.length = 0;
  store.directNotifications.length = 0;

  assert.strictEqual((await sofia("POST", "/api/messages", { content: "Bonjour", mention_ids: [u2.id] })).status, 201);
  assert.strictEqual(store.directNotifications.length, 1);
  assert.strictEqual(store.directNotifications[0].recipient_id, u2.id);

  const beforePrivate = store.teamMessages.length;
  const rejected = await sofia("POST", "/api/messages", {
    content: "Confidentiel",
    recipient_id: u2.id,
    mention_ids: [adminA.id],
  });
  assert.strictEqual(rejected.status, 400, "un message privé ne peut notifier un tiers");
  assert.strictEqual(store.teamMessages.length, beforePrivate);

  const sent = await sofia("POST", "/api/messages", { content: "En privé", recipient_id: u2.id });
  assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
  assert.strictEqual(store.directNotifications.length, 2);
  assert.strictEqual(store.directNotifications[1].recipient_id, u2.id);

  const adminInbox = await admin("GET", "/api/messages");
  assert.strictEqual(adminInbox.status, 200);
  assert.ok(!adminInbox.body.some((message) => message.id === sent.body.id), "un admin tiers ne lit pas le privé");
  const recipientInbox = await amine("GET", "/api/messages");
  assert.ok(recipientInbox.body.some((message) => message.id === sent.body.id));
  assert.ok(recipientInbox.body.some((message) => message.content === "Bonjour"), "la salle générale reste visible");
  assert.strictEqual((await otherAdmin("GET", "/api/messages")).body.length, 0, "une autre équipe ne voit rien");

  const markPrivate = await admin("POST", "/api/messages/read", { ids: [sent.body.id] });
  assert.strictEqual(markPrivate.status, 200);
  assert.strictEqual(markPrivate.body.marked, 0, "un tiers ne peut pas marquer comme lu le message privé");
  const markGeneral = await amine("POST", "/api/messages/read", { ids: [store.teamMessages[0].id] });
  assert.strictEqual(markGeneral.body.marked, 1);

  store.teamMessages.length = 0;
  const timestamp = "2026-01-01T00:00:00.000Z";
  const tieMessages = [uuid(), uuid(), uuid()].sort().map((id) => ({
    id, team_id: TEAM_A, sender_id: u1.id, recipient_id: null, content: id,
    mention_ids: [], created_at: timestamp,
  }));
  store.teamMessages.push(...tieMessages);
  const firstPage = await admin("GET", "/api/messages?limit=2");
  assert.strictEqual(firstPage.body.length, 2);
  const secondPage = await admin("GET", `/api/messages?limit=2&before=${encodeURIComponent(timestamp)}&before_id=${firstPage.body[0].id}`);
  assert.strictEqual(secondPage.body.length, 1, "les messages horodatés à égalité ne sont pas sautés");
  assert.strictEqual(secondPage.body[0].id, tieMessages[0].id);
  assert.strictEqual((await admin("GET", "/api/messages?before=invalid")).status, 400);

  store.teamMessages = savedMessages;
  store.messageReads = savedReads;
  store.directNotifications = savedNotifications;
});

test("les notifications ciblées et leurs accusés de lecture sont privés et persistants", async () => {
  const savedNotifications = store.notifications.slice();
  const savedReads = store.notificationReads.slice();
  store.notifications = [
    { id: uuid(), team_id: TEAM_A, actor_id: u1.id, recipient_id: null, type: "quiz_passed", title: "Quiz", created_at: new Date().toISOString() },
    { id: uuid(), team_id: TEAM_A, actor_id: u1.id, recipient_id: u2.id, type: "mention", title: "Privé", created_at: new Date().toISOString() },
    { id: uuid(), team_id: TEAM_B, actor_id: adminB.id, recipient_id: null, type: "quiz_passed", title: "Autre équipe", created_at: new Date().toISOString() },
  ];
  store.notificationReads.length = 0;
  const [general, privateNotice] = store.notifications;

  const senderFeed = await sofia("GET", "/api/notifications");
  assert.ok(senderFeed.body.some((item) => item.id === general.id));
  assert.ok(!senderFeed.body.some((item) => item.id === privateNotice.id), "le sender ne voit pas un message privé qui ne lui est pas destiné");
  const recipientFeed = await amine("GET", "/api/notifications");
  assert.ok(recipientFeed.body.some((item) => item.id === privateNotice.id));
  assert.ok(!recipientFeed.body.some((item) => item.id === general.id), "un commercial ne voit pas le fil général de l'équipe");
  const adminFeed = await admin("GET", "/api/notifications");
  assert.ok(adminFeed.body.some((item) => item.id === general.id));
  assert.ok(!adminFeed.body.some((item) => item.id === privateNotice.id), "même un admin ne lit pas une notification privée tierce");

  const forbidden = await sofia("POST", "/api/notifications/read", { ids: [privateNotice.id] });
  assert.strictEqual(forbidden.status, 200);
  assert.strictEqual(forbidden.body.marked, 0);
  const marked = await amine("POST", "/api/notifications/read", { ids: [privateNotice.id] });
  assert.strictEqual(marked.body.marked, 1);
  const seen = await amine("GET", "/api/notifications");
  assert.ok(seen.body.find((item) => item.id === privateNotice.id).read_at);
  assert.strictEqual((await amine("POST", "/api/notifications/read", { ids: [] })).body.marked, 0);
  assert.strictEqual((await amine("POST", "/api/notifications/read", { ids: ["invalid"] })).status, 400);

  store.notifications = savedNotifications;
  store.notificationReads = savedReads;
});
