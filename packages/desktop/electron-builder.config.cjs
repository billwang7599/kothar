// Packs Kothar into Kothar.app and a DMG (npm run package). The app folder it packs is laid out by scripts/stage.mjs.
//
// Signing and notarization switch on by themselves once you have a Developer ID certificate and a notarytool profile;
// scripts/signing.ts decides how (and says so in one line at the start of the build), and README.md has the one-time
// setup. With no certificate the app gets an ad-hoc signature, which Apple Silicon needs to run it at all.
const signing = require('./scripts/signing.ts')

const plan = signing.signingPlan(process.env)
console.log(plan.message)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.billwang.kothar',
  productName: 'Kothar',
  // The Electron that `npm run desktop` runs, so the app ships what was tested.
  electronVersion: require('electron/package.json').version,
  copyright: 'Copyright © Bill Wang',
  directories: { app: 'build/app', output: 'release', buildResources: 'assets' },
  // Plain files: the core imports the built-in extensions' TypeScript at startup, and the Browser extension shows Chrome
  // its extension folder to load from disk, neither of which works from inside an asar archive.
  asar: false,
  // Nothing native to rebuild; the staged node_modules is already exactly what ships.
  npmRebuild: false,
  files: ['**/*', '!**/*.map'],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.developer-tools',
    icon: 'assets/icon.icns',
    minimumSystemVersion: '13.0',
    darkModeSupport: true,
    // undefined: the certificate from CSC_LINK. '-': ad-hoc.
    identity: plan.identity,
    hardenedRuntime: plan.signed,
    // The main app and every Electron helper (renderer, GPU, plugin) get the same short list.
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
    // scripts/signing.ts notarizes with notarytool itself (hooks below), so it can use a keychain profile, check
    // Apple's verdict and notarize the DMG as well as the app.
    notarize: false,
  },
  dmg: {
    title: '${productName} ${version}',
    artifactName: '${productName}-${version}-${arch}.${ext}',
    // Signed with the app's identity, then notarized and stapled, so the download itself opens without a warning.
    sign: plan.signed,
  },
  afterSign: signing.afterSign(plan),
  afterAllArtifactBuild: signing.afterAllArtifactBuild(plan),
}
