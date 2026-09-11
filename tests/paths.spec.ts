import { afterEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";

afterEach(() => {
  delete process.env.JOB_HUNTER_DATA_DIR;
  delete process.env.JOB_HUNTER_DB_PATH;
  delete process.env.SCHEDULER_CONFIG_PATH;
  vi.resetModules();
});

describe("runtime paths", () => {
  it("derive the default data path from the module instead of cwd", async () => {
    const originalCwd = process.cwd();
    process.chdir(resolve(originalCwd, ".."));
    try {
      const paths = await import("../src/paths.js");
      expect(paths.DATA_DIR).toBe(join(paths.PROJECT_ROOT, "src", "data"));
      expect(paths.DB_PATH).toBe(join(paths.PROJECT_ROOT, "src", "data", "db.json"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("honors explicit data and database overrides", async () => {
    const customData = resolve("tmp", "job-hunter-data");
    const customDb = resolve("tmp", "job-hunter-db.json");
    process.env.JOB_HUNTER_DATA_DIR = customData;
    process.env.JOB_HUNTER_DB_PATH = customDb;

    const paths = await import("../src/paths.js");
    expect(paths.DATA_DIR).toBe(customData);
    expect(paths.DB_PATH).toBe(customDb);
    expect(paths.SCHEDULER_CONFIG_PATH).toBe(join(customData, "scheduler-config.json"));
  });

  it("rejects relative overrides instead of resolving them from the caller cwd", async () => {
    process.env.JOB_HUNTER_DATA_DIR = join("relative", "data");
    vi.resetModules();

    await expect(import("../src/paths.js")).rejects.toThrow("JOB_HUNTER_DATA_DIR must be an absolute path");
  });
});
