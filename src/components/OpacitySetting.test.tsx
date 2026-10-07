// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OpacitySetting } from "./OpacitySetting";
it.each(["Background opacity", "Border opacity"])(
  "%s updates immediately and coalesces drag writes without snapping to old stored values",
  async (label) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const resolutions: Array<() => void> = [],
      save = vi.fn((_value: number) => new Promise<void>((resolve) => resolutions.push(resolve)));
    const render = async (value: number) =>
      act(async () => root.render(<OpacitySetting label={label} value={value} step={1} onChange={save} />));
    const input = () => host.querySelector<HTMLInputElement>("input")!;
    const change = async (value: number) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), String(value));
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
    try {
      await render(0);
      await change(40);
      expect(input().value).toBe("40");
      expect(host.textContent).toContain("40%");
      expect(save).toHaveBeenCalledWith(40);
      await change(60);
      await change(95);
      await render(0);
      expect(input().value).toBe("95");
      expect(save).toHaveBeenCalledTimes(1);
      await act(async () => resolutions.shift()!());
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith(95);
      await render(40);
      expect(input().value).toBe("95");
      await act(async () => resolutions.shift()!());
      await render(95);
      await change(0);
      expect(input().value).toBe("0");
      expect(host.textContent).toContain("0%");
      await act(async () => resolutions.shift()!());
      await render(0);
      await render(100);
      expect(input().value).toBe("100");
      expect(host.textContent).toContain("100%");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
