# Déployer KGROUP sur Vercel

Le projet est prêt : `npm run build` valide tout et assemble `dist/`.
Il ne reste que la configuration côté Vercel.

Hébergement : **Vercel**. Base de données : **Neon PostgreSQL**, connectée par la
seule variable `DATABASE_URL`. Aucun autre hébergeur n'est pris en charge.

---

## 1. Ce que Vercel doit exécuter

Ces valeurs sont déjà dans [`vercel.json`](vercel.json) — Vercel les lit
automatiquement, il n'y a rien à saisir dans **Settings → Build & Deployment** :

| Réglage | Valeur |
| --- | --- |
| Framework Preset | `Other` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Fonction API | `api/index.js` (toutes les routes `/api/*`) |
| Version de Node | `22.x` (lue dans `package.json` → `engines`) |

> Si le dépôt contient le projet dans un sous-dossier, réglez
> **Root Directory** sur ce sous-dossier (celui qui contient `vercel.json`).

> `dist/` est régénéré à chaque build et **ignoré par git** — ne le commitez pas.

---

## 2. Variables d'environnement

**Settings → Environment Variables → Add.** Cochez au minimum l'environnement
**Production** (et **Preview** si vous utilisez les aperçus).

Les valeurs sont dans votre fichier `.env` local. **Copiez-les depuis là** — ce
fichier ne doit jamais être commité ni partagé.

### Requises — sans elles, l'API ne démarre pas

| Variable | Où la trouver |
| --- | --- |
| `DATABASE_URL` | votre `.env` (chaîne Neon **pooled**, celle avec `-pooler`) |
| `JWT_SECRET` | votre `.env` (≥ 32 caractères) |
| `NODE_ENV` | à saisir : `production` |

> `NODE_ENV=production` active le cookie de session `Secure` et fait échouer le
> démarrage si `JWT_SECRET` est absent — c'est un garde-fou voulu.

> ⚠️ **N'ajoutez aucune intégration « base de données » de l'hébergeur**
> (Vercel Marketplace → Neon/Postgres, ni aucune autre). Une telle intégration
> provisionne une **nouvelle base vide** et injecte ses propres variables.
> L'application lit **uniquement** `DATABASE_URL` : c'est la seule façon de
> garantir qu'elle travaille sur **votre** base Neon, celle qui contient vos
> comptes, commerciaux, clients et ventes.

### Recommandées

| Variable | Valeur | Sans elle |
| --- | --- | --- |
| `APP_URL` | `https://kgroup-gilt.vercel.app/` (avec le `/` final) | les liens de réinitialisation pointent vers une URL devinée |
| `CRON_SECRET` | votre `.env` | les rappels d'anniversaire ne se déclenchent pas (l'endpoint renvoie 503) |

### Optionnelles

| Variable | Active |
| --- | --- |
| `RESEND_API_KEY`, `MAIL_FROM` | l'envoi réel des e-mails de réinitialisation |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | le bouton « Continuer avec Google » |

Pour Google, l'URI de redirection autorisée à déclarer dans Google Cloud est :
`https://kgroup-gilt.vercel.app/api/auth/google/callback`

> Après tout ajout ou modification de variable : **Deployments → ⋯ → Redeploy**.
> Une variable n'est prise en compte qu'au déploiement suivant.

---

## 3. Déployer

### Option A — Git + GitHub (redéploiement automatique, recommandé)

Chaque `git push` sur `main` redéploie la production ; chaque autre branche
obtient une URL d'aperçu.

```bash
git add .
git commit -m "..."
git push
```

> `.gitignore` exclut déjà `.env`, `dist/` et `node_modules/`.
> **Vérifiez avant de pousser** : `git status` ne doit montrer aucun `.env`.

### Option B — Vercel CLI (sans git)

```bash
npx vercel login          # ouvre le navigateur
npx vercel link           # rattache au projet existant
npx vercel                # aperçu, sur une URL temporaire
npx vercel --prod         # mise en production
```

Déployez d'abord **sans** `--prod` : vous obtenez une URL d'aperçu pour vérifier
avant de basculer le site public.

---

## 4. Vérifier

### En local, avant de déployer

```bash
npm install
npm test            # logique applicative (73 tests)
npm run db:check    # la base Neon a le schéma attendu
npm run db:smoke    # lecture / écriture / triggers sur la vraie base
npm run build       # le déploiement est cohérent
```

Parcours CRM complet contre la vraie base (le serveur doit tourner) :

```bash
# terminal 1
PORT=3010 npm start
# terminal 2
npm run e2e:crm
```

Les tests `db:smoke` et `e2e:crm` créent des comptes jetables et les suppriment
à la fin : ils sont sans risque sur une base contenant des données réelles.

### Après déploiement

```bash
# L'API répond et voit la base
curl https://kgroup-gilt.vercel.app/api/health
# attendu : {"ok":true,"database":"neon","connected":true}

# Vérification complète du site déployé
npm run verify -- https://kgroup-gilt.vercel.app
```

Puis, dans le navigateur :

1. `/login.html` s'affiche sans bandeau « Mode démo ».
   *(le bandeau signifie que l'API est injoignable — voir §7)*
2. Connectez-vous, enregistrez une vente avec un numéro de téléphone.
3. Le client apparaît dans **Clients**.
4. **Rémunération** affiche les commissions.

### Les rappels d'anniversaire

Vercel Cron appelle `/api/reminders/run` chaque jour à 07:00 UTC (clé `crons`
de `vercel.json`) en envoyant automatiquement `CRON_SECRET` dans l'en-tête
`Authorization`. Vérifiez dans **Settings → Cron Jobs** que la tâche est listée.

Pour un test immédiat :

```bash
curl -X POST https://kgroup-gilt.vercel.app/api/reminders/run \
  -H "x-cron-secret: VOTRE_CRON_SECRET"
```

---

## 5. Ajouter un second administrateur

Chaque inscription d'administrateur crée **sa propre équipe, vide** : l'inscription
est publique, donc un nouveau compte n'a jamais accès d'office à vos données.
Pour qu'un deuxième administrateur partage le même tableau de bord, les mêmes
commerciaux, ventes et clients :

1. La personne crée son compte administrateur sur le site (`register.html`).
2. Depuis votre poste (avec le `.env` de production), rattachez-la :

```bash
# aperçu : ne modifie rien
npm run team:join -- nouvel.admin@exemple.com admin.existant@exemple.com
# application
npm run team:join -- nouvel.admin@exemple.com admin.existant@exemple.com --apply
```

Le script refuse d'agir si l'équipe du nouveau compte contient déjà des données
(commerciaux, ventes…) : rien n'est jamais fusionné ni supprimé en silence.

## 6. Mettre à jour le schéma de la base

Quand une version ajoute une colonne (par exemple `sales.perfume_name`, le nom du
parfum vendu), appliquez le schéma **avant** de déployer le code qui s'en sert :

```bash
npm run db:migrate   # idempotent : sans effet sur ce qui existe déjà
npm run db:check
```

## 7. Si quelque chose ne marche pas

| Symptôme | Cause probable | Correctif |
| --- | --- | --- |
| Bandeau « Mode démo » sur la page de connexion | `/api/health` ne répond pas | Vérifiez `DATABASE_URL` dans les variables Vercel, puis **Redeploy** |
| `/api/health` renvoie 503 | La base est injoignable | Chaîne Neon incorrecte, ou projet Neon en veille — ouvrez la console Neon |
| `/api/health` répond, mais vos données ont disparu | L'application pointe vers une **autre** base Neon | Comparez l'hôte `ep-…` de `DATABASE_URL` (Vercel) avec celui de votre `.env` ; retirez toute intégration base de données de l'hébergeur |
| Erreur 500 sur `/api/health` | `JWT_SECRET` absent ou trop court | Ajoutez-le (≥ 32 caractères), puis redéployez |
| `/api/…` renvoie 404 | La fonction API n'est pas déployée | Vérifiez `api/index.js` et la clé `rewrites` de `vercel.json`, et le **Root Directory** |
| Le build échoue | Une vérification a sauté | Le log Vercel montre l'erreur exacte ; reproduisez avec `npm run build` en local |
| Les rappels ne partent pas | `CRON_SECRET` absent | Ajoutez la variable, puis redéployez |
| Déconnexion à chaque visite | `JWT_SECRET` change entre les déploiements | Définissez-le **une fois** dans Vercel et n'y touchez plus |

---

## 8. Règles à ne pas enfreindre

- **`.env` ne doit jamais être commité ni téléversé.** Il est dans `.gitignore`
  et `.vercelignore`, et `npm run lint` échoue si un secret apparaît dans un
  fichier suivi.
- **`DATABASE_URL` reste côté serveur.** Elle n'existe que dans les variables
  Vercel et dans la fonction `/api`. Le dossier `dist/` publié sur le CDN ne
  contient que du HTML, CSS, JS de page et des images — aucun code serveur.
- **Une seule base : celle de `DATABASE_URL`.** N'ajoutez pas d'intégration base
  de données de l'hébergeur ; elle créerait une seconde base, vide.
- **Ne changez pas `JWT_SECRET`** une fois en production : toutes les sessions
  actives seraient invalidées.
- **Un mois de paie clôturé ne se recalcule pas.** Modifier les paramètres de
  rémunération n'affecte que les mois en cours.
