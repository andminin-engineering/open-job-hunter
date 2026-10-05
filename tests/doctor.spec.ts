import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const doctor = join(projectRoot, "scripts", "doctor.mjs");
let fakeHome: string | undefined;

afterEach(async () => {
  if (fakeHome) await rm(fakeHome, { recursive: true, force: true });
  fakeHome = undefined;
});

describe("doctor", () => {
  it("does not print the home directory or user name of the person running it", async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "doctor-home-private-user-"));
    const dataDir = join(fakeHome, "Users", "private-user", "open-job-hunter-data");
    const { stdout } = await run(process.execPath, [doctor], {
      env: {
        ...process.env,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        JOB_HUNTER_DATA_DIR: dataDir,
        PROFILE_PATH: join(dataDir, "profile.json"),
        OLLAMA_BASE_URL: "http://127.0.0.1:1",
      },
    }).catch((error) => error);

    expect(stdout).toContain("directorio de datos");
    expect(stdout).not.toContain(fakeHome);
    expect(stdout).not.toContain("private-user");
    expect(stdout).not.toContain(join(projectRoot, "build"));
  });
});
