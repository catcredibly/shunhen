import { useEffect, useRef, useState, type DependencyList } from "react";
import { subscribe } from "../storage/connection";

/** Re-run read-only queries after committed writes in either timer window. */
export function useLiveQuery<T>(query: () => T | Promise<T>, dependencies: DependencyList = []): T | undefined {
  const [value, setValue] = useState<T>();
  const latest = useRef(query);
  latest.current = query;
  useEffect(() => {
    let active = true,
      revision = 0;
    const refresh = () => {
      const request = ++revision;
      void Promise.resolve()
        .then(() => latest.current())
        .then((result) => {
          if (active && request === revision) setValue(result);
        })
        .catch(console.error);
    };
    const unsubscribe = subscribe(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, dependencies);
  return value;
}
