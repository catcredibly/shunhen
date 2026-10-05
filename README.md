<p align="center">
  <img src="src/assets/shunhen-logo-orange.png" alt="Shunhen leaf logo" width="112" />
</p>

# Shunhen

**Time well spent.**

Shunhen is a desktop focus timer and study tracker that combines a clean countdown with Subjects, Academic Years, Session history, study goals, and long-term analytics. Your study data stays local, with no account or cloud service required.

<p align="center">
  <img src="docs/screenshots/timer-page.png" alt="Shunhen Timer" width="1200" />
</p>

## Features

- Focus timer and Stopwatch mode with pause, extend, recovery, notes, and completion notifications
- Compact always-on-top timer Popout with corner docking and auto-hide
- Subjects organized into Academic Years
- Filterable, editable Session history with note search
- Daily and weekly study goals
- Analytics for trends, streaks, Subjects, Academic Years, and study patterns
- Dark and light themes with six accent colors
- English, Simplified Chinese, Traditional Chinese, and Japanese interfaces
- Portable JSON backup and restore, including older backups, plus CSV Session import and export

## Understand your study habits

Track focus time, goals, personal bests, activity, study patterns, Subjects, and Academic Years over time.

<p align="center">
  <img src="docs/screenshots/analytics-overview.png" alt="Shunhen Analytics overview" width="1200" />
</p>

<p align="center">
  <img src="docs/screenshots/analytics-study-patterns.png" alt="Shunhen study pattern analytics" width="1200" />
</p>

<p align="center">
  <img src="docs/screenshots/analytics-subject-share.png" alt="Shunhen Subject study pattern analytics" width="1200" />
</p>

## Keep your timer close

Use the compact always-on-top Popout to keep track of a Session without leaving your work.

<p align="center">
  <img src="docs/screenshots/popout.png" alt="Shunhen timer Popout on Windows" width="900" />
</p>

## Privacy

Shunhen is local-first. Academic Years, Subjects, Sessions, settings, and notes are stored locally in SQLite on the device where Shunhen runs.

Shunhen does not upload study data to an account or bundled cloud service.

Export regular backups if your data matters to you. Removing Shunhen’s application data may remove locally stored data. Existing SQLite data is retained when you update. Older exported JSON backups and CSV files remain importable.

## Availability

Shunhen is available for Windows and Linux on x86-64 systems.

Linux releases are available as AppImage and Debian (`.deb`) packages and are currently experimental. Some platform-specific features may behave differently or be unavailable on Linux.

Support for additional platforms may be considered in the future.

## Demo data

Want to explore Shunhen with sample history and Analytics? [Download the demo data](docs/demo/shunhen-demo.json) and import it from Import / Export.

If you already use Shunhen, export a backup before importing the demo data.

## Feedback

Found a bug or have an idea for Shunhen? [Open an issue](https://github.com/catcredibly/shunhen/issues/new/choose) to report a problem or request a feature.

## Development

### Windows prerequisites

- Node.js LTS and npm
- Rust stable with the MSVC toolchain
- Visual Studio Build Tools with Desktop development with C++ and a Windows SDK
- Microsoft Edge WebView2 Runtime

### Setup

```powershell
npm ci
npm run tauri dev
```

### Checks

```powershell
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

### Windows installer

```powershell
npm run tauri build
```

Set release metadata with `npm run version:set -- <version>`. The root package version drives Tauri and is checked before production builds. See [installer compatibility](src-tauri/windows/README.md) for the Focus/Shihen-to-Shunhen upgrade verification.

Generated installers and executables should not be committed to source control.

## Technology

- Tauri 2 and Rust
- React and TypeScript
- Vite
- SQLite with cross-platform native storage
- Recharts

See [Architecture](docs/ARCHITECTURE.md) for implementation details and [release packaging](docs/ARCHITECTURE.md#release-notes-and-updater-metadata) for the release workflow.

## Security

Never commit personal backup files, signing keys, certificates, or credentials. See [SECURITY.md](SECURITY.md) for reporting and handling guidance.

## License

Shunhen is available under the [MIT License](LICENSE).
