import { describe, expect, it } from "vitest";
import { discoveryHttpError } from "../src/discovery-errors.js";

describe("discoveryHttpError", () => {
  it("guides the operator to the board/company identifier on a 404", () => {
    const err = discoveryHttpError(
      "Greenhouse API",
      404,
      "Check that the board name in your configuration is correct.",
    );
    expect(err.message).toContain("HTTP 404");
    expect(err.message).toContain("board name");
    expect(err.message).not.toContain("respondio");
  });

  it("still reports a 404 without a provider-specific hint", () => {
    const err = discoveryHttpError("Remotive API", 404);
    expect(err.message).toBe("Remotive API returned HTTP 404 (not found).");
  });

  it("tells the operator to retry later on an upstream server error", () => {
    for (const status of [500, 502, 503]) {
      const err = discoveryHttpError("Lever API", status);
      expect(err.message).toContain(`HTTP ${status}`);
      expect(err.message).toContain("server error");
      expect(err.message).toContain("retry later");
    }
  });

  it("tells the operator to wait and retry on a rate limit", () => {
    const err = discoveryHttpError("Remotive API", 429);
    expect(err.message).toContain("HTTP 429");
    expect(err.message).toContain("rate limited");
    expect(err.message).toContain("retry");
  });

  it("falls back to a retry/connectivity hint for any other status", () => {
    for (const status of [400, 401, 403]) {
      const err = discoveryHttpError("Greenhouse API", status);
      expect(err.message).toContain(`HTTP ${status}`);
      expect(err.message).toContain("check your network connectivity");
    }
  });

  it("preserves the original status code in every message", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
      expect(discoveryHttpError("Lever API", status).message).toContain(String(status));
    }
  });
});
