//! Regression coverage for RUSTSEC-2024-0429; run with --release on Linux.
#![cfg(target_os = "linux")]

use gtk::glib::prelude::*;

#[test]
fn variant_string_iteration_preserves_values_in_both_directions() {
    let values = ["first", "second", "third", "fourth", "fifth", "last"];
    let variant = values.to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("first"));
    assert_eq!(iter.next_back(), Some("last"));
    assert_eq!(iter.nth(1), Some("third"));
    assert_eq!(iter.nth_back(1), Some("fourth"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(variant.array_iter_str().unwrap().last(), Some("last"));
    assert_eq!(
        variant.array_iter_str().unwrap().collect::<Vec<_>>(),
        values
    );
}

#[test]
fn variant_string_iteration_handles_empty_and_unicode_values() {
    let values = ["", "日本語", "🟠"];
    let variant = values.to_variant();
    assert_eq!(
        variant.array_iter_str().unwrap().collect::<Vec<_>>(),
        values
    );
    let empty: [&str; 0] = [];
    let variant = empty.to_variant();
    assert_eq!(variant.array_iter_str().unwrap().next(), None);
    assert_eq!(variant.array_iter_str().unwrap().next_back(), None);
    assert_eq!(variant.array_iter_str().unwrap().last(), None);
}
