# Deploying FaciliTrack

| Part | Where | Config |
| --- | --- | --- |
| API (NestJS) | Render, web service | `render.yaml` |
| Coordinator dashboard (React) | Vercel | `web/vercel.json` |
| Database and photos | Supabase (already live) | nothing to do |
| Mobile app | Android APK | built with the API address |

## 1. API on Render

1. Render dashboard: **New > Blueprint**, connect the GitHub repo, pick branch `polished_system`.
2. Render reads `render.yaml` and asks for the secret values. Copy them from `backend/.env`:
   `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `FIREBASE_SERVICE_ACCOUNT_BASE64`.
   For `CORS_ORIGINS` put the Vercel address from step 2 (you can fill it in after step 2).
3. After the deploy, open `https://<your-service>.onrender.com/health`. It should show `{"ok":true}`.

The free plan sleeps after 15 minutes without traffic; the first request after that takes about a minute.

## 2. Dashboard on Vercel

1. Vercel: **Add New > Project**, import the repo, set **Root Directory** to `web`.
2. Environment variable `VITE_API_URL` = the Render address, e.g. `https://facilitrack-api.onrender.com` (no trailing slash).
3. Deploy, then put the Vercel address (e.g. `https://facilitrack.vercel.app`) into Render's `CORS_ORIGINS` and redeploy the API.

## 3. Mobile APK

```
cd mobile
flutter build apk --release --dart-define=API_URL=https://<your-service>.onrender.com
```

The APK is at `mobile/build/app/outputs/flutter-apk/app-release.apk`. Users can still change the
server address on the login screen (Server settings).

## Test accounts

The seeded accounts (`coordinator@test.com`, `student@test.com`, ...) use `password123`. That is
fine for a demo; change or remove them before real use.
