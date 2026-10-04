import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type SqlValue = string | number | boolean | null;
export type SqlRow = Record<string, SqlValue>;
export type Request = (
  action: "begin" | "commit" | "rollback" | "select" | "execute",
  token?: string,
  sql?: string,
  parameters?: SqlValue[],
) => Promise<unknown>;
export const nativeRequest: Request = (action, token, sql, parameters) =>
  invoke("storage_request", { action, token: token ?? null, sql: sql ?? null, parameters: parameters ?? [] });
const subscribers = new Set<() => void>();
export function changed() {
  for (const subscriber of subscribers) subscriber();
}
let listening = false;
export function subscribe(callback: () => void) {
  subscribers.add(callback);
  if (!listening && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    listening = true;
    void listen("storage-changed", changed).catch(() => {
      listening = false;
    });
  }
  return () => {
    subscribers.delete(callback);
  };
}
export class Connection {
  constructor(
    readonly request: Request = nativeRequest,
    readonly token?: string,
  ) {}
  async select<T = SqlRow>(sql: string, parameters: SqlValue[] = []): Promise<T[]> {
    return (await this.request("select", this.token, sql, parameters)) as T[];
  }
  async execute(sql: string, parameters: SqlValue[] = []): Promise<{ id: number; affected: number }> {
    return (await this.request("execute", this.token, sql, parameters)) as { id: number; affected: number };
  }
}
// A single lock shared by every webview; a callback receives a scoped connection
// so nested transactions never acquire another lock or leak transaction context.
export async function withStorageLock<T>(callback: () => Promise<T>) {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("shunhen-sqlite", callback);
  // Tests inject their own connection; production Tauri WebViews support Web Locks.
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await callback();
  } finally {
    release();
  }
}
let queue = Promise.resolve();
