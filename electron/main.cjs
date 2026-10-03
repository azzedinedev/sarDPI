/**
 * Squelette Électron (hors-ligne bureau) — NON packagé en v1, mais le chemin est prêt :
 *  - ouvre l’app Next démarrée en local par le process Electron (ou une build static+server embarquée) ;
 *  - données dans userData/ : on force DATA_ADAPTER=json + SARDPI_ROOT userData (mono-poste, chiffrable ENC_KEYS).
 * Lancement manuel (dév) :  npx electron .   (après `npm i -D electron`)
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEV_URL = process.env.SARDPI_URL || 'http://127.0.0.1:3000';
let win = null;
let server = null;

function startEmbeddedServer() {
  // En local-only : on délègue à `npm run start` dans apps/web avec les variables du profil de données.
  const webDir = path.join(__dirname, '..', 'apps', 'web');
  server = spawn('npm', ['run', 'start'], {
    cwd: webDir,
    env: {
      ...process.env,
      DATA_ADAPTER: 'json',
      SARDPI_ROOT: path.join(app.getPath('userData'), 'sardpi'),
      AUTH_SECRET: process.env.AUTH_SECRET || 'electron-local',
    },
    stdio: 'inherit',
  });
  server.on('exit', () => app.quit());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#f3f8fa',
    title: 'sarDPI',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(DEV_URL);
}

app.whenReady().then(() => {
  if (!process.env.SARDPI_URL) startEmbeddedServer();
  createWindow();
});
app.on('window-all-closed', () => {
  if (server) server.kill('SIGTERM');
  app.quit();
});
