import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let testDir: string | undefined;

afterEach(async () => {
  delete process.env.JOB_HUNTER_DB_PATH;
  vi.resetModules();
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = undefined;
});

async function databaseAtTemporaryPath() {
  testDir = await mkdtemp(join(tmpdir(), "mcp-job-hunter-db-"));
  const dbPath = join(testDir, "nested", "db.json");
  process.env.JOB_HUNTER_DB_PATH = dbPath;
  vi.resetModules();
  return { dbPath, database: await import("../src/database.js") };
}

describe("database persistence", () => {
  it("treats only a missing database as empty and creates its directory on save", async () => {
    const { database } = await databaseAtTemporaryPath();
    expect(await database.leerBaseDatos()).toEqual([]);

    const saved = await database.guardarOferta({
      oferta: "Senior TypeScript engineer for a distributed platform team",
      sourcePlatform: "test",
      estado: "nueva",
    });

    expect((await database.leerBaseDatos()).map((item) => item.id)).toEqual([saved.id]);
  });

  it("reports corrupt JSON instead of silently replacing it with an empty database", async () => {
    const { dbPath, database } = await databaseAtTemporaryPath();
    await writeFile(dbPath, "not-json", "utf-8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(dbPath), { recursive: true });
      await writeFile(dbPath, "not-json", "utf-8");
    });

    await expect(database.leerBaseDatos()).rejects.toThrow("Could not read database");
  });

  it("preserves every offer written concurrently", async () => {
    const { database } = await databaseAtTemporaryPath();
    const total = 40;

    await Promise.all(Array.from({ length: total }, (_, index) => database.guardarOferta({
      oferta: `Concurrent TypeScript role number ${index}`,
      sourcePlatform: "concurrency-test",
      company: `Company ${index}`,
      estado: "nueva",
    })));

    const stored = await database.leerBaseDatos();
    expect(stored).toHaveLength(total);
    expect(new Set(stored.map((item) => item.id)).size).toBe(total);
  });

  it("does not remove an aged lock while its owner process is alive", async () => {
    const { dbPath, database } = await databaseAtTemporaryPath();
    const lockPath = `${dbPath}.lock`;
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      pid: process.pid,
      token: "live-owner",
      createdAt: new Date(0).toISOString(),
    }));
    await utimes(lockPath, new Date(0), new Date(0));

    const pendingWrite = database.guardarOferta({
      oferta: "Write waiting for a live lock owner",
      sourcePlatform: "lock-test",
      estado: "nueva",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((await stat(lockPath)).isDirectory()).toBe(true);
    expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf-8")).token).toBe("live-owner");
    await rm(lockPath, { recursive: true, force: true });
    await expect(pendingWrite).resolves.toBeDefined();
  });

  it("recovers an aged lock only when its owner process is gone", async () => {
    const { dbPath, database } = await databaseAtTemporaryPath();
    const lockPath = `${dbPath}.lock`;
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      pid: 2_147_483_647,
      token: "dead-owner",
      createdAt: new Date(0).toISOString(),
    }));
    await utimes(lockPath, new Date(0), new Date(0));

    await expect(database.guardarOferta({
      oferta: "Write recovering a dead owner lock",
      sourcePlatform: "lock-test",
      estado: "nueva",
    })).resolves.toBeDefined();
  });
});
