"use strict";

const express = require("express");
const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError, teamScope } = require("../policies");

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/messages", requireUser, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && Number.isNaN(before.getTime())) throw new HttpError(400, "Curseur de pagination invalide.");
    const beforeId = req.query.before_id ? String(req.query.before_id) : null;
    if (beforeId && !UUID.test(beforeId)) throw new HttpError(400, "Curseur de pagination invalide.");
    const rows = await db.many(
      `select m.id, m.sender_id, m.recipient_id, m.content, m.mention_ids, m.created_at,
              s.full_name as sender_name, r.full_name as recipient_name,
              (mr.read_at is not null) as read,
              (m.sender_id <> $2 and mr.read_at is null) as unread
         from public.team_messages m
         join public.profiles s on s.id = m.sender_id
         left join public.profiles r on r.id = m.recipient_id
         left join public.team_message_reads mr on mr.message_id = m.id and mr.user_id = $2
        where m.team_id = $1
          and (m.recipient_id is null or m.recipient_id = $2 or m.sender_id = $2)
          and ($3::timestamptz is null or m.created_at < $3
               or (m.created_at = $3 and ($4::uuid is null or m.id < $4::uuid)))
        order by m.created_at desc, m.id desc
        limit $5`,
      [teamScope(req), req.user.id, before ? before.toISOString() : null, beforeId, limit]
    );
    return res.json(rows.reverse());
  } catch (err) {
    return next(err);
  }
});

router.post("/messages", requireUser, async (req, res, next) => {
  try {
    const teamId = teamScope(req);
    const body = req.body || {};
    if (typeof body.content !== "string") throw new HttpError(400, "Le message est obligatoire.");
    const content = body.content.trim();
    if (!content || content.length > 2000) throw new HttpError(400, "Le message doit contenir de 1 à 2000 caractères.");
    if (body.recipient_id !== undefined && body.recipient_id !== null && typeof body.recipient_id !== "string") {
      throw new HttpError(400, "Destinataire invalide.");
    }
    const recipientId = body.recipient_id ? String(body.recipient_id) : null;
    if (recipientId && (!UUID.test(recipientId) || recipientId === req.user.id)) {
      throw new HttpError(400, "Destinataire invalide.");
    }
    if (recipientId) {
      const recipient = await db.one(
        `select id from public.profiles where id = $1 and team_id = $2`,
        [recipientId, teamId]
      );
      if (!recipient) throw new HttpError(400, "Le destinataire ne fait pas partie de votre équipe.");
    }
    if (body.mention_ids !== undefined && !Array.isArray(body.mention_ids)) {
      throw new HttpError(400, "La liste des mentions doit être une liste.");
    }
    const mentionIds = Array.isArray(body.mention_ids) ? [...new Set(body.mention_ids.map(String))] : [];
    if (mentionIds.length > 20 || mentionIds.some((id) => !UUID.test(id) || id === req.user.id)) {
      throw new HttpError(400, "Liste de mentions invalide.");
    }
    if (recipientId && mentionIds.some((id) => id !== recipientId)) {
      throw new HttpError(400, "Un message privé ne peut mentionner que son destinataire.");
    }
    if (mentionIds.length) {
      const members = await db.many(
        `select id from public.profiles where team_id = $1 and id = any($2::uuid[])`,
        [teamId, mentionIds]
      );
      if (members.length !== mentionIds.length) throw new HttpError(400, "Une mention ne correspond pas à un membre de l'équipe.");
    }
    const mentions = [...new Set([...mentionIds, ...(recipientId ? [recipientId] : [])])];
    const result = await db.tx(async (client) => {
      const { rows } = await client.query(
        `insert into public.team_messages (team_id, sender_id, recipient_id, content, mention_ids)
         values ($1,$2,$3,$4,$5::uuid[]) returning *`,
        [teamId, req.user.id, recipientId, content, mentionIds]
      );
      const senderName = (req.profile && req.profile.full_name) || req.user.email;
      for (const userId of mentions) {
        await client.query(
          `insert into public.notifications (team_id, actor_id, actor_name, recipient_id, type, title, body)
           values ($1,$2,$3,$4,'mention',$5,$6)`,
          [teamId, req.user.id, senderName, userId,
            recipientId && userId === recipientId ? "Nouveau message privé" : "Vous êtes mentionné dans un message",
            content.slice(0, 300)]
        );
      }
      return rows[0];
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
});

router.post("/messages/read", requireUser, async (req, res, next) => {
  try {
    const rawIds = req.body && req.body.ids;
    if (rawIds !== undefined && !Array.isArray(rawIds)) throw new HttpError(400, "La liste des messages est invalide.");
    const ids = Array.isArray(rawIds) ? [...new Set(rawIds.map(String))] : [];
    if (ids.length > 300 || ids.some((id) => !UUID.test(id))) throw new HttpError(400, "Liste d'identifiants de messages invalide.");
    let marked = 0;
    if (ids.length) {
      const result = await db.query(
        `insert into public.team_message_reads (message_id, user_id)
         select m.id, $2 from public.team_messages m
          where m.team_id = $1 and m.id = any($3::uuid[])
            and (m.recipient_id is null or m.recipient_id = $2)
         on conflict (message_id, user_id) do nothing`,
        [teamScope(req), req.user.id, ids]
      );
      marked = result.rowCount;
    }
    return res.json({ ok: true, marked });
  } catch (err) {
    return next(err);
  }
});

router.get("/messages/members", requireUser, async (req, res, next) => {
  try {
    const rows = await db.many(
      `select id, full_name, role from public.profiles where team_id = $1 and id <> $2 order by full_name`,
      [teamScope(req), req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
