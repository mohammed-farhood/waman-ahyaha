# ومن أحياها — publishing to the App Store and Google Play

The app in this folder (`mobile/`) is an Expo (React Native) app. It talks to the **same backend as the website**:
`https://waman-ahyaha.srv1956050.hstgr.cloud`. The server already supports it: mobile logins,
token refresh and in-app account deletion are live. You don't need to change anything on the server.

You need:

- **Apple:** an Apple Developer account (USD 99/year), https://developer.apple.com/programs/
- **Google:** a Google Play Console account (USD 25 one-off), https://play.google.com/console
- **Expo:** a free Expo account, https://expo.dev/signup. EAS builds the apps in the cloud, so your Mac
  doesn't need Xcode or Android Studio.

---

## 1. One-time setup (about 10 minutes)

```bash
cd mobile
npm install
npm install -g eas-cli
eas login                  # your Expo account
eas init                   # links this app to your Expo account (writes the projectId into app.json)
```

Identifiers, already set in `app.json` (change them **before the first upload** if you prefer others; they
can't be changed after publishing):

| | value |
|---|---|
| App name | ومن أحياها (English: Waman Ahyaha) |
| iOS bundle ID | `com.wamanahyaha.app` |
| Android package | `com.wamanahyaha.app` |

**App icon:** `assets/images/icon.png`, a white shield with a gold heart on the site's teal. To use a different
icon, replace that file (1024×1024 PNG, no transparency) and the three `android-icon-*.png` files, then rebuild.

## 2. Try it on your phone first

```bash
eas build --profile preview --platform android   # gives you an .apk link to install directly
eas build --profile preview --platform ios       # needs your iPhone registered: eas device:create
```

## 3. Build for the stores

```bash
eas build --profile production --platform all
```

EAS asks to create the signing certificates and keys. Answer **Yes** and let EAS manage them. The build
number goes up automatically on every build.

## 4. Upload

```bash
eas submit --platform ios       # uploads to App Store Connect (TestFlight first)
eas submit --platform android   # uploads to Play Console (internal testing track, as a draft)
```

The **first** Android upload must be done by hand in Play Console: Create app → Testing → Internal testing →
upload the `.aab` from the EAS build page. After that, `eas submit` works.

---

## 5. Store listing (copy-paste)

**Name:** ومن أحياها
**Subtitle (iOS, 30 characters max):** متابعة كفالة الأيتام الشهرية
**Category:** Lifestyle (iOS) / Social (Google). Pick "Education" if you prefer; don't use Finance, because
the app doesn't process payments.

**Short description (Google, 80 characters max):**
منصة شفافة لمتابعة التبرعات الشهرية لكفالة الأيتام في المجموعات الجامعية

**Description:**
> ﴿وَمَنْ أَحْيَاهَا فَكَأَنَّمَا أَحْيَا النَّاسَ جَمِيعًا﴾
>
> ومن أحياها منصة شفافة تساعد المجموعات الجامعية والفرق التطوعية على متابعة التبرعات الشهرية لكفالة الأيتام.
>
> • للمتبرع: تابع حالة تبرعك الشهري، وأبلغ جامع التبرعات بأنك دفعت، واطّلع على أخبار الحملة والأيتام المكفولين.
> • لجامع التبرعات: جدول واضح لكل متبرعيك وأشهرهم، علّم الدفع بلمسة، وأضف متبرعين جدد.
> • لمسؤول الحملة: إحصاءات الحملة، إدارة الجامعين والإعلانات والأيتام.
> • لوحة ترتيب تحفّز المنافسة الإيجابية بين المجموعات.
>
> التطبيق لا يستقبل أي مدفوعات؛ التبرعات تُسلَّم يدوياً لجامع التبرعات، والتطبيق للمتابعة والشفافية فقط.

**Keywords (iOS, 100 characters max):** كفالة,أيتام,تبرعات,خيري,تطوع,جامعة,صدقة,متابعة,حملة

**Support URL / Marketing URL:** https://waman-ahyaha.srv1956050.hstgr.cloud
**Privacy policy URL:** https://waman-ahyaha.srv1956050.hstgr.cloud/privacy.html

**Screenshots:** Apple needs 6.9" iPhone screenshots (1320×2868) and Google needs at least 2 phone
screenshots. The easiest way: install the preview build and take screenshots of the welcome page, the donor
home, the collector's grid and the leaderboard.

## 6. Answers for the review forms

**Apple, App Privacy ("nutrition label"):**

- Data collected: **Name**, **Phone number** (Contact Info) and **User ID**. Also **Photos**, but only when campaign
  staff attach a picture to an announcement. Each is *linked to the user* and used for *App Functionality* only.
  **Not** used for tracking.
- No advertising, no analytics SDKs, no location, no contacts. The app never reads the camera or microphone.

**Google, Data safety:**

- Collects: Name, Phone number (Personal info) and Photos (only staff announcement pictures) for App
  functionality. Data is encrypted in transit (HTTPS).
- Users can request deletion: **Yes**, in the app (Profile → حذف حسابي) and at
  https://waman-ahyaha.srv1956050.hstgr.cloud/privacy.html#delete
- Shared with third parties: No.

**Account deletion (both stores require it):** Profile → «حذف حسابي». This calls `DELETE /api/auth/me` and
anonymises the account immediately.

**Donations / payments (important for Apple guideline 3.2.1 and 3.1.1):** the app doesn't collect or
process money. Donors hand cash to their campaign's collector, and the app only records that it happened.
Say this in the review notes, below.

**Content rating:** Everyone / 4+. No user-generated public content: announcements come from campaign
admins only.

**App Review notes (Apple) / testing instructions (Google):** give the reviewer a demo login. Create a test
donor in your campaign (or a test collector with a PIN), then paste:

> This app lets university student groups track monthly orphan-sponsorship donations. It does not process
> payments; donations are handed over in person and only recorded in the app.
> Demo donor login: phone 07XXXXXXXXX (no PIN needed for donors).
> Demo collector login: phone 07XXXXXXXXX, PIN XXXX.

---

## 7. Updating the app later

- **Server-only changes** (most changes): deploy the website/backend as usual. The app picks them up
  automatically, because it has no copy of your data.
- **App changes:** bump `"version"` in `app.json` (e.g. 1.0.1), then `eas build --profile production --platform all`
  and `eas submit`.
