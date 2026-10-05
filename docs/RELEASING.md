# Shunhen Release Build Guide

Use this process for Windows production releases of Shunhen.

## Release version

The current release version used by this guide is:

```text
3.1.0
```

When preparing a new release, first use Ctrl+H in this file to replace every occurrence of the current release version with the new version.

This updates version-specific examples in the guide, including expected installer filenames and manifest checks. Do not replace historical compatibility references that intentionally refer to an older version.

Then, from the repository root, update and verify the application version and run the formatter:

```powershell
npx prettier . --write
npm run version:set -- 3.1.0
npm run version:check
```

Replace `3.1.0` with the new release version before running the commands.

`package.json` is the authoritative version source. `version:set` synchronizes the required npm and Cargo metadata, and Tauri reads the resulting package version.

Run all commands in this guide from the repository root unless stated otherwise.

## 1. Prepare the release notes

Create or update:

```text
RELEASE_NOTES.md
```

Place it in the docs folder alongside `package.json`:

```text
Shunhen/docs
/demo
/screenshots
ARCHITECTURE.md
RELEASING.md
```

Write the release notes in normal UTF-8 Markdown.

`RELEASE_NOTES.md` is the single source for:

- the GitHub Release description
- the updater's **What's new** content in `latest.json`

Do **not** manually copy the release notes into `latest.json`.

Use the release-version process above before building. Root `package.json` is authoritative; `npm run version:set -- <version>` synchronizes the required npm/Cargo metadata and Tauri reads that package file. Do not edit historical release notes or compatibility fixtures.

---

## 2. Load the updater signing key

In PowerShell:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="$HOME\.tauri\focus.key"

$secure = Read-Host "Updater signing key password" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
```

Use the same PowerShell window for the rest of the build.

Confirm that both environment variables exist without printing their contents:

```powershell
Test-Path Env:TAURI_SIGNING_PRIVATE_KEY
Test-Path Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Both should return:

```text
True
True
```

Never commit or share `focus.key` or its password.

---

## 3. Build the Windows release

From the repository root:

```powershell
npm run tauri build
```

The NSIS release files are created under:

```text
src-tauri\target\release\bundle\nsis\
```

For Shunhen 3.1.0, expect:

```text
Shunhen_3.1.0_x64-setup.exe
Shunhen_3.1.0_x64-setup.exe.sig
```

The `.sig` belongs to that exact build.

If you rebuild the installer for any reason, always use the newly generated `.sig` and regenerate `latest.json`.

---

## 4. Generate `latest.json`

Still from the repository root:

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version

$windowsDir = "src-tauri\target\release\bundle\nsis"
$windowsInstaller = "Shunhen_${version}_x64-setup.exe"

$linuxDir = "src-tauri\target\release\bundle\linux"
$linuxAppImage = "Shunhen_${version}_amd64.AppImage"
$linuxDeb = "Shunhen_${version}_amd64.deb"

node tools/generate-updater-manifest.mjs `
  --notes docs\RELEASE_NOTES.md `
  --artifact "$windowsDir\$windowsInstaller" `
  --repository catcredibly/shunhen

node tools/generate-updater-manifest.mjs `
  --notes docs\RELEASE_NOTES.md `
  --artifact "$linuxDir\$linuxAppImage" `
  --repository catcredibly/shunhen `
  --platform linux-x86_64-appimage `
  --output "$windowsDir\latest.json"

node tools/generate-updater-manifest.mjs `
  --notes docs\RELEASE_NOTES.md `
  --artifact "$linuxDir\$linuxDeb" `
  --repository catcredibly/shunhen `
  --platform linux-x86_64-deb `
  --output "$windowsDir\latest.json"
```

Version for just Windows build

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = "Shunhen_${version}_x64-setup.exe"
$dir = "src-tauri\target\release\bundle\nsis"

node tools/generate-updater-manifest.mjs --notes docs\RELEASE_NOTES.md --artifact "$dir\$installer" --repository catcredibly/shunhen
```

The helper should:

- read the current version
- read `RELEASE_NOTES.md`
- read the matching installer signature
- generate the updater download URL
- write the release notes into the `notes` field
- emit UTF-8 JSON without a BOM

Do **not** manually edit the generated `latest.json`.

---

## 5. Verify `latest.json`

Check the generated version:

```powershell
$manifest = Get-Content "$windowsDir\latest.json" -Raw -Encoding UTF8 | ConvertFrom-Json

$manifest.version
$manifest.notes

$manifest.platforms.PSObject.Properties['windows-x86_64'].Value.url
$manifest.platforms.PSObject.Properties['linux-x86_64-appimage'].Value.url
$manifest.platforms.PSObject.Properties['linux-x86_64-deb'].Value.url
```

For this release it should report:

```text
3.1.0

Release Notes:

URLs to setup images
```

You can also inspect the generated manifest:

```powershell
Get-Content "$windowsDir\latest.json" -Raw |
ConvertFrom-Json |
Format-List
```

Confirm that the version, download URL, signature, and release notes are for the current release.

### Optional BOM check

```powershell
$bytes = [System.IO.File]::ReadAllBytes("$dir\latest.json")
$bytes[0..2]
```

The file should begin with `{` (`123`) and must **not** begin with the UTF-8 BOM:

```text
239
187
191
```

---

## 6. Create the GitHub Release

Create a GitHub release using the same `RELEASE_NOTES.md`.

If using GitHub CLI:

```powershell
gh release create "v$version" `
  "$dir\$installer" `
  "$dir\$installer.sig" `
  "$dir\latest.json" `
  --repo catcredibly/shunhen `
  --title "Shunhen $version" `
  --notes-file RELEASE_NOTES.md
```

This creates the release and uploads:

```text
Shunhen_<version>_x64-setup.exe
Shunhen_<version>_x64-setup.exe.sig
latest.json
```

GitHub automatically provides the source `.zip` and `.tar.gz` archives.

If you create the release manually through GitHub instead, use the contents of `RELEASE_NOTES.md` as the release description and upload the same three files.

---

## 7. Final release check

After publishing, confirm that the GitHub Release contains:

```text
Shunhen_<version>_x64-setup.exe
Shunhen_<version>_x64-setup.exe.sig
latest.json
```

Also confirm:

- the GitHub Release notes match `RELEASE_NOTES.md`
- `latest.json` contains the same release notes
- `latest.json` points to the correct release installer
- the version is correct
- the installer and `.sig` are from the same build

Do not regenerate or modify any of these files after publishing without replacing the corresponding release assets together.
