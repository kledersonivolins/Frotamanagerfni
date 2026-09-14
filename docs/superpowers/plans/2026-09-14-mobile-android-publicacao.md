# FrotaManager Mobile Android Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a tested, signed FrotaManager APK for direct installation and an AAB ready for Google Play internal testing and production review.

**Architecture:** Capacitor packages the locally installed React application as `br.com.ferronorte.frotamanager`. Android release builds use an external keystore configuration, preserve the SQLite database across upgrades, request only required permissions, and pass automated plus real-device offline tests before distribution.

**Tech Stack:** Capacitor 8.5.2, Android Gradle build, Java/Android SDK versions supported by the pinned Capacitor release, Play Console AAB workflow.

**Spec:** `docs/superpowers/specs/2026-09-14-aplicativo-movel-offline-design.md`

## Global Constraints

- Complete the foundation, Empréstimos, and Ordens de Serviço plans first.
- Package id is permanently `br.com.ferronorte.frotamanager`; visible name is `FrotaManager`.
- Release keys and passwords must never be committed.
- APK and AAB must be built from the same Git commit and version.
- Updating the app must preserve pending local operations and database migrations.
- First distribution is internal; Google Play uses an AAB.

---

## File Structure

- `apps/mobile/android/`: generated Capacitor Android project, then reviewed and versioned.
- `apps/mobile/resources/`: source icon and splash assets.
- `apps/mobile/scripts/verify-release.mjs`: artifact/version/security checks.
- `apps/mobile/docs/signing.example.properties`: non-secret signing template.
- `docs/mobile/privacy-policy.md`: factual data-use policy source.
- `docs/mobile/play-store-listing.md`: store text, permissions, and data declarations.
- `docs/mobile/release-checklist.md`: reproducible internal and production release procedure.

### Task 1: Add Android Platform and Required Native Permissions

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/android/` via Capacitor CLI
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`
- Create: `apps/mobile/scripts/verify-android-config.mjs`

**Interfaces:**
- Produces scripts `android:sync`, `android:debug`, `android:release`; Android application id `br.com.ferronorte.frotamanager`.

- [ ] **Step 1: Write configuration verification script**

```js
import fs from 'node:fs'
const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
if (!manifest.includes('android.permission.CAMERA')) throw new Error('CAMERA permission missing')
if (manifest.includes('ACCESS_FINE_LOCATION')) throw new Error('unexpected location permission')
```

- [ ] **Step 2: Run and verify failure**

Run: `cd apps/mobile; node scripts/verify-android-config.mjs`

Expected: FAIL because the Android project does not exist.

- [ ] **Step 3: Generate and configure Android**

Run: `cd apps/mobile; npx cap add android; npm run build; npx cap sync android`

Keep only Internet, network-state, camera, and media permissions required by implemented features. Do not request location, contacts, microphone, phone, or broad storage access.

- [ ] **Step 4: Verify config and debug build**

Run: `cd apps/mobile; node scripts/verify-android-config.mjs; cd android; .\gradlew.bat assembleDebug`

Expected: PASS and `app-debug.apk` exists.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/android apps/mobile/package.json apps/mobile/scripts/verify-android-config.mjs
git commit -m "build(mobile): adicionar plataforma Android"
```

### Task 2: Add Production Assets and Mobile Identity

**Files:**
- Create: `apps/mobile/resources/icon.png`
- Create: `apps/mobile/resources/splash.png`
- Modify: Android generated icon/splash resources using the Capacitor asset tool
- Create: `apps/mobile/src/app/version.ts`
- Create: `apps/mobile/src/app/version.test.ts`

**Interfaces:**
- Produces: `APP_ID`, `APP_NAME`, `APP_VERSION`, and matching Android versionName/versionCode.

- [ ] **Step 1: Write identity test**

```ts
it('uses the permanent production identity', () => {
  expect(APP_ID).toBe('br.com.ferronorte.frotamanager')
  expect(APP_NAME).toBe('FrotaManager')
  expect(APP_VERSION).toMatch(/^1\.0\.0$/)
})
```

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; npm test -- --run src/app/version.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add version and generated assets**

Set initial release to versionName `1.0.0` and versionCode `1`. Generate adaptive Android icons and splash screens from the approved FrotaManager source assets; verify transparent icon safe area and light/dark splash contrast.

- [ ] **Step 4: Verify**

Run: `cd apps/mobile; npm test -- --run src/app/version.test.ts; npm run build; npx cap sync android`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/mobile/resources apps/mobile/android apps/mobile/src/app/version*
git commit -m "feat(mobile): aplicar identidade visual Android"
```

### Task 3: Configure External Signing and Release Verification

**Files:**
- Create: `apps/mobile/docs/signing.example.properties`
- Modify: `apps/mobile/android/app/build.gradle`
- Modify: `.gitignore`
- Create: `apps/mobile/scripts/verify-release.mjs`

**Interfaces:**
- Consumes external `FROTAMANAGER_SIGNING_FILE`, `FROTAMANAGER_SIGNING_PASSWORD`, `FROTAMANAGER_KEY_ALIAS`, `FROTAMANAGER_KEY_PASSWORD`.
- Produces signed APK and AAB.

- [ ] **Step 1: Write artifact verifier**

The script must fail when artifacts are missing, versionName/versionCode differ, package id differs, a signing property is committed, or source maps/secrets are bundled.

```js
for (const path of ['android/app/build/outputs/apk/release/app-release.apk',
                    'android/app/build/outputs/bundle/release/app-release.aab']) {
  if (!fs.existsSync(path)) throw new Error(`missing release artifact: ${path}`)
}
```

- [ ] **Step 2: Verify failure before release build**

Run: `cd apps/mobile; node scripts/verify-release.mjs`

Expected: FAIL because release artifacts do not exist.

- [ ] **Step 3: Configure signing without secrets in Git**

Read signing values only from environment variables or an ignored local properties file. Add keystore extensions and local signing properties to `.gitignore`. Generate the production upload key outside the repository and store a protected backup.

- [ ] **Step 4: Build and verify both artifacts**

Run: `cd apps/mobile; npm ci; npm test -- --run; npm run build; npx cap sync android; cd android; .\gradlew.bat clean assembleRelease bundleRelease; cd ..; node scripts/verify-release.mjs`

Expected: PASS with signed APK and AAB from the same version.

- [ ] **Step 5: Commit non-secret configuration**

```powershell
git add .gitignore apps/mobile/android/app/build.gradle apps/mobile/docs/signing.example.properties apps/mobile/scripts/verify-release.mjs
git commit -m "build(mobile): configurar assinatura de release"
```

### Task 4: Verify Upgrade, Offline Survival, and Real Devices

**Files:**
- Create: `apps/mobile/e2e/android-upgrade-offline.md`
- Create: `docs/mobile/device-test-results.md`

**Interfaces:**
- Verifies installed APK, update APK, SQLite migration, queue durability, camera, QR, and reconnect sync.

- [ ] **Step 1: Install debug/release candidate and seed pending operations**

Use at least one Android phone and one tablet. Login online, download scope, create one provisional loan, one OS timing entry, and one photo while offline.

- [ ] **Step 2: Force-stop, reboot, and upgrade without uninstalling**

Run: `adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

Expected: application data remains; all pending items reappear.

- [ ] **Step 3: Reconnect and validate central state**

Expected: operations synchronize exactly once; photo links to the correct entity; no cross-company record appears; pending counter becomes zero.

- [ ] **Step 4: Record exact evidence**

In `docs/mobile/device-test-results.md`, record model, Android version, app version, each scenario result, server record ids, and any corrected defect commit.

- [ ] **Step 5: Commit evidence**

```powershell
git add apps/mobile/e2e/android-upgrade-offline.md docs/mobile/device-test-results.md
git commit -m "test(mobile): validar APK offline em aparelhos"
```

### Task 5: Prepare Privacy, Store Listing, and Release Procedure

**Files:**
- Create: `docs/mobile/privacy-policy.md`
- Create: `docs/mobile/play-store-listing.md`
- Create: `docs/mobile/release-checklist.md`

**Interfaces:**
- Produces factual privacy policy source, store copy, Data Safety answers, tester process, and release checklist.

- [ ] **Step 1: Add a failing documentation validator**

Extend `verify-release.mjs` to require headings for collected data, purpose, retention, deletion contact, camera use, authentication, encryption, internal testing, version, and Git commit.

- [ ] **Step 2: Verify failure**

Run: `cd apps/mobile; node scripts/verify-release.mjs`

Expected: FAIL listing missing release documents.

- [ ] **Step 3: Write factual documents from implemented behavior**

State only data actually processed: identity, company/sector scope, vehicle/driver, OS/loan entries, timestamps, QR identifiers, photos, signatures, device id, sync/audit metadata. Explain camera purpose, local encrypted storage, seven-day offline authorization, retention source, and the administrator contact/process for access or deletion requests.

- [ ] **Step 4: Verify documentation and artifacts**

Run: `cd apps/mobile; node scripts/verify-release.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add docs/mobile apps/mobile/scripts/verify-release.mjs
git commit -m "docs(mobile): preparar publicacao na Google Play"
```

### Task 6: Internal Distribution and Production Handoff

**Files:**
- Modify: `docs/mobile/release-checklist.md`
- Create: `docs/mobile/releases/1.0.0.md`

**Interfaces:**
- Produces release record with checksums, Git commit, Play track, tester results, and approval state.

- [ ] **Step 1: Calculate artifact checksums and bind them to Git**

Run: `Get-FileHash apps/mobile/android/app/build/outputs/apk/release/app-release.apk -Algorithm SHA256`

Run: `Get-FileHash apps/mobile/android/app/build/outputs/bundle/release/app-release.aab -Algorithm SHA256`

Record both hashes and `git rev-parse HEAD` in `docs/mobile/releases/1.0.0.md`.

- [ ] **Step 2: Distribute APK to the controlled test group**

Use the signed direct APK and record install/upgrade results. Do not publish broadly until the device matrix and offline scenarios pass.

- [ ] **Step 3: Upload AAB to Play Console internal testing**

Confirm package id before upload because it becomes fixed. Complete app access instructions, Data Safety, privacy policy URL, content rating, target audience, screenshots, and tester list.

- [ ] **Step 4: Promote only after internal/closed acceptance**

Verify crash reports, sync conflicts, permission denials, and feedback. Follow the testing requirements shown for the actual developer-account type before requesting production review.

- [ ] **Step 5: Commit the release record**

```powershell
git add docs/mobile/release-checklist.md docs/mobile/releases/1.0.0.md
git commit -m "chore(mobile): registrar release Android 1.0.0"
```

