// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useSidebarLayout } from "./useSidebarLayout";

let host: HTMLDivElement, root: Root;
const originalWidth = window.innerWidth;
function Layout() {
  const { hidden, collapsed, toggle } = useSidebarLayout();
  return hidden ? <span>Hidden</span> : <button onClick={toggle} aria-expanded={!collapsed}>Menu</button>;
}
function width(value: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value });
}
async function resize(value: number) {
  await act(async () => {
    width(value);
    window.dispatchEvent(new Event("resize"));
  });
}
const menu = () => host.querySelector("button");
const toggle = () => act(async () => menu()!.click());

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  width(originalWidth);
});

it.each([1920, 1536, 1280])("allows expanding and collapsing at %i logical pixels", async (value) => {
  width(value);
  await act(async () => root.render(<Layout />));
  expect(menu()).not.toBeNull();
  if (menu()!.getAttribute("aria-expanded") === "true") await toggle();
  expect(menu()!.getAttribute("aria-expanded")).toBe("false");
  await toggle();
  expect(menu()!.getAttribute("aria-expanded")).toBe("true");
});

it("keeps the toggle available in the previously hidden 1041–1200 range", async () => {
  width(1200);
  await act(async () => root.render(<Layout />));
  await toggle();
  expect(menu()!.getAttribute("aria-expanded")).toBe("true");
  await resize(1041);
  expect(menu()!.getAttribute("aria-expanded")).toBe("true");
});

it("automatically collapses on narrower windows until the user makes a choice", async () => {
  width(1440);
  await act(async () => root.render(<Layout />));
  expect(menu()!.getAttribute("aria-expanded")).toBe("true");
  await resize(1280);
  expect(menu()!.getAttribute("aria-expanded")).toBe("false");
  await resize(1440);
  expect(menu()!.getAttribute("aria-expanded")).toBe("true");
});

it("preserves manual expansion when resized within the automatic-collapse range", async () => {
  width(1280);
  await act(async () => root.render(<Layout />));
  await toggle();
  await resize(1200);
  expect(menu()!.getAttribute("aria-expanded")).toBe("true");
});

it("preserves manual collapse after widening", async () => {
  width(1440);
  await act(async () => root.render(<Layout />));
  await toggle();
  await resize(1920);
  expect(menu()!.getAttribute("aria-expanded")).toBe("false");
});

it("hides the sidebar at the narrow cutoff and restores the manual choice when widened", async () => {
  width(1280);
  await act(async () => root.render(<Layout />));
  await toggle();
  await resize(1040);
  expect(menu()).toBeNull();
  await resize(1280);
  expect(menu()!.getAttribute("aria-expanded")).toBe("true");
});
