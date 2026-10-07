# Shunhen Architecture

## Current runtime guarantees

- Shunhen runs as a single-instance application. A second launch focuses the existing main window.
- The main window and compact popout share one authoritative active Timer through persisted state and cross-window updates.
- Running, Paused, Finished, recovery, checkpoint, note, and save-failure state remains in the active Timer record until it is finalized or explicitly discarded.
- Completed Sessions store pauses; derived focus intervals let daily and weekly goals allocate focused time correctly across local-day and Monday-based week boundaries.
- The popout can target either the current monitor or an explicitly selected display. Native Windows work-area coordinates keep docking clear of the taskbar and support negative coordinates in multi-monitor layouts.
- English, Simplified Chinese, Traditional Chinese, and Japanese are available as persisted locales. User-created names and notes are not translated.

## Technology stack

- **Tauri 2 and Rust** provide the desktop shell and native integrations.
- **React 19 and TypeScript** implement the application UI and domain logic.
- **Vite** builds and serves the frontend.
- **Tailwind CSS 4** is available through the Vite integration alongside the application's shared CSS.
- **SQLite and bundled rusqlite** provide authoritative local persistence on Windows and Linux. Tauri owns one pinned native connection; TypeScript owns repositories, query models and domain behavior.
- **Recharts** renders standard analytics charts, while custom React/CSS views handle heatmaps and other specialized visualizations.
- **Vitest** covers data, timer, analytics, settings, and import/export behavior.

## Runtime structure

```text
Windows
  -> Tauri 2 application
       -> Main React WebView window
       -> Compact timer React WebView popout
```

Development dependency optimization uses an explicit include list and skips automatic scanning, avoiding slow cold scans in development; packaged builds use prebuilt assets. Both windows load the same Vite bundle. `App.tsx` selects the compact popout UI when the window URL contains `#/popout`; otherwise, it renders the main application and page navigation.

Application and domain behavior resides primarily in TypeScript. Native desktop behavior is implemented through Tauri APIs, Rust commands, and narrowly scoped Tauri plugins where required.

## Persistence

SQLite is the only authoritative study store. If the frontend startup connection check fails, the failure screen displays selectable diagnostic text containing the app version and underlying error (including an Error stack/cause when available), without requiring developer tools. `shunhen.sqlite3` lives in Tauri’s platform-resolved application data directory; no Windows path or system SQLite installation is required. [rusqlite](https://github.com/rusqlite/rusqlite) compiles bundled SQLite on Windows and Linux. The narrow native bridge pins transactions to one connection instead of issuing transaction control through a connection pool. Storage is initialized by a builder-registered plugin before any configured WebView is created, so the first frontend request always finds the managed SQLite connection. Autostart, updater and process plugins are also registered before windows load. Destroying the main window exits the application even if startup failed before React installed its close handler; hidden auxiliary windows cannot leave an unrelaunchable instance behind.

`storage/model.ts` defines normalized records with numeric row IDs. Four focused write repositories own Academic Years, Subjects, Sessions (including pauses), and Settings. `storage/queries.ts` provides joined History and Analytics snapshots. React consumes these query models through a read-only hook that refreshes on committed native storage events across windows. Decimal string IDs at form/selector boundaries represent SQLite integers; UUIDs are external source/recovery identities, never primary or foreign keys.

The normalized schema is:

- `academic_years`: integer primary key, name, optional ISO `YYYY-MM-DD` civil start/end dates, independent 0/1 archive flag; date order is checked.
- `subjects`: integer primary key, cascading Academic Year foreign key, name, stable palette integer `color_id`, independent 0/1 archive flag.
- `sessions`: integer primary key, cascading Subject foreign key, UTC Unix `started_at` seconds, positive `elapsed_seconds`, nullable note and 0/1 `manual` flag.
- `session_pauses`: cascading Session foreign key, non-negative relative `offset_seconds`, positive `duration_seconds`, composite `(session_id, offset_seconds)` primary key. Triggers reject overlap and out-of-bounds pauses.
- `settings`: typed application helpers over string key/value rows, including preferences, goals and completion claims.
- `session_sources`: one canonical external source identity per Session, with both `source_key` primary key and `session_id UNIQUE` cascading foreign key. New Sessions receive random `session:<UUID>` identities independent of local row IDs. Edits preserve identity; deletion cascades its mapping. Identities stay out of ordinary History/Analytics/filter UI.

Primary keys use ordinary `INTEGER PRIMARY KEY`, without `AUTOINCREMENT`. Useful indexes cover Subjects by parent, Sessions by start and by Subject/start, and source identities by Session. Foreign keys are enabled on the native connection. Frontend Web Locks reduce contention; transaction callbacks receive an explicit scoped database. Native asynchronous admission waits for a competing transaction before admitting unscoped reads/writes or a new transaction, including startup connection checks. Scoped requests must still match both the transaction token and window; mismatches fail immediately. Commit, rollback, and owner-window destruction wake waiting requests; destroying the owner rolls back unfinished work. Native notification registration precedes the owner check, preventing missed wakeups. This avoids treating normal multi-window startup contention as a fatal storage error. WAL and full synchronous durability are configured centrally. SQLite schema upgrades use `user_version` and transactional DDL. Schema version 2 collapses old source aliases, preferring a native `session:` key, then a recognized historical key, with binary lexical ordering within each preference. Sessions without recognized keys receive random canonical identities. Fallback assignments are saved in a temporary SQLite upgrade table before the schema transaction so rollback/retry does not choose new identities. The upgrade replaces the mapping table with the unique constraint, validates foreign keys, and removes temporary assignments on success. Schema version 3 removes the obsolete transition metadata table from existing SQLite installations; fresh databases never create it.

Permanent timing has whole-second precision. End is `started_at + elapsed_seconds`; Focus Time is elapsed minus pause durations. A continuous Session has no pause rows. Analytics reconstructs focus ranges as the complement of the ordered pause ranges, including overnight Sessions. End, Focus Time, focus intervals, names, parent-year relationship and effective archive state are derived read-model values, never Session columns. Active timers retain their existing precise timestamps and recovery behavior in `localStorage`. Notes retain the existing 1200 visible-character/40-line behavior.

## Academic Year and Subject selectors

Academic Years remain the parents of Subjects. There is no Current Academic Year setting or selection. Legacy `currentAcademicYearId` settings are remapped during old backup import and ignored by normal selectors.

New Timer and manual Sessions can use any non-archived Subject whose Academic Year is non-archived, regardless of the year's dates. Date-range validity for historical Analytics remains unchanged. Subject defaults are eligible across all such Academic Years.

Timer Subject choices are alphabetical within alphabetical Academic Year groups, with headers omitted when only one year contains eligible Subjects. Analytics, History, and Subjects management Academic Year filters support multiple selections; an empty selection means All. History and Analytics Subject filters support multiple selections independently of the Academic Year filter. Matching uses OR within each filter and AND between filters. Changing year selections removes only Subject selections outside that scope. Historical filters include archived entities.

`selectorOptions.ts` shares alphabetical ordering and groups non-archived Academic Years before archived Academic Years. `FilterSelect` uses a compact 40px trigger in both horizontal filters and vertical forms. Its popover has a visible Multi-select switch, a search field, an unrestricted All option for filters, and a separately scrolling grouped option list. Filters default to single selection; enabling Multi-select preserves selections and shows checkboxes. Disabling it with multiple selections returns to All. One or two selected names stay visible in the trigger; larger selections use localized count summaries. Subject search also matches Academic Year group names. Group headers and the single archived separator remain non-selectable.

Timer, Subject defaults, CSV destinations, and creation/edit/move forms use this same control with Multi-select visible but disabled: those operations require a single relationship. Required forms use Choose placeholders rather than an unrestricted All option. Hidden fields retain FormData submission where needed. Subject options are always grouped for filters/forms, including All Academic Years; the Timer keeps the single-year flat-list exception.

## Data relationships

```text
Academic Year
  -> Subjects
       -> Sessions
```

A Subject stores only its parent Academic Year ID. A Session stores only its Subject ID; current names and the Academic Year are resolved through joins. Renaming or moving a parent updates historical display without rewriting Sessions.

Archiving retains records. Academic Year archival changes only its own flag; Subject archival means independent intent. Effective Subject and Session archival is Subject archived OR parent Year archived. Restoring a Year reveals Subjects that were not independently archived. Moving a Session changes only its Subject foreign key; moving a Subject changes only its Academic Year foreign key. Database cascades delete dependent Subjects, Sessions, pauses and source identities. Invalid-Session checks continue to use the resolved Academic Year’s civil date boundaries.

## Timer architecture

The Timer page waits for its initial Academic Year, Subject and Session queries before evaluating setup or rendering timer content. It shows an idle Timer skeleton while those queries are unresolved; confirmed empty data still triggers setup. Live-query refreshes retain the loaded view until updated results arrive.

The user-facing timer states are:

- Idle
- Running
- Paused
- Expired/Finished

Pure functions in `timerState.ts` calculate timer state from timestamps. The `useTimer` hook owns the live React state, persists recoverable active-timer state, and coordinates completion behavior.

The application maintains one authoritative active timer shared between the main window and popout. Both windows synchronize through a `BroadcastChannel` and recover from the same persisted timer state. The popout does not maintain an independent timer, and closing it does not stop or otherwise alter the active Session.

The main window alone schedules recovery checkpoints every 60 seconds, anchored to the active running interval's Start/Resume time. State transitions persist immediately; paused, finished, idle, and undecided recovery states have no periodic writer. A confirmed main-window close writes one exact checkpoint before invoking `close_main_window`; cancelling the warning leaves the timer untouched. Native close events do not force process termination.

Running-session recovery offers two explicit choices, including after a countdown deadline has passed. Continue preserves the original running timeline (and caps countdown focus at its original deadline). Resume from where I left off restores only the last persisted checkpoint and starts a new focus interval at recovery time, excluding the unavailable period. Paused Sessions reopen paused; finished unsaved Sessions retain their save flow. Checkpoints remain in the existing localStorage Timer record until successful persistence or discard.

## Analytics

```text
SQLite joined Sessions
  -> effective Subject/Academic Year archive status and filters
  -> pure TypeScript aggregation utilities
  -> React Analytics pages
  -> Recharts and custom heatmaps
```

History and Analytics read consistent joined SQLite snapshots through dedicated query modules. Committed changes in either window refresh subscribed UI queries without a separate analytics database or persistent cache.

Aggregation utilities group completed focus time by date, Subject, Academic Year, session length, and other dimensions displayed by the analytics interface.

Analytics memoization is scoped to the live database snapshot. Replacing that snapshot after any Session write invalidates derived totals, series, and allocation reuse, including edits retaining the same Session ID. Daily allocations and identical daily series are reused in memory only; hour-of-day and partial-week goal calculations retain their separate interval semantics. Chart interaction state stays local to the chart. Calendar scopes refresh at local midnight, minute-sensitive goal metrics retain minute refreshes, and returning from suspension refreshes the clock immediately. Formatted memoized series also depend on locale.

History and Analytics share linked Academic Year/Subject filter logic, retaining independent Single/Multi modes and semantic All (empty ID arrays). Every manual Academic Year change resets Subjects to All. Goal scope alone automatically includes newly created/reactivated active years without resetting existing Subject refinements; AcademicYearRepository commits that inclusion with the year write. Goal-specific automaticYearIds and excludedAutomaticSubjectIds metadata preserve explicit exceptions while including new/reactivated Subjects in automatic years. Subject creation/reactivation clears only its own automatic exception in the same repository transaction. Its Settings controls prevent removing the final eligible year or Subject. If eligibility changes leave no included active year while active years remain, the scope recovers to semantic All Academic Years and All Subjects; an empty active-year universe remains temporary. An exhausted custom Subject selection likewise recovers to All Subjects where eligible Subjects remain. Recovery is transactional with repository writes/deletes and applied on settings initialization. Subject Multi mode visibly checks all available Subjects in All, uses an indeterminate parent checkbox for a custom scope, and prevents deselecting the final Subject. Selecting every Subject normalizes to semantic All. Settings uses the same menus in Multi-only mode with standard Settings row/trigger styling for active-only Goal scope. The goalScope Settings JSON stores stable year/subject IDs; All remains dynamic. Missing scope defaults to All, active eligibility is checked on every goal read, and JSON restore remaps both year and subject references. Daily/weekly progress, Goal Achievement, and save-time completion checks share goalScopeSessions. Temporary page filters never affect goals; Goal Achievement still uses the selected time range. Timer and Session assignment controls remain separate.

Settings initialization shares one promise per webview, avoiding repeated settings normalization and native autostart reconciliation on component mounts. Failed initialization remains retryable; explicit setting changes and backup restores continue to verify native state independently.

Subject share over time uses daily buckets for ranges up to 14 days, Monday-based weekly buckets through 60 days, and monthly buckets for longer ranges. Only data-bearing buckets are displayed, using straight-line 100% stacked areas in the existing Subject order; omitted calendar periods occupy no space and introduce no placeholders or synthetic values. An accessible title info tooltip explains that periods without study data are omitted. Monthly labels sit above a single secondary year label centered beneath that year's displayed buckets using real chart tick coordinates. The axis reserves explicit vertical space for both rows above the scrollbar. Each displayed bucket allocates approximately 58 pixels, with horizontal scrolling for longer series and the normal chart-level empty state when no buckets remain.

## Import / Export

- **JSON full backup and restore** exports `shunhen-backup`, `formatVersion: 2`, and the current app version. The portable logical envelope contains top-level Academic Years, Subjects, Sessions and a key/value Settings object. Sessions export only `id`, `sourceIdentity`, `subjectId`, `startedAt`, `elapsedSeconds`, optional `note`, `manual` and nested `pauses` (always an array, including `[]` for continuous Sessions). Civil dates remain ISO text and colors are stable palette IDs. There are no raw SQLite tables, derived timing/name/archive fields or `sessionTimingVersion`. Each Session exports its canonical `sourceIdentity`; repeated exports retain it. Older logical v2 files with a separate `sessionIdentities` map remain readable, but new exports use only the per-Session field.
- Version 1 JSON follows a dedicated legacy parser and the import-only v1 timing/relationship converter; logical version 2 follows a strict normalized parser. A separate adapter reads the short-lived earlier `focus-backup` version 2 envelope, but exports always use the logical format. Both parsers yield the same internal import model. Trusted Shunhen identities determine duplicates first. Matching identity plus equal normalized destination/timing/pauses/manual/note is an identical duplicate; changed contents are a conflict. Identity-free older files use content fingerprints only as probable duplicates with multiset counts, and genuinely new rows receive fresh random canonical identities. Import IDs never become global identities. Merge/replace validates everything before mutation, matches normalized parent names within scope using unique exact details first and deterministic one-to-one consumption, reports indistinguishable matches as ambiguous conflicts, allocates/remaps local IDs and Settings references, and validates one SQLite transaction before commit. JSON, CSV and timer saves share the normalized Session repository writer. Failed imports leave Settings untouched as well as study records; native startup changes are rolled back and any native rollback failure is reported.
- `docs/demo/shunhen-demo.json` is a portable logical version 2 example, validated by the backup tests.
- **CSV Session import and export** emits source identity, display labels, Unix start seconds, elapsed seconds and pauses. Older Shunhen CSVs (including precise Focus intervals) and mapped generic CSVs remain importable. Only the recognized Shunhen CSV layout supplies authoritative `Source Identity`; recognized older Shunhen IDs use `legacy-session:<old-id>`. Arbitrary third-party ID or Source Identity columns are ignored as identity. The same shared comparison and Keep Existing / Use Imported conflict policies apply to JSON and recognized CSV, retaining the existing local Session ID and canonical identity on conflict updates. Repeated identical identities within a file coalesce; conflicting repetitions reject the import before writes. Preview and import use the same matcher, and CSV import rechecks its transaction snapshot. Fingerprints are a fallback only for identity-free rows; multiplicity is preserved within a file. Preview IDs are temporary and never become SQLite row IDs.

In the desktop application, Tauri file dialogs and filesystem APIs handle file access. Browser development mode uses download and file-input fallbacks.

## Native Windows integration

The current Windows implementation includes:

- Native open/save dialogs and filesystem access for import/export
- A configured compact timer popout window
- Popout always-on-top behavior, taskbar visibility control, sizing, positioning, and monitor-bound checks
- Native close handling that hides the popout without altering timer state
- Desktop completion notifications
- Launch-at-startup support (disabled by default). Native autostart state is authoritative: settings initialization reconciles the stored value, and changes and backup restores persist only verified native state. Failed restore transactions attempt native rollback and reconcile the observed state before reporting failure. The legacy Focus autostart identity is retained.
- Main-window maximize and restore controls through the Tauri window API

Custom window commands and lifecycle handling reside in `src-tauri/src/lib.rs`. Tauri plugins provide dialogs, filesystem access, notifications, and autostart support.

## Release identity

- Visible brand: `Shunhen`
- Bundle/display product name: `Shunhen`
- Legacy installation identifiers: retained for upgrade compatibility; see [Windows installer compatibility](../src-tauri/windows/README.md)
- Canonical version source: root `package.json`
- Tauri application identifier: `com.focus.timer`
- SQLite database filename: `shunhen.sqlite3`
- Windows installer format: NSIS

The application identifier remains stable across installers. SQLite schema upgrades retain the same database file and installer identity.

The Orange leaf is the permanent Windows application icon. In-app leaf artwork follows the selected accent using approved packaged variants.

## Main source structure

```text
src/
  analytics/        Pure aggregation utilities, development data, and tests
  assets/           Frontend-owned packaged assets
  components/       Pages, dialogs, navigation, timer, and settings UI
  hooks/            Shared React hooks for timer and settings state
  importExport/     JSON backup/restore and CSV import/export
  App.tsx           Main-window routing and popout entry selection
  db.ts             SQLite connection/transaction facade
  storage/          Normalized schema, four repositories, queries, snapshots and validation
  types.ts          Derived UI/domain model types
  settings.ts       Typed settings defaults and persistence helpers
  timerState.ts     Pure timer state calculations
  timerCompletion.ts Completion sound, notification, and popout effects
  management.ts     Transactional archive and deletion operations
  styles.css        Shared application styling

src-tauri/
  src/              Rust entry point and native window commands
  capabilities/     Allowed Tauri plugin and window capabilities
  icons/            Packaged Windows/application icons
  tauri.conf.json   Application and window configuration
```

## Release notes and updater metadata

GitHub Release notes and updater metadata use the same UTF-8 Markdown notes file.

Following creation of a signed release build, updater metadata can be generated from the current-version artifact:

```powershell
node tools/generate-updater-manifest.mjs --notes RELEASE_NOTES.md --artifact "src-tauri/target/release/bundle/nsis/Shunhen_<version>_x64-setup.exe" --repository catcredibly/shunhen

gh release create "v<version>" --repo catcredibly/shunhen --notes-file RELEASE_NOTES.md <installer> <installer.sig> <latest.json>
```

The manifest helper reads the authoritative package version and the existing matching `.sig`. It does not build or sign the application, upload release assets, or modify the embedded updater endpoint or public key.

Linux updater metadata can be added to the same output using:

```text
--platform linux-x86_64 --artifact <signed AppImage>
```

together with:

```text
--output <latest.json>
```

Only same-version platform entries are retained, preventing stale signatures from being carried into another release.

Generated manifests, signatures, and bundles are release artifacts rather than repository source files and are excluded from commits.

JSON serialization preserves quotes and line breaks in release notes. The frontend escapes rendered text and supports headings, paragraphs, lists, bold text, inline code, and HTTP(S) links. Raw HTML is not rendered.

## Experimental desktop capabilities

Windows and Linux share a single React application and Tauri project.

Windows-specific window constraints and display-message handling are target-gated. Linux uses GTK's selected backend and monitor signals exposed through Rust capability queries rather than UI-level operating-system checks.

Under X11/XWayland, window placement is available where permitted by the window manager. Under native Wayland, placement is controlled by the compositor. In environments where precise popout positioning is unavailable, Shunhen keeps the popout visible rather than relying on an unplaceable reveal tab.

Global shortcuts depend on backend support and may be unavailable in environments without an appropriate implementation. Existing preferences remain persisted regardless of capability availability.

Real Linux desktop testing is still required for mixed-DPI monitors, docking, autostart, and notifications. The Linux workflow is run manually by the maintainer. Headless checks establish build and source compatibility but do not demonstrate full native desktop parity.

## Platform architecture

Shunhen uses one shared Tauri/React codebase across supported desktop platforms rather than separate Windows and Linux application implementations.

Platform-specific behavior follows a layered architecture:

1. Tauri's cross-platform APIs provide the default implementation where they support the required behavior.
2. Small operating-system-specific differences are handled with narrowly scoped Rust `#[cfg(...)]` branches.
3. Substantial native differences are isolated behind shared interfaces with platform-specific Rust implementations or modules.
4. Where exact parity is unavailable, particularly under Wayland, capability-aware fallbacks preserve usable application behavior.

React and other frontend code remains platform-neutral wherever practical. The frontend requests capabilities such as popout reveal, docking, or work-area detection without depending on the operating-system-specific implementation behind them.

Environment capabilities are preferred over operating-system identity when behavior depends on factors such as display-server support. This avoids spreading checks such as `platform === "linux"` through UI code.

Windows-specific dependencies and imports are target-gated so they are not unnecessarily compiled on Linux. Linux-specific native dependencies are used only where Tauri or other cross-platform APIs do not provide the required functionality.

Existing Windows-native implementations remain unchanged where additional abstraction would provide no practical isolation benefit. Platform abstractions are introduced where native behavior differs substantially enough to justify a shared interface.

Linux support accounts for both X11 and Wayland. Features such as precise positioning or docking may degrade gracefully when they cannot be implemented reliably under the active desktop environment. Such limitations are treated as capability differences rather than application failures.

The resulting platform model consists of:

- one repository
- one shared React application
- one Tauri project
- shared behavior by default
- small `#[cfg]` branches for limited platform differences
- platform modules or adapters for substantial native differences
- capability-based fallbacks where exact parity is unavailable

## Release metadata and branding compatibility

The root `package.json` is the canonical source of the application version. `npm run version:set -- <version>` updates npm and Cargo version metadata together.

Tauri reads the version from `../package.json`. The About interface, backups, and updater manifest use the same package metadata. `npm run version:check` detects version drift and runs before production frontend builds.
