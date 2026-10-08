# Bookends Maintenance — Android app (Flutter)

The phone version of the web app: the worker app (Home · My tasks · Scan · Alerts · More)
and the admin app (Dashboard · Work orders · Requests · Assets · Menu). It talks to the same
API (`apps/server`), so logins, passwords and data are the same as on the web.

## Build the APK

```bash
cd apps/mobile
flutter pub get
flutter build apk --release     # → build/app/outputs/flutter-apk/app-release.apk
```

## Server address

The app's default server is set in `lib/core/session.dart` (`kDefaultServer`). It can be
changed on the sign-in screen under **Server address**:

- same Wi-Fi as the PC running `npm run dev`: `http://<PC IP>:4000`
  (Windows Firewall must allow inbound TCP 4000)
- deployed: the Vercel URL, e.g. `https://your-app.vercel.app`

## Tests

```bash
flutter analyze
flutter test                                    # unit tests (API tests are skipped)
# Against a running API on a copy of the demo database:
flutter test test/api_contract_test.dart --dart-define=API_TEST_URL=http://localhost:4101
flutter test test/ui_smoke_test.dart --dart-define=API_TEST_URL=http://localhost:4101 --update-goldens
```

The API allows 20 sign-ins per 15 minutes per IP; restart the test API between full runs.
