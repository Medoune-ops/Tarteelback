# Tarteel API — Contract for the React Native front

Base URL (dev): `http://localhost:4000`
Interactive docs (OpenAPI/Swagger): `http://localhost:4000/docs`

---

## 1. Conventions

### Auth headers
Authenticated requests send the **access token**:
```
Authorization: Bearer <accessToken>
```

### Error envelope
Every error has the same shape — switch on `error.code`:
```json
{ "error": { "code": "OUT_OF_HEARTS", "message": "…", "details": {} } }
```

| code | HTTP | Meaning / front action |
|------|------|------------------------|
| `VALIDATION_ERROR` | 400 | Bad input (`details` = zod flatten) |
| `UNAUTHENTICATED` | 401 | Missing/invalid access token → try `/auth/refresh` |
| `TOKEN_EXPIRED` | 401 | Access token expired → `/auth/refresh` then retry |
| `TOKEN_REVOKED` | 401 | Session revoked → send user to login |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `FORBIDDEN` | 403 | Not allowed (e.g. non-admin) |
| `OUT_OF_HEARTS` | 403 | Free user at 0 hearts → show "Plus de cœurs" + premium CTA |
| `NOT_FOUND` | 404 | Unknown resource |
| `EMAIL_TAKEN` | 409 | Registration email already used |
| `NO_STREAK_TO_REPAIR` | 409 | Nothing to repair |
| `ALREADY_PREMIUM` | 409 | — |
| `PAYMENT_FAILED` | 402 | Payment declined |
| `RATE_LIMITED` | 429 | Slow down |
| `SERVICE_UNAVAILABLE` | 503 | DB/dependency down → retry with backoff |
| `INTERNAL` | 500 | Server error |

---

## 2. Persistent session (the key auth flow)

1. **Register/login** → store `accessToken` in memory and `refreshToken` in
   **SecureStore** (`expo-secure-store`). Send a stable `deviceId`
   (e.g. `expo-application` `getAndroidId()` / `getIosIdForVendorAsync()`, or a
   generated UUID persisted in SecureStore).
2. **On app start**, if a refresh token exists → `POST /auth/refresh` →
   silent re-login (new access + rotated refresh; store the new refresh).
   → user stays logged in indefinitely.
3. **Access token expired mid-session** (401 `TOKEN_EXPIRED`) → call
   `/auth/refresh`, retry the original request once.
4. **Logout** → `POST /auth/logout { refreshToken }` then clear SecureStore.
5. **New install** = no refresh token → user must log in. (Nothing to do; the
   absence of a token is the signal.)

```
POST /auth/register { email, password, displayName, deviceId, timezone?, language? }
POST /auth/login    { email, password, deviceId }
POST /auth/refresh  { refreshToken, deviceId }
POST /auth/logout   { refreshToken }            # or { allDevices:true } (authed)
GET  /auth/sessions                              # authed: list active devices
```
Auth response (register/login/refresh):
```json
{
  "user": { /* see GET /me */ },
  "accessToken": "…",
  "refreshToken": "…",
  "refreshExpiresAt": "2026-09-25T…Z"
}
```

---

## 3. Current user — replaces `store/userStore.ts`

```
GET   /me
PATCH /me { displayName?, level?, objectif?, dailyMinutes?, onboardingDone?, timezone?, language? }
POST  /me/hearts/sync       # recompute regen, returns hearts block
POST  /me/streak/refresh    # recompute freeze/break, returns streak block
```
`GET /me` →
```json
{ "user": {
  "id": "…", "email": "…", "displayName": "Yasmine A.", "avatarInitials": "YA", "role": "user",
  "level": "debutant", "objectif": "hifz", "dailyMinutes": 10, "onboardingDone": true,
  "timezone": "Africa/Dakar", "language": "fr",
  "isPremium": false, "premiumUntil": null,
  "xp": 1240, "weeklyXp": 1250,
  "hearts": { "count": 5, "max": 5, "unlimited": false, "outOfHearts": false, "msUntilNextHeart": 0 },
  "streak": 15, "streakFrozen": false, "lastStreakValue": 15,
  "streakGoal": 30, "dailyChestAvailable": true
}}
```
> Store mapping: `hearts.count` → `hearts`, `hearts.msUntilNextHeart` →
> `msUntilNextHeart()`, `hearts.unlimited` covers premium. **The client never
> writes hearts directly** — it only reads. Heart loss happens on
> `.../answer`; regen is recomputed on `/me` and `/me/hearts/sync`.

---

## 4. Parcours — replaces `constants/parcours.ts` (`PARCOURS_SECTIONS`)

```
GET /sections                       # personalised node states when authed
GET /sections/:id/lessons
```
`GET /sections` → `{ "sections": ParcoursSection[] }`, where each section is the
**exact mirror shape** the front already uses:
```ts
{ id, ordre, hizb, kicker, titre, sousTitre, couleur,
  degrade: [start, end], headerIcon,
  sourates: [{ numero, nom, nomArabe, nombreVersets }],
  nodes:   [{ id, lessonId, label?, icon, align, state }] }
```
`state` is `locked | active | completed`, derived from the user's progress
(send the auth header to get real states; anonymous = all locked/first active).

> Drop-in: replace the `PARCOURS_SECTIONS` import with
> `const { sections } = await api.get('/sections')`.

---

## 5. Lesson engine — replaces `constants/lessonEngine.ts` (`buildSampleLesson()`)

```
GET  /lessons/:id
POST /lessons/:id/steps/:stepId/answer
POST /lessons/:id/complete
```
`GET /lessons/:id` → `{ "lesson": { id, titre, steps: LessonStep[] } }`.
Steps are the same union as the front (`discovery | written | voice`).
**The correct answer (`bonneReponse`) is NOT sent** — judging is server-side.

`POST .../steps/:stepId/answer`
- written: `{ "optionId": "A" }`
- voice:   `{ "score": 82, "transcription"?: "…" }` (lenient ≥ `seuilReussite`)
- discovery: `{}` (always correct, no heart at stake)

→
```json
{ "correct": true, "bonneReponse": "A", "heartsLeft": 4, "outOfHearts": false,
  "unlimited": false, "msUntilNextHeart": 14399000 }
```
`bonneReponse` (the correct option id) is included for `written` steps **after**
answering, so the UI can highlight the right choice in green — it is never sent
by `GET /lessons/:id`. On a wrong test answer for a free user, a heart is
deducted. At 0 hearts the next call returns **403 `OUT_OF_HEARTS`**.

`POST /lessons/:id/complete` (optionally `{ correctCount, totalTests }` for the
score) →
```json
{ "xpGained": 40, "alreadyCompleted": false, "totalXp": 1280, "weeklyXp": 1290,
  "streak": 16, "streakFrozen": false, "premium": true }
```
XP follows the front's barème: **`15 + correctCount × 2`** (server caps
`correctCount` to the lesson's number of test steps), **doubled** for premium.
Completion also bumps the streak (once per local day) and feeds the league
ranking. Send `{ correctCount, totalTests }` for the exact XP/score.
**Idempotent:** replaying `complete` on an already-finished lesson returns
`xpGained: 0` and `alreadyCompleted: true` and changes nothing (no XP/streak
farming). Note: `voice` steps never deduct a heart (the recognition score is
produced on-device and not trusted server-side).

---

## 6. Quran content (multilingual)

```
GET /sourates
GET /sourates/:id/versets?lang=fr        # :id = cuid OR surah number (1–114)
```
`?lang` (or `Accept-Language`) selects the meaning shown under each verse,
falling back to `DEFAULT_LANG`. →
```json
{ "sourate": { "numero": 112, "nom": "Al-Ikhlas", "nomArabe": "الإخلاص", "hizb": 60, … },
  "lang": "fr",
  "versets": [{
    "numero": 1, "texteArabe": "قُلْ هُوَ ٱللَّهُ أَحَدٌ", "audioUrl": "https://…",
    "traduction": { "texte": "Dis: «Il est Allah, Unique»", "langue": "fr", "source": "quran.com#136" },
    "translitteration": { "texte": "Qul huwa Allāhu aḥad", "langue": "la", "source": "quran.com#57" }
  }]}
}
```

---

## 7. Leagues — replaces the mock in `(tabs)/ligues.tsx`

```
POST /leagues/join
GET  /leagues/me
GET  /leagues          # league tiers
```
`GET /leagues/me` →
```json
{ "joined": true,
  "league": { "id":"…", "nom":"Or", "niveau":3 },
  "semaine": 23, "participants": 30, "msUntilEnd": 295200000, "myRank": 4,
  "podium": [ { "rang":1,"name":"Idriss M.","initials":"IM","weeklyXp":1620,"me":false,"promotion":true }, … ],
  "around": [ { "rang":4,"name":"Yasmine A.","weeklyXp":1250,"me":true, … }, … ],
  "promotionZone": 3, "relegationZone": 5 }
```
"Real-time": poll `GET /leagues/me` (pull-to-refresh / on focus). Ranking is
recomputed on every XP gain.

---

## 7b. Notifications push

The app registers its Expo push token after login and manages preferences.

```
POST   /me/notifications/tokens      { token, deviceId, platform? }   # register/refresh
DELETE /me/notifications/tokens      { token }                        # on logout
GET    /me/notifications/preferences
PATCH  /me/notifications/preferences { notifDailyReminder?, notifStreakAlert?, reminderHour? }
```

- `token` = Expo push token (`ExponentPushToken[…]`), obtained client-side via
  `expo-notifications` (`getExpoPushTokenAsync`). Register it on login and after
  any token refresh; delete it on logout.
- `reminderHour` (0–23) = preferred local hour for the daily reminder.
- The server sends two kinds of notification via the Expo Push API (run by the
  `jobs:reminders` job, hourly): a **daily learning reminder** (if you haven't
  practised today, at your preferred local hour) and a **streak alert** (when
  your streak is frozen / about to break). Both are timezone-aware and sent at
  most once per local day. Invalid tokens are auto-disabled.
- The daily reminder uses a fixed library of **spiritual/heartfelt messages**
  (`reminderMessages.ts`), one picked at random per send (verbatim, never edited),
  so reminders don't feel repetitive. The notification `data` carries
  `{ type: 'daily_reminder' }` / `{ type: 'streak_alert', streak }`.

> Note: in-app feedback **sounds & animations** (the "ding"/confetti when you
> answer correctly) are played by the app itself — they are not push
> notifications and are not handled by the backend.

## 7c. Récompenses — `streak-goal.tsx`, `podiums.tsx`, coffre quotidien

All server-authoritative (XP/hearts credited by the server, ×2 premium for XP).

```
PUT  /me/streak-goal            { days }                 # set/replace the goal
POST /me/streak-goal/claim                               # claim if streak >= goal
GET  /me/podiums                                         # top-3 history
POST /me/podiums/:ref/claim                              # claim once
GET  /me/daily-chest                                     # { available: bool }
POST /me/daily-chest/claim                               # open (1/local day)
```

- `streak-goal/claim` → `{ xpGained, totalXp, streakGoal: null }` (clears the
  goal). XP barème = front's `streakReward(days)` (7d→100 … 365d→10000).
  Returns 409 if the goal isn't reached.
- `GET /me/podiums` → `{ podiums: [{ id, semaine, ligue, rang, xp, reward, claimed }] }`.
  `podiums/:ref/claim` → `{ xpGained, totalXp }`; reward = 500/300/150 for rank
  1/2/3; 409 if already claimed, 404 if not yours. Podium rows are created by the
  weekly league rollover for top-3 finishers.
- `daily-chest/claim` → `{ reward: { type:"xp"|"hearts", amount }, totalXp, hearts }`.
  One open per local day; 409 otherwise. The reward is rolled server-side.

> Maps to the front store: `setStreakGoal`/`claimStreakReward`,
> `claimPodiumReward`/`isPodiumClaimed`, `canClaimDailyChest`/`claimDailyChest`.
> The store no longer needs to compute reward amounts — the server is the source
> of truth (anti-cheat).

## 8. Billing (mock) — `subscription.tsx`

```
POST /billing/subscribe { plan: "mensuel" | "annuel" }
GET  /billing/status
POST /billing/repair-streak
```
`subscribe` → `{ isPremium:true, premiumUntil, plan, providerRef }`.
`repair-streak` → `{ streak, providerRef }` (restores `lastStreakValue`).

> Replace `subscription.tsx`'s `setPremium(true)` with a call to
> `POST /billing/subscribe`, then refresh `GET /me`.

---

## 9. Suggested RN API client sketch

```ts
// api.ts
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };

async function request(path: string, init: RequestInit = {}, retry = true) {
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && retry) {
    const ok = await tryRefresh();        // POST /auth/refresh with SecureStore token
    if (ok) return request(path, init, false);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw body?.error ?? { code: 'INTERNAL' };
  return body;
}
```
