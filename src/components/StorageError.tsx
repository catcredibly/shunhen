import { useTranslation } from "react-i18next";
import packageMetadata from "../../package.json";

export function describeStartupError(error: unknown, seen = new Set<unknown>()): string {
  if (seen.has(error)) return "[Circular error cause]";
  seen.add(error);
  if (error instanceof Error) {
    const details = error.stack || `${error.name}: ${error.message}`;
    return error.cause === undefined ? details : `${details}\nCaused by: ${describeStartupError(error.cause, seen)}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2) ?? String(error);
  } catch {
    return String(error);
  }
}

export function StorageError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const details = `Shunhen ${packageMetadata.version}\nStudy storage initialization failed.\n\n${describeStartupError(error)}`;
  return (
    <main className="page storage-error-page">
      <section className="empty-state storage-error" role="alert">
        <h2>{t("Unable to open study data")}</h2>
        <p>{t("Restart Shunhen to retry. Your study data has not been deleted.")}</p>
        <label htmlFor="storage-error-details">{t("Error details")}</label>
        <textarea
          id="storage-error-details"
          className="storage-error-details"
          readOnly
          value={details}
          spellCheck={false}
        />
        <p>{t("Include these details when reporting this problem.")}</p>
      </section>
    </main>
  );
}
