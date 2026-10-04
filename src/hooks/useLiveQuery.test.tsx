// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useLiveQuery } from "./useLiveQuery";
import { changed } from "../storage/connection";

it("refreshes on committed storage changes without repeated reads on unrelated renders", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"),
    root = createRoot(host);
  let value = 1,
    reads = 0;
  function View() {
    const result = useLiveQuery(async () => {
      reads++;
      return value;
    }, []);
    return <span>{result}</span>;
  }
  await act(async () => root.render(<View />));
  expect(host.textContent).toBe("1");
  await act(async () => root.render(<View />));
  expect(reads).toBe(1);
  value = 2;
  await act(async () => changed());
  expect(host.textContent).toBe("2");
  await act(async () => root.unmount());
});

it("ignores an older pending query when a newer committed snapshot has arrived", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"),
    root = createRoot(host);
  let resolve!: (value: number) => void,
    reads = 0;
  function View() {
    const result = useLiveQuery(
      () =>
        ++reads === 1
          ? new Promise<number>((done) => {
              resolve = done;
            })
          : Promise.resolve(2),
      [],
    );
    return <span>{result}</span>;
  }
  await act(async () => root.render(<View />));
  await act(async () => changed());
  expect(host.textContent).toBe("2");
  await act(async () => resolve(1));
  expect(host.textContent).toBe("2");
  await act(async () => root.unmount());
});
