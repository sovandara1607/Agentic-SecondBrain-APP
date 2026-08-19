/**
 * Maps a raw error (a Postgres/PostgREST driver error, a fetch/network
 * failure, a thrown JS exception, or a FastAPI error body) to a short,
 * plain-language message that's safe to show directly in the UI.
 *
 * The point isn't to be clever about every possible error - it's that
 * nothing resembling a stack trace, a Postgres constraint name, or an
 * "Error: ..." wrapper should ever reach someone who isn't debugging
 * the app. Real detail still belongs in console.error at the call site
 * (or the server's own logs, for server actions/API routes) - this is
 * only for what a non-technical person reads.
 */
export function friendlyError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "";

  if (!raw) return "Something went wrong. Please try again.";

  const lower = raw.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed")
  ) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (
    lower.includes("jwt") ||
    lower.includes("unauthorized") ||
    lower.includes(" 401") ||
    lower.startsWith("401") ||
    lower.includes("session") ||
    lower.includes("not authenticated")
  ) {
    return "Your session has expired. Please sign in again.";
  }
  if (
    lower.includes("permission denied") ||
    lower.includes("row-level security") ||
    lower.includes(" 403") ||
    lower.startsWith("403") ||
    lower.includes("forbidden")
  ) {
    return "You don't have permission to do that.";
  }
  if (lower.includes("duplicate key") || lower.includes("already exists") || lower.includes("unique constraint")) {
    return "That already exists.";
  }
  if (lower.includes("violates foreign key") || lower.includes("not found") || lower.includes(" 404")) {
    return "That couldn't be found - it may have been deleted.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "That took too long. Please try again.";
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota")
  ) {
    return "The AI service is temporarily busy. Please try again in a moment.";
  }
  if (lower.includes("500") || lower.includes("internal server error")) {
    return "Something went wrong on our end. Please try again.";
  }

  // A short message with no stack-trace shape ("at file:line:col", or
  // multiple lines) usually already reads like plain language - pass
  // those through rather than losing genuinely useful detail (e.g. a
  // Zod/form validation message) to an overly broad fallback.
  if (raw.length <= 120 && !/\bat\s+\S+:\d+:\d+/.test(raw) && !raw.includes("\n")) {
    return raw;
  }
  return "Something went wrong. Please try again.";
}
