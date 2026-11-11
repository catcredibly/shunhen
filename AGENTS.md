# Shunhen Development Instructions

- **Scope:** Make only the changes requested. Follow existing code patterns and avoid unnecessary dependencies or unrelated refactoring.
- **Architecture:** Prioritize Windows compatibility. Linux support is experimental. Prefer TypeScript for application logic and Rust for native Tauri functionality.
- **Data integrity:** Preserve existing user data, settings, backups, and legacy import compatibility. Changes to persistent data structures must not cause data loss and must use explicit, versioned migrations where necessary.
- **UI and localization:** Follow existing UI conventions. Provide all new or modified user-facing text in English, Simplified Chinese, Traditional Chinese, and Japanese.
- **Documentation:** Consult `docs/ARCHITECTURE.md` for architectural or persistence changes and `docs/RELEASING.md` for release-related changes. Update relevant documentation when behavior changes.
- **Validation and Git:** Run checks relevant to the changes. Do not change application versions or push commits unless explicitly requested. Never commit secrets, signing keys, or generated build artifacts.
