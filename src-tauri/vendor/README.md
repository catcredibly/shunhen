# GLib security backport

`glib/` contains the crates.io `glib` 0.18.5 package (MIT license retained).
The original package checksum in Cargo.lock was
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
The original `.cargo_vcs_info.json` records its upstream revision.

The only Rust source changes are the two-line upstream fix for
[RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g](https://rustsec.org/advisories/RUSTSEC-2024-0429.html):
[gtk-rs/gtk-rs-core#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343).
In `VariantStrIter::impl_get`, the C out-pointer is mutable and passed as
`&mut p`, rather than writing through an immutable reference.

Tauri's GTK 3 dependencies require GLib 0.18. Adding GLib 0.20 directly would
not replace that dependency and its types are not interchangeable. The root
`[patch.crates-io]` makes all transitive consumers use this compatible copy.
The version remains truthful; a scanner that matches only the version may
still flag it. Do not globally suppress the advisory or claim it was upgraded.

Remove this directory and the Cargo patch when the GTK/Tauri stack can resolve
a supported fixed GLib release (0.20 or newer), then regenerate Cargo.lock.
Do not edit generated bindings or reformat the vendored package.
