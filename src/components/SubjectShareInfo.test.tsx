// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { SubjectShareInfo } from "./SubjectShareInfo";
import "../i18n";

it("exposes the omitted-period explanation from the title icon for keyboard users", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<SubjectShareInfo />));
    expect(host.querySelector("svg")?.getAttribute("aria-label")).toBe("Periods without study data are omitted.");
    const trigger = host.querySelector('[tabindex="0"]')!;
    await act(async () => trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Periods without study data are omitted.");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
