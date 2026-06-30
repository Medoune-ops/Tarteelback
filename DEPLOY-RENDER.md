# Déployer Tarteel sur Render

Guide complet, expliqué pour comprendre ce qui se passe à chaque étape.

## Le modèle mental

```
Ton repo Git  ──push──▶  Render
                           │
                           ├─ tarteel-postgres   ← TES DONNÉES vivent ici (permanent)
                           ├─ tarteel-redis      ← cache (jetable)
                           └─ tarteel-api        ← ton code (rebuild à chaque push)
```

- **Les tables** sont créées par les *migrations* Prisma (`prisma/migrations/`).
- **Le contenu du Coran** est ajouté par un *seed* que tu lances une seule fois.
- **Les utilisateurs** se créent tout seuls quand les gens utilisent l'app.

---

## Étape 1 — Pousser le code sur GitHub

Render déploie depuis un repo Git. Assure-toi que `render.yaml` est commité et poussé.

```bash
git add render.yaml DEPLOY-RENDER.md
git commit -m "chore: configuration de déploiement Render"
git push
```

## Étape 2 — Créer le Blueprint sur Render

1. Va sur https://dashboard.render.com → **New +** → **Blueprint**.
2. Connecte ton repo GitHub `Tarteelback`.
3. Render lit `render.yaml` et te montre les 3 services (postgres, redis, api).
4. Clique **Apply**. Render crée la base, le cache, et lance le premier build.

Au premier déploiement, dans l'ordre, Render va :
- créer la base PostgreSQL (vide),
- builder l'API (`npm ci`, `prisma generate`, `npm run build`),
- lancer `prisma migrate deploy` → **crée toutes tes tables** (encore vides),
- démarrer l'API (`npm start`).

À ce stade : l'API tourne, les gens peuvent créer des comptes, MAIS le contenu
du Coran n'existe pas encore (tables `Sourate`/`Verset` vides).

## Étape 3 — Vérifier que l'API répond

L'URL est du type `https://tarteel-api.onrender.com`. Teste :

```
https://tarteel-api.onrender.com/health
```

(Le free plan "s'endort" après inactivité ; la 1re requête peut prendre ~30s.)

## Étape 4 — Remplir le contenu du Coran (UNE SEULE FOIS)

C'est l'étape qui te manquait à comprendre. Les tables existent mais sont vides.
On lance le script d'import depuis le terminal intégré de Render :

1. Dashboard Render → service **tarteel-api** → onglet **Shell**.
2. Lance :
   ```bash
   npm run seed        # données de base (sections, leçons de démo)
   npm run seed:quran  # importe sourates + versets + traductions depuis quran.com
   ```
3. Attends la fin (quelques minutes pour les 114 sourates).

> Astuce dev : pour un import rapide (Juz Amma seulement), définis la variable
> `QURAN_IMPORT_LIMIT=37` avant de lancer, puis relance plus tard sans limite.

**À refaire à chaque déploiement ?** NON. Le contenu reste dans Postgres pour
toujours. Tu ne relances le seed que si tu veux ajouter/réimporter du contenu.

## Étape 5 — Les jobs planifiés (ligues, rappels)

Ton app a des tâches récurrentes (`jobs:rollover` = clôture hebdo des ligues,
`jobs:reminders` = notifications). Sur Render, crée des **Cron Jobs** :

| Job | Commande | Fréquence suggérée |
|-----|----------|--------------------|
| Rollover ligues | `npm run jobs:rollover` | hebdomadaire (ex: lundi 00h05) |
| Rappels quotidiens | `npm run jobs:reminders` | toutes les heures |

Dashboard → **New +** → **Cron Job**, même repo, mêmes variables d'env que l'API.

---

## Manipuler tes données de prod (3 façons)

### A. Prisma Studio depuis ta machine (le plus pratique)
1. Dashboard Render → base **tarteel-postgres** → copie l'**External Database URL**.
2. Dans un terminal local, à la racine du projet :
   ```bash
   # PowerShell
   $env:DATABASE_URL="<colle l'External URL ici>"; npx prisma studio
   ```
   ```bash
   # Git Bash
   DATABASE_URL="<colle l'External URL ici>" npx prisma studio
   ```
3. Ouvre http://localhost:5555 → tu vois/édites les vraies données de prod.

> ⚠️ C'est la VRAIE base de prod. Une suppression ici est définitive.

### B. Console SQL web
Dashboard → base **tarteel-postgres** → bouton **Connect** → PSQL.

### C. Via l'API
Ton code utilise déjà Prisma Client — c'est l'accès normal de l'application.

---

## Pièges à connaître

- **CORS** : `CORS_ORIGINS=*` est interdit en prod (le serveur refuse de booter).
  Mets ton vrai domaine web dans le dashboard. (Déjà géré dans `render.yaml`.)
- **Secrets JWT** : générés automatiquement par Render. Ne les remplace pas par
  des valeurs contenant "secret"/"example" (le boot échouerait).
- **Free plan Postgres** : expire après 30 jours. Pour une vraie prod, passe
  au plan payant (`plan: basic` dans `render.yaml`) AVANT l'expiration, sinon
  la base (et donc tes données) est supprimée.
- **Sommeil du free web** : le service s'endort après ~15 min d'inactivité.
