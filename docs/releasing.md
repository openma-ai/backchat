# Production releases

Backchat uses the operating system's native credential protection for a
persistent Chromium profile: Keychain on macOS, DPAPI on Windows, and
libsecret/KWallet on Linux. Production artifacts therefore need a stable
publisher identity. Test-only storage switches such as `use-mock-keychain` and
weak backends such as `password-store=basic` must not be enabled in releases.

`pnpm package` is the production entry point. It performs a credential
preflight, builds with `electron-builder.release.yml`, and verifies the result
with the platform's native trust tooling. It fails before building rather than
silently emitting an unsigned or ad-hoc release.

For local artifacts that are never published, use `pnpm package:local` or
`pnpm package:dir`. Local macOS artifacts are ad-hoc signed and can require a
new Keychain authorization after every rebuild; that behavior is not a valid
production-release test.

## macOS

Use a `Developer ID Application` certificate belonging to the Apple Developer
team that will own the stable bundle ID `dev.openma.backchat`. Prefer an
App Store Connect API key for notarization.

Required environment variables:

- `CSC_NAME` selecting a `Developer ID Application` identity already installed
  in the build keychain, or `CSC_LINK` plus `CSC_KEY_PASSWORD` for an imported
  PKCS#12 identity.
- `APPLE_API_KEY`: path to the App Store Connect `.p8` private key.
- `APPLE_API_KEY_ID`.
- `APPLE_API_ISSUER`.

The release enables the hardened runtime, signs nested Electron helpers and
native modules, submits the app for notarization, staples the ticket, and then
requires `codesign`, Gatekeeper (`spctl`), and `stapler validate` to succeed.
Never commit the certificate, private key, or notarization credentials.

When moving from existing ad-hoc builds to the first Developer ID release, the
old `Backchat Safe Storage` item may request authorization once because it was
created for a CDHash-based identity. A clean production profile can instead
create a new item owned by the stable Team ID. Later releases from that Team ID
should retain access across updates.

## Windows

Use an Authenticode certificate from a trusted CA. Microsoft Trusted Signing
can replace a local PFX when the release infrastructure is ready for it; the
current pipeline accepts a CI-injected PFX.

Required environment variables:

- `WIN_CSC_LINK`: path, URL, or encoded PKCS#12 certificate.
- `WIN_CSC_KEY_PASSWORD`.

The builder signs executables and the NSIS installer using SHA-256 with an RFC
3161 timestamp. The release is rejected unless `signtool verify /pa /all`
succeeds. Keep the publisher identity stable across certificate renewals so
SmartScreen reputation and update signature checks remain continuous.

## Linux

Linux desktop environments do not share one application code-signing identity.
Backchat publishes an AppImage and creates a detached OpenPGP signature.

Required environment variable:

- `BACKCHAT_LINUX_GPG_KEY_ID`: fingerprint or unambiguous ID of the release key
  already available to GnuPG on the release runner.

The release command produces `<artifact>.asc` and immediately verifies it with
GnuPG. The download page must publish both files. If Backchat later ships from
an APT/RPM/Flatpak/Snap repository, the repository or store signature becomes
the primary trust root and should be documented here.

## CI controls

- Run each platform build on its native runner.
- Store signing keys in a CI secret store, HSM, or managed signing service.
- Restrict release credentials to protected tags/environments and required
  reviewers.
- Pin the Bundle ID/application ID and publisher identity.
- Verify signatures after packaging, then test an upgrade from the previous
  production version on clean macOS, Windows, and Linux machines.
- Keep development and production profiles separate; never sign arbitrary pull
  request code with production credentials.
