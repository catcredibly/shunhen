import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StorageError, describeStartupError } from "./StorageError";
import packageMetadata from "../../package.json";
import "../i18n";

it("preserves native error strings and structured rejection details", () => {
  expect(describeStartupError("SQLite transaction owner mismatch")).toBe("SQLite transaction owner mismatch");
  expect(describeStartupError({ message: "database is locked", code: 5 })).toContain('"code": 5');
});

it("includes Error stacks and nested causes", () => {
  const error = new Error("Startup failed", { cause: new Error("disk I/O error") });
  error.stack = "Error: Startup failed\n    at startup";
  const details = describeStartupError(error);
  expect(details).toContain(error.stack);
  expect(details).toContain("Caused by: Error: disk I/O error");
});

it("handles circular causes and non-JSON rejections without losing the failure screen", () => {
  const error = new Error("Failure");
  error.cause = error;
  expect(describeStartupError(error)).toContain("[Circular error cause]");
  const object: { self?: unknown } = {};
  object.self = object;
  expect(describeStartupError(object)).toBe("[object Object]");
  expect(describeStartupError(undefined)).toBe("undefined");
});

it("displays selectable read-only diagnostics with the version and existing recovery guidance", () => {
  const html = renderToStaticMarkup(<StorageError error="SQLite transaction owner mismatch" />);
  expect(html).toContain("Unable to open study data");
  expect(html).toContain("Your study data has not been deleted.");
  expect(html).toContain(`Shunhen ${packageMetadata.version}`);
  expect(html).toContain("SQLite transaction owner mismatch");
  expect(html).toContain('for="storage-error-details"');
  expect(html).toMatch(/readonly=""/i);
});

it("renders diagnostic text literally rather than interpreting HTML", () => {
  const html = renderToStaticMarkup(<StorageError error='<script>alert("test")</script>' />);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});
