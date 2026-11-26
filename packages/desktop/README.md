# Kothar desktop app

`npm run package` (from the repo root) builds `packages/desktop/release/Kothar-<version>-arm64.dmg` for Apple Silicon.
The first line it prints says how the build is signed:

- `Kothar will be UNSIGNED …`: no Developer ID certificate was found. The app gets an ad-hoc signature, which runs on the
  Mac that built it; other Macs block it until it's opened with right-click → Open.
- `Kothar will be signed with "Developer ID Application: …" and notarized with the notarytool profile "kothar-notary".`:
  the release build. Any Mac opens it without a warning.

`scripts/signing.ts` makes the decision, and its header lists every variable it reads. `KOTHAR_UNSIGNED=1` forces an
unsigned build.

## Signing and notarizing: one-time setup

You need an Apple Developer Program membership that Apple has approved (developer.apple.com/account shows your
membership). Each step below is done once per Mac.

### 1. Create a Developer ID Application certificate

The easy way is **Xcode → Settings → Accounts**. Add your Apple ID, select your team, click **Manage Certificates…**,
then **+** → **Developer ID Application**. Xcode puts the certificate and its private key in your login keychain.

Without Xcode:

1. Open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**. Enter your
   email and name, choose **Saved to disk**, and save `CertificateSigningRequest.certSigningRequest`.
2. At developer.apple.com/account/resources/certificates, click **+**, choose **Developer ID Application** (G2 Sub-CA),
   and upload the request.
3. Download `developerID_application.cer` and double-click it, which adds it to your login keychain.

Check it, and note the name in quotes:

```sh
security find-identity -v -p codesigning
#   1) 4F3A… "Developer ID Application: Bill Wang (AB12CD34EF)"
```

The 10 characters in brackets are your **Team ID**. developer.apple.com/account → Membership details also shows it.

Keep a backup. In Keychain Access, open **My Certificates**, right-click the certificate, choose **Export…**, and save
a `.p12` with a password somewhere safe. Apple lets you have only a few Developer ID certificates.

### 2. Make an app-specific password

At account.apple.com → **Sign-In and Security → App-Specific Passwords**, click **+** and name it `kothar-notary`. Copy
the password (`abcd-efgh-ijkl-mnop`). Apple shows it only once.

### 3. Save the notary credentials in your keychain

```sh
xcrun notarytool store-credentials kothar-notary \
  --apple-id you@example.com --team-id AB12CD34EF --password abcd-efgh-ijkl-mnop
```

notarytool checks the credentials with Apple and saves them in your keychain as the profile `kothar-notary`. The
build finds that profile by itself, so the password never goes in a file or an environment variable. To keep it out
of your shell history too, leave out `--password` and type the password when notarytool asks for it.

Current notarytool saves profiles where `security` and Keychain Access can't show them, so the build checks the profile
with `xcrun notarytool history --keychain-profile kothar-notary`, which signs in to Apple. That needs the network:
offline, the build can't see the profile and isn't notarized. A profile named with `KOTHAR_NOTARY_PROFILE` or
`APPLE_KEYCHAIN_PROFILE` that doesn't work stops the build with notarytool's error.

### 4. Build

```sh
npm run package
```

With one Developer ID certificate in the keychain and the `kothar-notary` profile saved, the build signs every binary
in Kothar.app with the hardened runtime, and the entitlements in `assets/entitlements.mac.plist`. It then sends the app
to Apple's notary service, staples the ticket onto the app, builds and signs the DMG, and notarizes and staples the DMG
too. Each notarization usually takes 1 to 10 minutes. If Apple rejects a submission, the build stops and prints Apple's
log.

macOS may ask once to let `codesign` use the private key. Choose **Always Allow**.

### 5. Verify

```sh
cd packages/desktop/release
codesign --verify --deep --strict --verbose=2 mac-arm64/Kothar.app   # valid on disk, satisfies its Designated Requirement
spctl -a -vvv -t exec mac-arm64/Kothar.app                          # accepted, source=Notarized Developer ID
spctl -a -vvv -t open --context context:primary-signature Kothar-0.1.0-arm64.dmg
xcrun stapler validate mac-arm64/Kothar.app                         # The validate action worked!
xcrun stapler validate Kothar-0.1.0-arm64.dmg
```

The real test is on another Mac. Download the DMG through a browser, so it gets the quarantine flag, open it and launch
Kothar. No warning should appear.

## Other ways to give credentials

The build checks for credentials in this order. The first match wins.

| Signing | |
|---|---|
| `CSC_NAME="Bill Wang (AB12CD34EF)"` | picks one certificate when the keychain holds several |
| `CSC_LINK=/path/cert.p12` + `CSC_KEY_PASSWORD` | a `.p12` instead of the keychain (CI) |

| Notarization | |
|---|---|
| `APPLE_KEYCHAIN_PROFILE` (+ `APPLE_KEYCHAIN`) | another notarytool profile, optionally in another keychain |
| `KOTHAR_NOTARY_PROFILE` | another profile name instead of `kothar-notary` in the login keychain |
| `APPLE_API_KEY` (path to the `.p8`) + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` | an App Store Connect API key (the release workflow) |
| `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` | no saved profile. The password is passed to notarytool on its command line, where other processes on the Mac can see it, so prefer the profile |
| none of these | the `kothar-notary` profile |

Credentials in the environment win over the `kothar-notary` profile, so the build doesn't sign in to Apple just to look
for a profile it won't use. If only some variables of a group are set, or `APPLE_API_KEY` names no file, the build stops
instead of shipping an app that isn't notarized. A signed build with no notarization credentials still works, and its
first line says `NOT notarized`; `KOTHAR_REQUIRE_NOTARIZED=1` makes that, or an unsigned build, stop the build instead.

## Releases from GitHub Actions

`.github/workflows/release.yml` does this same build on a Mac runner when a `v*` tag is pushed, and publishes a GitHub
Release with the DMG. CONTRIBUTING.md, "Releasing", has the secrets it needs and how to cut a release.

## What's in the bundle

`electron-builder` signs every Mach-O file inside Kothar.app with the same identity:

- the main binary
- the four `Kothar Helper` apps (plain, GPU, Renderer, Plugin)
- Electron Framework and its `chrome_crashpad_handler`, `app_shim_loader`, `libffmpeg` and `libvk_swiftshader`
- Squirrel, Mantle, ReactiveObjC and ShipIt

The app's `node_modules` (`scripts/stage.mjs`) is plain JavaScript, with no native modules.

Kothar never starts a program from inside its bundle. Engines (`claude`, `pi`, `codex`, `opencode`), `git`,
`sandbox-exec`, `open` and extensions' MCP servers come from the Mac or the user's PATH, keep their own signatures, and
aren't affected by Kothar's entitlements.
