const { app, BrowserWindow, shell } = require("electron");
const { fork } = require("node:child_process");
const { createServer } = require("node:net");
const { constants } = require("node:fs");
const { copyFile, mkdir } = require("node:fs/promises");
const path = require("node:path");

let backend;
let mainWindow;
let quitting = false;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (backend?.exitCode !== null) throw new Error(`El backend termino con codigo ${backend?.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("El backend local no respondio dentro de 10 segundos");
}

function stopBackend() {
  if (backend && backend.exitCode === null) backend.kill();
  backend = undefined;
}

async function createApplication() {
  const port = await getFreePort();
  if (!port) throw new Error("No se pudo reservar un puerto local");
  const localUrl = `http://127.0.0.1:${port}`;
  const backendEntry = path.join(app.getAppPath(), "build", "bin", "http.js");
  const userDataPath = app.getPath("userData");
  const profilePath = path.join(userDataPath, "config", "profile.json");
  await mkdir(path.dirname(profilePath), { recursive: true });
  try {
    await copyFile(path.join(app.getAppPath(), "config", "profile.example.json"), profilePath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  backend = fork(backendEntry, [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      JOB_HUNTER_MODE: "http",
      JOB_HUNTER_DATA_DIR: path.join(userDataPath, "data"),
      PROFILE_PATH: profilePath,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    silent: true,
  });
  backend.stdout?.on("data", (chunk) => console.log(`[backend] ${chunk.toString().trimEnd()}`));
  backend.stderr?.on("data", (chunk) => console.error(`[backend] ${chunk.toString().trimEnd()}`));

  await waitForHealth(localUrl);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    title: "Open Job Hunter",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(localUrl)) event.preventDefault();
  });
  await mainWindow.loadURL(localUrl);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createApplication).catch((error) => {
    console.error("No se pudo iniciar MCP Job Hunter:", error);
    stopBackend();
    app.exit(1);
  });
}

app.on("before-quit", () => {
  quitting = true;
  stopBackend();
});
app.on("window-all-closed", () => {
  if (!quitting) app.quit();
});
