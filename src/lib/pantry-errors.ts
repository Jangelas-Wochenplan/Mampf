const FALLBACK_MESSAGE = "Der Vorrat konnte nicht gespeichert werden. Bitte versuche es noch einmal.";

interface BackendError {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

function isBackendError(error: unknown): error is BackendError {
  return typeof error === "object" && error !== null;
}

function errorText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function pantryErrorMessage(error: unknown): string {
  if (isBackendError(error)) {
    const code = errorText(error.code);
    if (code === "PGRST205" || code === "42P01") {
      return "Die Vorratstabelle fehlt in Supabase. Führe supabase/setup_existing_database.sql im SQL Editor aus und lade die Seite neu.";
    }
    if (code === "PGRST202" || code === "PGRST204" || code === "42883" || code === "42703") {
      return "Die Vorrats-Kategorien oder die Mengen-Zusammenführung fehlen noch in Supabase. Führe supabase/migrations/20261118194100_pantry_categories_and_stock_merge.sql im SQL Editor aus und lade die Seite neu.";
    }
    if (code === "42501" || code === "PGRST301") {
      if (code === "PGRST301") {
        return "Deine Supabase-Sitzung ist abgelaufen. Melde dich ab und wieder an.";
      }
      return "Supabase verweigert den Zugriff auf die Vorräte. Prüfe, ob dein Konto Mitglied des Haushalts ist und die Vorrats-RLS-Policies eingerichtet sind.";
    }
    if (code === "23505") {
      return "Dieser Barcode ist im Haushalt bereits vergeben. Öffne den vorhandenen Vorrat oder verwende einen anderen Barcode.";
    }

    const message = error instanceof Error ? error.message : errorText(error.message);
    if (message && /bucket.{0,30}not found/i.test(message)) {
      return "Der private Bildspeicher für Vorräte fehlt in Supabase. Führe supabase/setup_existing_database.sql im SQL Editor aus.";
    }
    if (message) {
      const details = errorText(error.details);
      const hint = errorText(error.hint);
      const diagnostic = [details, hint].filter(Boolean).join(" ");
      const errorCode = code ? ` (${code})` : "";
      return `${message}${errorCode}${diagnostic ? ` ${diagnostic}` : ""}`;
    }
  }

  if (error instanceof Error && error.message) return error.message;
  return FALLBACK_MESSAGE;
}
