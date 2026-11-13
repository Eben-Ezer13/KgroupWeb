"use strict";

const express = require("express");
const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError } = require("../policies");

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "🔥"]);

router.get("/messages", requireUser, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
    const rawConversation = String(req.query.conversation || "team");
    const peerId = rawConversation === "team" ? null : rawConversation;
    if (peerId && (!UUID.test(peerId) || peerId === req.user.id)) throw new HttpError(400, "Conversation invalide.");
    const teamId = req.profile && req.profile.team_id || null;
    if (peerId) {
      const peer = await db.one(`select id from public.profiles where id = $1`, [peerId]);
      if (!peer) throw new HttpError(404, "Ce compte n'existe pas.");
    }
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && Number.isNaN(before.getTime())) throw new HttpError(400, "Curseur de pagination invalide.");
    const beforeId = req.query.before_id ? String(req.query.before_id) : null;
    if (beforeId && !UUID.test(beforeId)) throw new HttpError(400, "Curseur de pagination invalide.");
    const rows = await db.many(
      `select m.id, m.sender_id, m.recipient_id, m.content, m.mention_ids, m.created_at,
              s.full_name as sender_name, r.full_name as recipient_name,
              reply.id as reply_to_id, reply.content as reply_content,
              reply_sender.full_name as reply_sender_name,
              (mr.read_at is not null) as read,
              (m.sender_id <> $1 and mr.read_at is null) as unread,
              coalesce((
                select json_agg(json_build_object('emoji', grouped.emoji, 'count', grouped.count, 'reacted', grouped.reacted)
                                order by grouped.first_reaction)
                  from (
                    select reaction.emoji, count(*)::int as count,
                           bool_or(reaction.user_id = $1) as reacted, min(reaction.created_at) as first_reaction
                      from public.team_message_reactions reaction
                     where reaction.message_id = m.id
                     group by reaction.emoji
                  ) grouped
              ), '[]'::json) as reactions
         from public.team_messages m
         join public.profiles s on s.id = m.sender_id
         left join public.profiles r on r.id = m.recipient_id
         left join public.team_messages reply on reply.id = m.reply_to_message_id
         left join public.profiles reply_sender on reply_sender.id = reply.sender_id
         left join public.team_message_reads mr on mr.message_id = m.id and mr.user_id = $1
        where (
          ($2::uuid is null and m.recipient_id is null and (m.team_id is null or m.team_id = $6::uuid))
          or ($2::uuid is not null and (
            (m.sender_id = $1 and m.recipient_id = $2)
            or (m.sender_id = $2 and m.recipient_id = $1)
          ))
        )
          and ($3::timestamptz is null or m.created_at < $3
               or (m.created_at = $3 and ($4::uuid is null or m.id < $4::uuid)))
        order by m.created_at desc, m.id desc limit $5`,
      [req.user.id, peerId, before ? before.toISOString() : null, beforeId, limit, teamId]
    );
    return res.json(rows.reverse());
  } catch (err) { return next(err); }
});

router.post("/messages", requireUser, async (req, res, next) => {
  try {
    const senderId = req.user.id;
    const teamId = req.profile && req.profile.team_id || null;
    const body = req.body || {};
    if (typeof body.content !== "string") throw new HttpError(400, "Le message est obligatoire.");
    const content = body.content.trim();
    if (!content || content.length > 2000) throw new HttpError(400, "Le message doit contenir de 1 à 2000 caractères.");
    if (body.recipient_id !== undefined && body.recipient_id !== null && typeof body.recipient_id !== "string") throw new HttpError(400, "Destinataire invalide.");
    const recipientId = body.recipient_id ? String(body.recipient_id) : null;
    if (recipientId && (!UUID.test(recipientId) || recipientId === senderId)) throw new HttpError(400, "Destinataire invalide.");
    if (recipientId && !await db.one(`select id from public.profiles where id = $1`, [recipientId])) throw new HttpError(400, "Le destinataire n'existe pas.");
    if (body.mention_ids !== undefined && !Array.isArray(body.mention_ids)) throw new HttpError(400, "La liste des mentions doit être une liste.");
    const mentionIds = Array.isArray(body.mention_ids) ? [...new Set(body.mention_ids.map(String))] : [];
    if (mentionIds.length > 20 || mentionIds.some((id) => !UUID.test(id) || id === senderId)) throw new HttpError(400, "Liste de mentions invalide.");
    if (recipientId && mentionIds.some((id) => id !== recipientId)) throw new HttpError(400, "Un message privé ne peut mentionner que son destinataire.");
    if (mentionIds.length) {
      const members = await db.many(`select id from public.profiles where id = any($1::uuid[])`, [mentionIds]);
      if (members.length !== mentionIds.length) throw new HttpError(400, "Une mention ne correspond pas à un compte de la plateforme.");
    }
    let replyToId = null;
    let messageTeamId = null;
    if (body.reply_to_message_id !== undefined && body.reply_to_message_id !== null && body.reply_to_message_id !== "") {
      replyToId = String(body.reply_to_message_id);
      if (!UUID.test(replyToId)) throw new HttpError(400, "Message de réponse invalide.");
      const parent = await db.one(`select id, sender_id, recipient_id, team_id from public.team_messages where id = $1`, [replyToId]);
      const sameConversation = parent && (recipientId
        ? ((parent.sender_id === senderId && parent.recipient_id === recipientId) || (parent.sender_id === recipientId && parent.recipient_id === senderId))
        : parent.recipient_id === null && (parent.team_id === null || parent.team_id === teamId));
      if (!sameConversation) throw new HttpError(400, "Impossible de répondre à un message de cette conversation.");
      if (!recipientId && parent.team_id) {
        messageTeamId = parent.team_id;
        if (mentionIds.length) {
          const legacyTeamMembers = await db.many(
            `select id from public.profiles where team_id = $1 and id = any($2::uuid[])`,
            [parent.team_id, mentionIds]
          );
          if (legacyTeamMembers.length !== mentionIds.length) {
            throw new HttpError(400, "Une ancienne conversation d'équipe ne peut mentionner que ses membres.");
          }
        }
      }
    }
    const notifyIds = [...new Set([...mentionIds, ...(recipientId ? [recipientId] : [])])];
    const result = await db.tx(async (client) => {
      const { rows } = await client.query(
        `insert into public.team_messages (team_id, sender_id, recipient_id, content, mention_ids, reply_to_message_id)
         values ($1,$2,$3,$4,$5::uuid[],$6) returning *`,
        [messageTeamId, senderId, recipientId, content, mentionIds, replyToId]
      );
      const senderName = (req.profile && req.profile.full_name) || req.user.email;
      if (notifyIds.length) {
        const recipients = await client.query(`select id, team_id from public.profiles where id = any($1::uuid[])`, [notifyIds]);
        for (const recipient of recipients.rows) {
          if (!recipient.team_id) continue;
          await client.query(
            `insert into public.notifications (team_id, actor_id, actor_name, recipient_id, type, title, body)
             values ($1,$2,$3,$4,'mention',$5,$6)`,
            [recipient.team_id, senderId, senderName, recipient.id,
              recipientId && recipient.id === recipientId ? "Nouveau message privé" : "Vous êtes mentionné dans un message", content.slice(0, 300)]
          );
        }
      }
      return rows[0];
    });
    return res.status(201).json(result);
  } catch (err) { return next(err); }
});

router.post("/messages/:messageId/reactions", requireUser, async (req, res, next) => {
  try {
    const messageId = String(req.params.messageId || "");
    const emoji = req.body && req.body.emoji;
    if (!UUID.test(messageId)) throw new HttpError(400, "Message invalide.");
    if (!REACTION_EMOJIS.has(emoji)) throw new HttpError(400, "Réaction invalide.");

    const userId = req.user.id;
    const teamId = req.profile && req.profile.team_id || null;
    const message = await db.one(
      `select id from public.team_messages
        where id = $1 and (
          (recipient_id is null and (team_id is null or team_id = $2::uuid))
          or (recipient_id is not null and (sender_id = $3 or recipient_id = $3))
        )`,
      [messageId, teamId, userId]
    );
    if (!message) throw new HttpError(404, "Message introuvable.");

    const result = await db.tx(async (client) => {
      const existing = await client.query(
        `select 1 from public.team_message_reactions where message_id = $1 and user_id = $2 and emoji = $3`,
        [messageId, userId, emoji]
      );
      const active = existing.rowCount === 0;
      if (active) {
        await client.query(
          `insert into public.team_message_reactions (message_id, user_id, emoji)
           values ($1, $2, $3) on conflict (message_id, user_id, emoji) do nothing`,
          [messageId, userId, emoji]
        );
      } else {
        await client.query(
          `delete from public.team_message_reactions where message_id = $1 and user_id = $2 and emoji = $3`,
          [messageId, userId, emoji]
        );
      }
      const { rows } = await client.query(
        `select emoji, count(*)::int as count, bool_or(user_id = $2) as reacted
           from public.team_message_reactions where message_id = $1 group by emoji
           order by min(created_at)`,
        [messageId, userId]
      );
      return { active, reactions: rows };
    });
    return res.json(result);
  } catch (err) { return next(err); }
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
         select m.id, $1 from public.team_messages m
          where m.id = any($2::uuid[]) and (
            (m.recipient_id is null and (m.team_id is null or m.team_id = $3::uuid))
            or m.recipient_id = $1
          ) on conflict (message_id, user_id) do nothing`,
        [req.user.id, ids, req.profile && req.profile.team_id || null]
      );
      marked = result.rowCount;
    }
    return res.json({ ok: true, marked });
  } catch (err) { return next(err); }
});

router.delete("/messages/:messageId", requireUser, async (req, res, next) => {
  try {
    const messageId = String(req.params.messageId || "");
    if (!UUID.test(messageId)) throw new HttpError(400, "Message invalide.");
    const deleted = await db.one(
      `delete from public.team_messages
        where id = $1 and sender_id = $2 and (
          (recipient_id is null and (team_id is null or team_id = $3::uuid))
          or (recipient_id is not null and (sender_id = $2 or recipient_id = $2))
        ) returning id`,
      [messageId, req.user.id, req.profile && req.profile.team_id || null]
    );
    if (!deleted) throw new HttpError(404, "Message introuvable ou suppression non autorisée.");
    return res.json({ ok: true, id: deleted.id });
  } catch (err) { return next(err); }
});

router.get("/messages/members", requireUser, async (req, res, next) => {
  try {
    const rows = await db.many(
      `select id, full_name, role,
              coalesce(last_seen_at > now() - interval '90 seconds', false) as online
         from public.profiles where id <> $1 order by full_name`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) { return next(err); }
});

router.post("/messages/presence", requireUser, async (req, res, next) => {
  try {
    await db.query(`update public.profiles set last_seen_at = now() where id = $1`, [req.user.id]);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

module.exports = router;
