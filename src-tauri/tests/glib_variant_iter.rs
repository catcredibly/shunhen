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

#[test]
fn truncate_releases_removed_objects_and_terminates_the_prefix() {
    use gtk::glib::{Object, PtrSlice};

    let keep = Object::new::<Object>();
    let remove = Object::new::<Object>();
    let removed_ref = remove.downgrade();
    let mut items: PtrSlice<Object> = [keep.clone(), remove].into_iter().collect();

    items.truncate(3);
    assert_eq!(items.len(), 2);
    items.truncate(1);
    assert_eq!(items.as_slice(), &[keep]);
    assert!(removed_ref.upgrade().is_none());
    // PtrSlice guarantees a NULL pointer immediately after its last element.
    unsafe { assert!((*items.as_ptr().add(items.len())).is_null()) };
    items.truncate(0);
    unsafe { assert!((*items.as_ptr()).is_null()) };
}

#[test]
fn cloned_value_retains_the_object_until_both_values_are_dropped() {
    use gtk::glib::Object;

    let object = Object::new::<Object>();
    let weak = object.downgrade();
    let original = object.to_value();
    let copy = original.clone();
    assert_eq!(copy.get::<Object>().unwrap(), object);
    drop(object);
    drop(original);
    assert!(weak.upgrade().is_some());
    drop(copy);
    assert!(weak.upgrade().is_none());
}

#[test]
fn invalid_log_level_omits_the_untrusted_number() {
    use gtk::glib::{translate::from_glib, LogLevel};

    let err = std::panic::catch_unwind(|| unsafe { from_glib::<_, LogLevel>(0x8000_0000) })
        .expect_err("invalid level must be rejected");
    let message = err
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| err.downcast_ref::<String>().map(String::as_str));
    assert_eq!(message, Some("Unknown log level"));
}
