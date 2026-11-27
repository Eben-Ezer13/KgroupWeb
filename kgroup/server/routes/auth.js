/* =========================================================================
   KGROUP — /api/auth/*  (the endpoints behind window.KGAuth)
   -------------------------------------------------------------------------
   Each route reproduces one Supabase Auth call, including the shape of what it
   returned, so api.js can keep the browser-facing KGAuth contract unchanged.

     supabase.auth.signUp                 -> POST   /api/auth/signup
     supabase.auth.signInWithPassword     -> POST   /api/auth/signin
     supabase.auth.signInWithOAuth        -> GET    /api/auth/google (+ callback)
     supabase.auth.signOut                -> POST   /api/auth/signout
     supabase.auth.getUser                -> GET    /api/auth/user
     supabase.auth.updateUser({password}) -> POST   /api/auth/password
     supabase.auth.resetPasswordForEmail  -> POST   /api/auth/reset
     (recovery link lands on the app)     -> POST   /api/auth/reset/confirm
     supabase.rpc('invite_info')          -> GET    /api/auth/invite?code=
   ========================================================================= */
"use strict";

const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../db");
const auth = require("../auth");
const mailer = require("../mailer");
const { HttpError, teamScope, requireAdmin } = require("../policies");

const router = express.Router();

const REQUIRE_CONFIRMATION = String(process.env.REQUIRE_EMAIL_CONFIRMATION || "") === "true";
const MIN_PASSWORD = 6; // matches the client-side checks in login.html / register.html

const normalizeEmail = (e) => String(e || "").trim().toLowerCase();
const normalizePersonName = (name) => String(name || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(" ");
const TEAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function teamJoinSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new HttpError(503, "Le lien commun est indisponible : la clé sécurisée du serveur n'est pas configurée.");
  }
  return secret;
}

function makeTeamJoinCode(teamId) {
  const normalizedTeamId = String(teamId || "").toLowerCase();
  if (!TEAM_ID_RE.test(normalizedTeamId)) throw new HttpError(400, "Équipe invalide.");
  const signature = crypto.createHmac("sha256", teamJoinSecret())
    .update(`kgroup:team-join:v1:${normalizedTeamId}`)
    .digest("hex");
  return `v1.${normalizedTeamId}.${signature}`;
}

function teamIdFromJoinCode(code) {
  const match = /^v1\.([0-9a-f-]{36})\.([0-9a-f]{64})$/i.exec(String(code || ""));
  if (!match || !TEAM_ID_RE.test(match[1])) return null;
  const teamId = match[1].toLowerCase();
  const expected = crypto.createHmac("sha256", teamJoinSecret())
    .update(`kgroup:team-join:v1:${teamId}`)
    .digest();
  const supplied = Buffer.from(match[2], "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected) ? teamId : null;
}

/** The public URL of the static site, used to build links in emails/redirects. */
function appUrl(req) {
  const configured = process.env.APP_URL;
  const productionBase = "https://kgroup-gilt.vercel.app/";
  const base = process.env.VERCEL ? productionBase : (configured || `${req.protocol}://${req.get("host")}`);
  return base.endsWith("/") ? base : base + "/";
}

/** The session payload the browser client stores, mirroring Supabase's shape. */
function sessionPayload(user, token) {
  return {
    user: {
      id: user.id,
      email: user.email,
      user_metadata: user.raw_user_meta_data || {},
      created_at: user.created_at,
    },
    session: token ? { access_token: token } : null,
  };
}

/* ------------------------------------------------------------------ *
 * SIGN UP                                                             *
 * ------------------------------------------------------------------ */
router.get("/join-link", auth.requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);
    const code = makeTeamJoinCode(teamId);
    const link = new URL("register.html", appUrl(req));
    link.searchParams.set("join", code);
    return res.json({ url: link.toString() });
  } catch (err) {
    return next(err);
  }
});

router.get("/join-info", async (req, res, next) => {
  try {
    const teamId = teamIdFromJoinCode(req.query.code);
    if (!teamId) return res.json({ join: null });
    const team = await db.one(`select id, name from public.teams where id = $1`, [teamId]);
    return res.json({ join: team ? { team_name: team.name || "KGROUP Parfumery" } : null });
  } catch (err) {
    return next(err);
  }
});

router.post("/join", auth.requireUser, async (req, res, next) => {
  try {
    const teamId = teamIdFromJoinCode(req.body && req.body.join_code);
    if (!teamId) throw new HttpError(400, "Ce lien d’accès est invalide.");
    if (!req.profile || req.profile.role !== "salesperson") {
      throw new HttpError(403, "Ce lien est réservé aux comptes commerciaux.");
    }

    const result = await db.tx(async (client) => {
      const team = await client.query(`select id, owner from public.teams where id = $1 for share`, [teamId]);
      if (!team.rows.length) throw new HttpError(400, "L’espace de l’entreprise est introuvable.");

      const existing = await client.query(
        `select id, team_id, status from public.salespersons where auth_id = $1 for update`,
        [req.user.id]
      );
      let salespersonId;
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.team_id && row.team_id !== teamId) throw new HttpError(409, "Ce compte est déjà rattaché à une autre équipe.");
        salespersonId = row.id;
        await client.query(
          `update public.salespersons set team_id = $2, status = 'Active', claimed = true where id = $1`,
          [salespersonId, teamId]
        );
      } else {
        const rosterMatch = await client.query(
          `select id, auth_id from public.salespersons
            where lower(email) = $1 and (team_id = $2 or team_id is null)
            order by (auth_id is null) desc,
                     (status = 'Archived') asc, created_at asc, id asc
            limit 1 for update`,
          [normalizeEmail(req.user.email), teamId]
        );
        if (rosterMatch.rows.length && rosterMatch.rows[0].auth_id && rosterMatch.rows[0].auth_id !== req.user.id) {
          throw new HttpError(409, "Cette fiche commerciale est déjà rattachée à un autre compte. Contactez l’administrateur.");
        }

        if (rosterMatch.rows.length) {
          salespersonId = rosterMatch.rows[0].id;
          await client.query(
            `update public.salespersons
                set team_id = $2, auth_id = $3,
                    claimed = true, invite_code = null, email = $4, status = 'Active'
              where id = $1`,
            [salespersonId, teamId, req.user.id, normalizeEmail(req.user.email)]
          );
        } else {
          const sameName = await client.query(
            `select name from public.salespersons
              where team_id = $1
              order by created_at asc, id asc
              for update`,
            [teamId]
          );
          if (sameName.rows.some((row) => normalizePersonName(row.name) === normalizePersonName(req.profile.full_name))) {
            throw new HttpError(409, "Cette fiche commerciale existe déjà avec une autre adresse e-mail. Vérifiez l’adresse de la fiche avec l’administrateur avant de continuer.");
          }
          const { rows } = await client.query(
            `insert into public.salespersons (owner, team_id, auth_id, claimed, name, email, status)
             values ($1, $2, $3, true, $4, $5, 'Active') returning id`,
            [team.rows[0].owner, req.user.id, teamId,
              (req.profile.full_name || req.user.email.split("@")[0]).trim(), normalizeEmail(req.user.email)]
          );
          salespersonId = rows[0].id;
        }
      }
      await client.query(
        `update public.profiles set role = 'salesperson', team_id = $2, salesperson_id = $3 where id = $1`,
        [req.user.id, teamId, salespersonId]
      );
      return { salesperson_id: salespersonId };
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

router.post("/signup", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const fullName = (req.body.full_name || "").trim() || email.split("@")[0];
    const role = req.body.role === "salesperson" ? "salesperson" : "admin";
    const inviteCode = req.body.invite_code ? String(req.body.invite_code) : null;
    const joinCode = req.body.join_code ? String(req.body.join_code) : null;

    if (!email || !email.includes("@")) throw new HttpError(400, "Please enter a valid email address.");
    if (password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
    }

    const existing = await db.one(`select id from public.users where lower(email) = $1`, [email]);
    if (existing) throw new HttpError(409, "An account with this email already exists.");

    if (role === "salesperson" && inviteCode && joinCode) {
      throw new HttpError(400, "Utilisez un seul lien d’inscription à la fois.");
    }
    if (role === "salesperson" && !inviteCode && !joinCode) {
      throw new HttpError(400, "Un lien d’accès commercial valide est nécessaire pour créer ce compte.");
    }
    if (role !== "salesperson" && (inviteCode || joinCode)) {
      throw new HttpError(400, "Ce lien d’accès est réservé aux comptes commerciaux.");
    }

    const passwordHash = await auth.hashPassword(password);
    const confirmedAt = REQUIRE_CONFIRMATION ? null : new Date();
    const user = role === "salesperson"
      ? await db.tx(async (client) => {
          const duplicate = await client.query(`select id from public.users where lower(email) = $1`, [email]);
          if (duplicate.rows.length) throw new HttpError(409, "An account with this email already exists. Sign in with that account.");

          let joinTeamId = null;
          if (inviteCode) {
            const invite = await client.query(
              `select id from public.salespersons
                where invite_code = $1 and coalesce(claimed, false) = false
                for update`, [inviteCode]
            );
            if (!invite.rows.length) throw new HttpError(400, "Cette invitation est invalide ou a déjà été utilisée.");
          } else {
            joinTeamId = teamIdFromJoinCode(joinCode);
            if (!joinTeamId) throw new HttpError(400, "Ce lien d’accès commercial est invalide.");
            const team = await client.query(`select id, owner from public.teams where id = $1 for share`, [joinTeamId]);
            if (!team.rows.length) throw new HttpError(400, "L’espace de l’entreprise est introuvable.");
          }

          const meta = { full_name: fullName, role };
          if (inviteCode) meta.invite_code = inviteCode;
          const created = await client.query(
            `insert into public.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
             values ($1, $2, $3::jsonb, $4)
             returning id, email, raw_user_meta_data, created_at, email_confirmed_at`,
            [email, passwordHash, JSON.stringify(meta), confirmedAt]
          );
          const newUser = created.rows[0];

          // Individual invites are claimed by the database trigger. With the
          // reusable company link, reuse an unclaimed roster row with the same
          // email so sales history and payroll stay attached to its original ID.
          if (joinTeamId) {
            const team = await client.query(`select owner from public.teams where id = $1`, [joinTeamId]);
            const rosterMatch = await client.query(
              `select id, auth_id from public.salespersons
                where lower(email) = $1 and (team_id = $2 or team_id is null)
                order by (auth_id is null) desc,
                         (status = 'Archived') asc, created_at asc, id asc
                limit 1 for update`,
              [email, joinTeamId]
            );
            let salespersonId;
            if (rosterMatch.rows.length && rosterMatch.rows[0].auth_id) {
              throw new HttpError(409, "Cette fiche commerciale est déjà rattachée à un autre compte. Contactez l’administrateur.");
            }
            if (rosterMatch.rows.length) {
              salespersonId = rosterMatch.rows[0].id;
              await client.query(
                `update public.salespersons
                    set team_id = $2, auth_id = $3,
                        claimed = true, invite_code = null, email = $4, status = 'Active'
                  where id = $1`,
                [salespersonId, joinTeamId, newUser.id, email]
              );
            } else {
              const sameName = await client.query(
                `select id, name from public.salespersons
                  where team_id = $1
                  order by created_at asc, id asc
                  for update`,
                [joinTeamId]
              );
              if (sameName.rows.some((row) => normalizePersonName(row.name) === normalizePersonName(fullName))) {
                throw new HttpError(409, "Cette fiche commerciale existe déjà avec une autre adresse e-mail. Vérifiez l’adresse de la fiche avec l’administrateur avant de créer le compte.");
              }
              const reps = await client.query(
                `insert into public.salespersons (owner, team_id, auth_id, claimed, name, email, status)
                 values ($1, $2, $3, true, $4, $5, 'Active') returning id`,
                [team.rows[0].owner, newUser.id, joinTeamId, fullName, email]
              );
              salespersonId = reps.rows[0].id;
            }
            await client.query(
              `update public.profiles set full_name = $2, email = $3, role = 'salesperson', team_id = $4, salesperson_id = $5 where id = $1`,
              [newUser.id, fullName, email, joinTeamId, salespersonId]
            );
          }
          return newUser;
        })
      : await db.one(
          `insert into public.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
           values ($1, $2, $3::jsonb, $4)
           returning id, email, raw_user_meta_data, created_at, email_confirmed_at`,
          [email, passwordHash, JSON.stringify({ full_name: fullName, role }), confirmedAt]
        );

    // With confirmation required there is no session yet — exactly the
    // `res.user && !res.session` branch login.html and register.html handle.
    if (REQUIRE_CONFIRMATION) return res.status(201).json(sessionPayload(user, null));

    const token = auth.signSession(user);
    auth.setSessionCookie(res, token);
    return res.status(201).json(sessionPayload(user, token));
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * SIGN IN                                                             *
 * ------------------------------------------------------------------ */
router.post("/signin", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!email || !password) throw new HttpError(400, "Please enter your email and password.");

    const user = await db.one(
      `select id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at
         from public.users where lower(email) = $1`,
      [email]
    );

    // Same generic message whether the address is unknown or the password is
    // wrong, so the endpoint cannot be used to enumerate accounts.
    const ok = user && (await auth.verifyPassword(password, user.encrypted_password));
    if (!ok) throw new HttpError(401, "Invalid login credentials.");

    if (REQUIRE_CONFIRMATION && !user.email_confirmed_at) {
      throw new HttpError(403, "Please confirm your email address before signing in.");
    }

    const token = auth.signSession(user);
    auth.setSessionCookie(res, token);
    return res.json(sessionPayload(user, token));
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * SIGN OUT                                                            *
 * ------------------------------------------------------------------ */
router.post("/signout", (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * CURRENT USER                                                        *
 * ------------------------------------------------------------------ */
router.get("/user", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      user_metadata: req.user.raw_user_meta_data || {},
      created_at: req.user.created_at,
    },
  });
});

/* ------------------------------------------------------------------ *
 * CHANGE PASSWORD (signed in)                                         *
 * ------------------------------------------------------------------ */
router.post("/password", auth.requireUser, async (req, res, next) => {
  try {
    const password = String(req.body.password || "");
    if (password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
    }
    await db.query(
      `update public.users set encrypted_password = $2, updated_at = now() where id = $1`,
      [req.user.id, await auth.hashPassword(password)]
    );
    // Re-issue the session so the current tab keeps working after the change.
    auth.setSessionCookie(res, auth.signSession(req.user));
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * FORGOT PASSWORD                                                     *
 * ------------------------------------------------------------------ */
router.post("/reset", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) throw new HttpError(400, "Please enter your email address.");

    const user = await db.one(`select id, email from public.users where lower(email) = $1`, [email]);
    if (user) {
      const token = await auth.issueResetToken(user.id, 60);
      const link = `${appUrl(req)}reset-password.html?token=${encodeURIComponent(token)}`;
      const { subject, html, text } = mailer.resetEmail(link);
      await mailer.send({ to: user.email, subject, html, text });
    }

    // Always the same answer, whether or not the address exists — matching
    // Supabase's behaviour and avoiding account enumeration.
    return res.json({
      ok: true,
      mailer_configured: mailer.isConfigured(),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/reset/confirm", async (req, res, next) => {
  try {
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");
    if (!token) throw new HttpError(400, "This reset link is missing its token.");
    if (password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
    }
    const userId = await auth.consumeResetToken(token, password);
    if (!userId) throw new HttpError(400, "This reset link is invalid or has expired.");
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * INVITE LOOKUP  (was supabase.rpc('invite_info'))                    *
 * ------------------------------------------------------------------ */
router.get("/invite", async (req, res, next) => {
  try {
    const code = String(req.query.code || "");
    if (!code) return res.json({ invite: null });
    const row = await db.one(`select * from public.invite_info($1)`, [code]);
    return res.json({ invite: row || null });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * GOOGLE OAUTH  (was supabase.auth.signInWithOAuth)                   *
 * -------------------------------------------------------------------
 * Supabase brokered this for us. Here it is the standard authorization-code
 * flow against Google directly. It stays dormant — and says so clearly —
 * until GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are configured.
 * ------------------------------------------------------------------ */
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const googleConfigured = () => Boolean(GOOGLE_ID && GOOGLE_SECRET);

const redirectUri = (req) =>
  process.env.GOOGLE_REDIRECT_URI ||
  `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

router.get("/google", (req, res) => {
  if (!googleConfigured()) {
    return res.status(501).json({
      error:
        "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, " +
        "and add this app's callback URL in the Google Cloud console.",
    });
  }
  // `state` is a short-lived signed token — it is verified on the way back, so
  // a forged callback cannot start a session.
  const state = jwt.sign(
    { n: crypto.randomBytes(8).toString("hex"), next: String(req.query.next || "dashboard.html") },
    process.env.JWT_SECRET || "dev",
    { expiresIn: "10m" }
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_ID);
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return res.redirect(url.toString());
});

router.get("/google/callback", async (req, res, next) => {
  try {
    if (!googleConfigured()) throw new HttpError(501, "Google sign-in is not configured.");

    let next_ = "dashboard.html";
    try {
      const claims = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET || "dev");
      if (claims && claims.next) next_ = claims.next;
    } catch (_) {
      throw new HttpError(400, "This Google sign-in link is invalid or has expired.");
    }

    const code = String(req.query.code || "");
    if (!code) throw new HttpError(400, "Google did not return an authorization code.");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_ID,
        client_secret: GOOGLE_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new HttpError(502, "Google rejected the sign-in attempt.");
    const tokens = await tokenRes.json();

    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) throw new HttpError(502, "Could not read your Google profile.");
    const info = await infoRes.json();

    const email = normalizeEmail(info.email);
    if (!email) throw new HttpError(400, "Your Google account did not share an email address.");

    let user = await db.one(
      `select id, email, raw_user_meta_data, created_at from public.users where lower(email) = $1`,
      [email]
    );

    if (user) {
      // Existing account (possibly password-based) — link the provider.
      await db.query(
        `update public.users
            set provider = 'google', provider_id = $2, email_confirmed_at = coalesce(email_confirmed_at, now()),
                updated_at = now()
          where id = $1`,
        [user.id, info.sub || null]
      );
    } else {
      // New Google user. The signup trigger gives them a team + admin profile,
      // matching what the Google button on the admin login page produced before.
      const meta = { full_name: info.name || email.split("@")[0], role: "admin" };
      user = await db.one(
        `insert into public.users (email, provider, provider_id, raw_user_meta_data, email_confirmed_at)
         values ($1, 'google', $2, $3::jsonb, now())
         returning id, email, raw_user_meta_data, created_at`,
        [email, info.sub || null, JSON.stringify(meta)]
      );
    }

    auth.setSessionCookie(res, auth.signSession(user));
    return res.redirect(appUrl(req) + next_);
  } catch (err) {
    return next(err);
  }
});

router.get("/google/status", (_req, res) => res.json({ configured: googleConfigured() }));

module.exports = router;

