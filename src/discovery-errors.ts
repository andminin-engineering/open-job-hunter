/** Builds the error thrown when a job-discovery provider returns a non-success HTTP status.
 *
 * The message is concise and actionable: it tells the operator whether to retry, check the
 * board/company identifier, or verify connectivity, and it always preserves the original status
 * code. It never includes the response body, which may contain untrusted or sensitive content. */
export function discoveryHttpError(
  provider: string,
  status: number,
  notFoundAction?: string,
): Error {
  if (status === 404) {
    const hint = notFoundAction ? ` ${notFoundAction}` : "";
    return new Error(`${provider} returned HTTP 404 (not found).${hint}`);
  }
  if (status === 429) {
    return new Error(`${provider} returned HTTP 429 (rate limited). Wait a moment and retry.`);
  }
  if (status >= 500) {
    return new Error(`${provider} returned HTTP ${status} (server error). The provider is having trouble; retry later.`);
  }
  return new Error(`${provider} returned HTTP ${status}. Retry, and if it persists check your network connectivity.`);
}
