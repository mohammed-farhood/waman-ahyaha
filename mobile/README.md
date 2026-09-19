# ومن أحياها: mobile app (iOS + Android)

A React Native (Expo SDK 57) app for the **same backend as the website**:
https://waman-ahyaha.srv1956050.hstgr.cloud. There's no separate server and no second database. A donor, collector
or admin logs in with the same phone number (and PIN) they use on the website.

To publish to the App Store and Google Play, follow **[SUBMISSION_GUIDE.md](SUBMISSION_GUIDE.md)**.

## What's in it

| Who | Screens |
|---|---|
| Everyone | Welcome (campaigns, totals), login (phone, plus PIN for staff), donor sign-up, "start a campaign" request, about + support message, privacy policy |
| Donor | Home: "my donation this month", streak, how to pay, campaign progress. The donation list (their row highlighted). News, collectors (call / WhatsApp / Telegram), orphans, campaign leaderboard, link Telegram, "donate anonymously" switch, delete account |
| Collector | Home: "my donors" progress, at-risk donors. Donation grid with a one-tap paid toggle, 5-second undo, and a Telegram receipt sent after the undo window. Add donor. Reminders by bot or WhatsApp. Post news (with photo). Pay reports (file / confirm). Availability hours |
| Admin | Everything above for the whole campaign: per-collector progress, collector filter, add collector, campaign Telegram bot, support inbox, orphans (add / edit / delete) |
| Superadmin | Campaign switcher on every screen, the platform's default Telegram bot, support inbox + new-campaign requests. Creating or wiping campaigns and backups stay on the website |

Arabic only, fully right-to-left (forced natively), Cairo font, light and dark mode, no emojis.

## Code map

```
src/app/            screens (expo-router: the file name is the route)
  (tabs)/           home · grid (donations) · news · collectors · profile
  welcome, login, register, start-campaign, about, orphans, leaderboard,
  inbox, telegram, bot-settings, delete-account
src/lib/api.ts      HTTP client: X-Client: mobile, Bearer token, single-flight refresh
src/lib/auth.tsx    session: login / register / logout / delete, tokens in the Keychain / Keystore
src/lib/queries.ts  every server call + the website's formulas (monthly stats, streak, at-risk)
src/lib/errors.ts   server error → Arabic (port of the website's js/errors.js; keep in sync)
src/components/     UI kit, sheets, toasts, brand mark
```

## Run it on your phone (development)

```bash
cd mobile
npm install
npx expo start          # scan the QR code with the Expo Go app
```

By default it talks to the live server. To use a backend on your Mac instead:
`EXPO_PUBLIC_API_URL=http://<your-mac-ip>:7860 npx expo start`.

## Checks before a release

```bash
npx tsc --noEmit                                  # types
npx expo export --platform ios --platform android # the real store bundles compile
npx expo-doctor                                   # Expo config / versions
```

`app.config.js` only chooses the platforms. `WEB_PREVIEW=1` adds a browser build, which is used solely for
automated screenshots of the screens. It never ships.
