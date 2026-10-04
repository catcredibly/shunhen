/** Recognized historical namespaces remain distinct; SQLite IDs never enter this key. */
export function isSourceIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(session|legacy-session|csv-session|backup-session):.+$/s.test(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
export function requireSourceIdentity(value: unknown): string {
  if (!isSourceIdentity(value)) throw new Error("Invalid Session identities.");
  return value;
}
export const newSourceIdentity = () => `session:${crypto.randomUUID()}`;
