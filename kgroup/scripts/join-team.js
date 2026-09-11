/* =========================================================================
   Rattache un compte à l'équipe d'un administrateur existant — typiquement
   pour qu'un deuxième administrateur partage le même tableau de bord, les
   mêmes commerciaux, les mêmes ventes et les mêmes clients.

   Usage :
     node scripts/join-team.js <email du compte à rattacher> <email d'un admin de l'équipe cible>
     node scripts/join-team.js <…> <…> --apply

   Sans --apply, le script montre seulement ce qu'il ferait : aucune écriture.

   Pourquoi un script et pas un rattachement automatique : l'inscription est
   publique et chaque nouvel administrateur reçoit sa propre équipe. Ouvrir
   les données d'une équipe à un autre compte doit rester un geste délibéré.

   Garde-fous :
     - le second compte doit être administrateur de l'équipe visée ;
     - si l'ancienne équipe du compte contient la moindre donnée (commerciaux,
       ventes, clients, paie…), le script refuse : il ne fusionne et ne
       supprime jamais de données en silence ;
     - tout se fait en une seule transaction ; l'ancienne équipe, vide, est
       ensuite supprimée.
   ========================================================================= */
"use strict";

require("dotenv").config();
const { pool } = require("../server/db");

const USAGE =
  "Usage : node scripts/join-team.js <email du compte à rattacher> <email d'un admin de l'équipe cible> [--apply]";

/* Les données métier d'une équipe : leur présence bloque le rattachement.
   Les réglages de paie (compensation_settings) n'en font pas partie : c'est
   une ligne de configuration créée pour chaque équipe, qui disparaît avec
   l'ancienne équipe — le compte adopte ceux de l'équipe qu'il rejoint. */
const TEAM_TABLES = [
  "salespersons", "sales", "clients", "challenges", "notifications",
  "payroll_periods", "training_progress", "quiz_attempts",
];

async function accountOf(client, email) {
  const { rows } = await client.query(
    `select u.id, u.email, p.full_name, p.role, p.team_id, t.name as team_name
       from public.users u
       join public.profiles p on p.id = u.id
       left join public.teams t on t.id = p.team_id
      where lower(u.email) = $1`,
    [email]
  );
  return rows[0] || null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [joinEmail, targetEmail] = args.filter((a) => !a.startsWith("--")).map((a) => a.trim().toLowerCase());
  if (!joinEmail || !targetEmail) {
    console.error(USAGE);
    return 2;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const joiner = await accountOf(client, joinEmail);
    const target = await accountOf(client, targetEmail);
    if (!joiner) throw new Error(`Aucun compte pour ${joinEmail}.`);
    if (!target) throw new Error(`Aucun compte pour ${targetEmail}.`);
    if (target.role !== "admin" || !target.team_id) {
      throw new Error(`${targetEmail} n'est pas administrateur d'une équipe.`);
    }

    console.log(`Compte à rattacher : ${joiner.full_name} (${joiner.role}) — équipe actuelle « ${joiner.team_name || "aucune"} »`);
    console.log(`Équipe visée       : « ${target.team_name} » (administrée par ${target.full_name})`);

    if (joiner.team_id === target.team_id) {
      await client.query("ROLLBACK");
      console.log("\nDéjà dans la même équipe : rien à faire.");
      return 0;
    }

    // Ce qui vit encore dans l'ancienne équipe, en dehors du compte lui-même.
    const leftovers = {};
    if (joiner.team_id) {
      for (const table of TEAM_TABLES) {
        const { rows } = await client.query(
          `select count(*)::int as n from public.${table} where team_id = $1`, [joiner.team_id]);
        if (rows[0].n) leftovers[table] = rows[0].n;
      }
      const { rows } = await client.query(
        `select count(*)::int as n from public.profiles where team_id = $1 and id <> $2`, [joiner.team_id, joiner.id]);
      if (rows[0].n) leftovers["autres comptes"] = rows[0].n;
    }
    if (Object.keys(leftovers).length) {
      const detail = Object.entries(leftovers).map(([t, n]) => `${t}: ${n}`).join(", ");
      throw new Error(`L'équipe actuelle du compte contient des données (${detail}). ` +
        "Rien n'a été modifié : ces données doivent être traitées à part avant tout rattachement.");
    }

    console.log(`\nL'équipe actuelle ne contient aucune donnée. Le compte rejoindra « ${target.team_name} »` +
      (joiner.team_id ? " et son ancienne équipe, vide, sera supprimée." : "."));
    if (!apply) {
      await client.query("ROLLBACK");
      console.log("\nAperçu seulement : aucune modification. Relancez avec --apply pour appliquer.");
      return 0;
    }

    await client.query(`update public.profiles set team_id = $1 where id = $2`, [target.team_id, joiner.id]);
    if (joiner.team_id) await client.query(`delete from public.teams where id = $1`, [joiner.team_id]);
    await client.query("COMMIT");
    console.log(`\nFait : ${joiner.full_name} partage désormais l'équipe « ${target.team_name} ».`);
    return 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\nÉchec : ${err.message}`);
    return 1;
  } finally {
    client.release();
  }
}

main()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1); });
