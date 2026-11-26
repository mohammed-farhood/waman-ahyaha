# Brief for the agent: publish «ومن أحياها» (Waman Ahyaha) to the Apple App Store

You are working for **Eyad** (T++ co-founder). Mohammed (T++ founder) built this app and owns the code and
the server. Your job is to get the **iOS app** from this repository onto **TestFlight** and then submitted to
**App Store review**. Android is out of scope unless Eyad asks for it.

Read this whole brief before running anything. When something here conflicts with what you find in the repo,
trust the repo and tell Eyad what differed.

---

## 1. What the app is

- **Name:** ومن أحياها (English: Waman Ahyaha). It is named after a Quran verse
  ﴿وَمَنْ أَحْيَاهَا فَكَأَنَّمَا أَحْيَا النَّاسَ جَمِيعًا﴾.
- **What it does:** university student groups use it to keep track of monthly **orphan-sponsorship donations**.
  It **does not take payments**. Donors hand cash to their group's collector in person, and the app only
  records that it happened (transparency and follow-up).
- **Roles:** donor (logs in with phone number only, no PIN, by design), collector (phone + PIN), campaign
  admin, and superadmin. Superadmin-only platform tools (creating or wiping campaigns, backups) are
  intentionally **website-only** and are not in the app.
- **Language:** Arabic, forced right-to-left. Font: Cairo. Digits are always Western (0-9).
- **Never** call this project "Al-Ayn", "AL-AYN" or "العين". That is a different NGO's name, and its old name
  may still appear in old git history. Don't bring it back anywhere.

## 2. Where everything is

| Thing | Value |
|---|---|
| GitHub repo | https://github.com/mohammed-farhood/waman-ahyaha (**public**). Eyad (`eyad6789`) has write access: accept the invite at https://github.com/mohammed-farhood/waman-ahyaha/invitations |
| Branch to use | **`mobile-app`**. This is the only branch with the app. `main` is the website and has no `mobile/` folder |
| App folder | `mobile/` |
| Backend (already live, shared with the website) | **https://waman-ahyaha.tech** |
| Privacy policy URL | https://waman-ahyaha.tech/privacy.html |
| Account-deletion page | https://waman-ahyaha.tech/privacy.html#delete |
| Full store guide (listing text, privacy answers, review notes) | `mobile/SUBMISSION_GUIDE.md`, the source for everything you paste into App Store Connect |
| Expo rule for this app | `mobile/AGENTS.md`: Expo changed a lot, so read the v57 docs (https://docs.expo.dev/versions/v57.0.0/) before writing code |

**Because the repo is public,** never commit secrets, real phone numbers, PINs, Apple credentials, `.p8` keys
or demo-account logins. Keep them in EAS / App Store Connect, or tell Eyad directly.

## 3. Technical facts you need

- **Expo SDK 57**, React Native 0.86, `expo-router` (tabs from `expo-router/js-tabs`, `Stack.Protected` route
  guards), React Query, TypeScript.
- Identifiers, already set in `mobile/app.json`. **Don't change them** unless Eyad and Mohammed agree, because
  they're permanent after the first upload:
  - iOS bundle ID: **`com.wamanahyaha.app`**
  - Android package: `com.wamanahyaha.app`
  - Version: **`1.0.0`**. Build numbers are handled by EAS (`"appVersionSource": "remote"`,
    `"autoIncrement": true` in `eas.json`).
- **Backend address:** `EXPO_PUBLIC_API_URL=https://waman-ahyaha.tech`. It's set in `eas.json` (preview and
  production), with a fallback in `app.json` → `extra.apiUrl` and in `src/lib/api.ts`. All of them must stay
  on `waman-ahyaha.tech`. If you ever see `srv1956050.hstgr.cloud` or `t-plusplus.tech`, those are **dead old
  addresses**: stop and report.
- **Auth:** the app sends `X-Client: mobile`. The server answers with tokens in the body, and the app uses
  `Authorization: Bearer`. The refresh token **rotates**, so refresh is single-flight on purpose (two parallel
  refreshes would log the user out). Don't "simplify" that.
- **No server work is needed.** Mobile login, token refresh and in-app account deletion (`DELETE /api/auth/me`)
  are already live. You have no access to the server, and you don't need it.

## 4. Before you build: check that it's healthy

```bash
git clone https://github.com/mohammed-farhood/waman-ahyaha.git
cd waman-ahyaha
git checkout mobile-app
cd mobile
npm ci                      # use the lockfile; don't upgrade packages
npm run check               # typecheck + iOS/Android export + expo-doctor
curl -s https://waman-ahyaha.tech/health   # expect {"status":"ok",...}
```

If `npm run check` fails, fix only what is needed to build, explain the fix to Eyad, and don't upgrade the
Expo SDK or refactor anything. If `/health` doesn't answer, the backend is down. Report it to Eyad (Mohammed
must fix it) and don't change the app's backend address.

## 5. Accounts (ask Eyad; don't guess)

1. **Apple Developer Program** (USD 99/year). Confirm with Eyad **whose account** publishes the app, because
   the seller name shown in the App Store comes from it. If the account is new, enrollment can take 1–2 days.
2. **Expo account** (free) for EAS cloud builds. No Xcode is needed on the Mac.
3. For automatic uploads, an **App Store Connect API key** is easiest (`eas submit` will offer to create or use
   one). Otherwise, Apple ID login with 2FA works interactively.

## 6. Build and upload

```bash
npm install -g eas-cli
eas login                              # Eyad's Expo account
eas init                               # links the project; writes extra.eas.projectId (and maybe "owner") into app.json
git add app.json && git commit -m "Link Expo project for iOS release" && git push origin mobile-app

eas build --platform ios --profile production
#   - Sign in with the Apple account Eyad chose
#   - Let EAS create and manage the distribution certificate + provisioning profile: answer Yes
#   - It registers the bundle ID com.wamanahyaha.app if it doesn't exist yet

eas submit --platform ios --latest     # uploads to App Store Connect → appears in TestFlight after processing
```

Optional, before the production build: a preview build installed on Eyad's own iPhone (`eas device:create`,
then `eas build -p ios --profile preview`) to see it running.

**After the upload:** add Eyad and Mohammed as TestFlight internal testers, and let them try it before you
submit for review. Specifically check: login as a donor and as a collector, the Arabic text isn't clipped in
the bottom tab bar or the buttons, right-to-left layout is correct, and Profile → «حذف حسابي» (delete account)
is there.

## 7. App Store Connect listing and review

Take **all text from `mobile/SUBMISSION_GUIDE.md`, sections 5–6**: name, subtitle, description, keywords,
category (Lifestyle, **not** Finance), support/marketing/privacy URLs, App Privacy answers, age rating 4+.

Points Apple reviewers commonly reject apps over, and how this app already answers them:

- **Payments (guidelines 3.1.1 / 3.2.1):** say clearly in the review notes that the app collects and
  processes **no money**, and that donations are handed over in person and only recorded. Don't describe it
  as a fundraising or payment app.
- **Account deletion (5.1.1(v)):** in-app, Profile → «حذف حسابي». Mention it in the notes.
- **Login needed to review:** reviewers need a **demo donor** (phone only) and a **demo collector** (phone +
  PIN) in a test campaign. **Mohammed creates these**, so ask Eyad to get them from him. Put the logins only in
  App Store Connect's "Sign-in information" field, never in git.
- **Screenshots:** 6.9" iPhone (1320×2868). Take them from the TestFlight build: the welcome screen, the donor
  home, the collector's grid, the leaderboard. Use the demo campaign, not real donors' names or phones.

Then **Submit for Review** only after Eyad says the TestFlight build is good.

## 8. Rules while working

- Push only to **`mobile-app`**. Never push to `main`, never force-push, never rewrite history.
- Keep changes minimal: this is a release task, not a refactor. No dependency upgrades, no redesign, and no
  backend-address changes.
- Don't add analytics, ads, tracking or crash SDKs: the privacy answers say there are none.
- If you change any app code, keep `src/lib/errors.ts` consistent with the website's `js/errors.js`, and put
  new server calls in `src/lib/queries.ts`.
- Anything client-facing (store text, review notes) must not mention Claude, AI or any tool names.

## 9. Report back to Eyad (to forward to Mohammed)

When done, give: the TestFlight build number, the App Store Connect app link, which Apple account it's under,
the commit(s) you pushed to `mobile-app`, the review status, and anything still open (for example demo
accounts or screenshots).
