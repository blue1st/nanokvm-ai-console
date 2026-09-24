import electron from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import path from 'node:path';
import dns from 'node:dns';
import fs from 'node:fs';
import { execSync, fork, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ConfigStore } from './store';
import { JobStore } from './job-store';
import { SchedulerEngine } from './scheduler-engine';
import type {
  AppConfig,
  ChatMessage,
  ConnectionStatus,
  MCPTool,
  ScheduledJob,
  UpdateCheckResult,
} from '../src/types';

function findSystemNodePath(): string {
  try {
    const whichOut = execSync('which node', { encoding: 'utf-8', env: process.env }).trim();
    if (whichOut && fs.existsSync(whichOut)) {
      return whichOut;
    }
  } catch {}

  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  return process.execPath;
}

// Prefer IPv4 for local LAN endpoints
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {
  console.warn('Could not set dns default result order:', e);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { app, BrowserWindow, ipcMain, shell, Menu } = electron;

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public');

let win: BrowserWindowType | null = null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template: electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const, label: 'About NanoKVM AI Console' },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit NanoKVM AI Console' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

const store = new ConfigStore();
const jobStore = new JobStore();
let scheduler: SchedulerEngine | null = null;

/**
 * NetworkWorkerManager manages a child process running with system Node CLI.
 * This completely isolates networking from macOS Sequoia's GUI TCC local network restrictions.
 */
class NetworkWorkerManager {
  private worker: ChildProcess | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  private streamListeners = new Map<string, (event: any) => void>();
  private nextId = 1;

  public start() {
    let workerPath = path.join(__dirname, 'network-worker.cjs');
    if (workerPath.includes('app.asar')) {
      const unpackedPath = workerPath.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedPath)) {
        workerPath = unpackedPath;
      }
    }
    const nodeExecPath = findSystemNodePath();
    console.log(`[Main] Launching Network Worker via: ${nodeExecPath} with ${workerPath}`);
    this.worker = fork(workerPath, [], {
      execPath: nodeExecPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    this.worker.on('message', (msg: any) => {
      if (!msg || !msg.id) return;

      if (msg.action === 'main:downscaleImage') {
        try {
          const { dataUrl, maxDim = 1024 } = msg.payload || {};
          const img = electron.nativeImage.createFromDataURL(dataUrl);
          const size = img.getSize();
          let width = size.width;
          let height = size.height;
          if (width > 0 && height > 0 && (width > maxDim || height > maxDim)) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const resized = img.resize({ width, height, quality: 'better' });
          const buffer = resized.toJPEG(85);
          const downscaled = `data:image/jpeg;base64,${buffer.toString('base64')}`;
          console.log(`[Main] Downscaled screenshot from ${size.width}x${size.height} (${Math.round((dataUrl?.length || 0) / 1024)} KB) to ${width}x${height} (${Math.round(downscaled.length / 1024)} KB)`);
          this.worker?.send({ id: msg.id, success: true, data: downscaled });
        } catch (err: unknown) {
          console.error('[Main Error] Downscaling failed:', err);
          const errMsg = err instanceof Error ? err.message : String(err);
          this.worker?.send({ id: msg.id, success: false, error: errMsg });
        }
        return;
      }

      if (msg.isStreamEvent) {
        const listener = this.streamListeners.get(msg.id);
        if (listener) {
          listener(msg.event);
        }
        return;
      }

      if (msg.isStreamComplete) {
        this.streamListeners.delete(msg.id);
      }

      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.success) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || 'Worker request failed'));
        }
      }
    });

    this.worker.on('exit', (code) => {
      console.warn(`Network worker exited with code ${code}, restarting...`);
      this.worker = null;
      setTimeout(() => this.start(), 1000);
    });

    this.worker.stdout?.on('data', (d) => console.log('[Worker]', d.toString().trim()));
    this.worker.stderr?.on('data', (d) => console.error('[Worker Error]', d.toString().trim()));
  }

  public send<T = any>(action: string, payload?: any): Promise<T> {
    const id = `req_${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker?.send({ id, action, payload });
    });
  }

  public stream(action: string, payload: any, onEvent: (event: any) => void): Promise<void> {
    const id = `stream_${this.nextId++}`;
    this.streamListeners.set(id, onEvent);
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: () => resolve(),
        reject: (err) => {
          this.streamListeners.delete(id);
          reject(err);
        },
      });
      this.worker?.send({ id, action, payload });
    });
  }

  public stop() {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
  }
}

const workerMgr = new NetworkWorkerManager();

function getAppIconPath(): string {
  const candidates = [
    path.join(__dirname, '../build/icon.png'),
    path.join(process.resourcesPath || '', 'build/icon.png'),
    path.join(process.env.DIST || '', '../build/icon.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return path.join(__dirname, '../build/icon.png');
}

function createWindow() {
  const iconPath = getAppIconPath();

  win = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: 'NanoKVM AI Console',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    const distPath = process.env.DIST || path.join(__dirname, '../dist');
    win.loadFile(path.join(distPath, 'index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (scheduler) {
    scheduler.stop();
  }
  workerMgr.stop();
});

app.whenReady().then(async () => {
  // Set application menu for macOS and general keyboard shortcuts
  setupApplicationMenu();

  // Set macOS Dock Icon if available
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = getAppIconPath();
    if (fs.existsSync(iconPath)) {
      try {
        app.dock.setIcon(iconPath);
      } catch (e) {
        console.warn('Could not set dock icon:', e);
      }
    }
  }

  // Start the background network worker
  workerMgr.start();

  createWindow();

  // Initialize and start scheduler engine
  scheduler = new SchedulerEngine({
    store: jobStore,
    configStore: store,
    workerMgr,
    getWindow: () => win,
  });
  scheduler.start();

  // Initialize worker with saved config
  const initialConfig = store.getConfig();
  workerMgr.send('init', {
    llama: initialConfig.llama,
    nanokvm: initialConfig.nanokvm,
  }).catch((err) => {
    console.warn('Initial worker init warning:', err);
  });
});

// Automatically allow self-signed certificates for NanoKVM endpoints
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  const config = store.getConfig();
  if (config.nanokvm.insecureSkipVerify) {
    try {
      const endpointHost = new URL(config.nanokvm.endpoint).hostname;
      const targetHost = new URL(url).hostname;
      if (endpointHost === targetHost || targetHost === '127.0.0.1' || targetHost === 'localhost') {
        event.preventDefault();
        callback(true);
        return;
      }
    } catch {
      // Fallback
    }
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

// IPC Handlers
ipcMain.handle('config:get', () => {
  return store.getConfig();
});

ipcMain.handle('config:save', async (_, newConfig: Partial<AppConfig>) => {
  const updated = store.saveConfig(newConfig);

  // Sync with worker
  await workerMgr.send('init', {
    llama: updated.llama,
    nanokvm: updated.nanokvm,
  });

  return updated;
});

ipcMain.handle('llama:getModels', async (_, baseUrl?: string, apiKey?: string) => {
  return workerMgr.send<string[]>('llama:getModels', { baseUrl, apiKey });
});

ipcMain.handle('llama:test', async (_, baseUrl: string, apiKey: string) => {
  try {
    const models = await workerMgr.send<string[]>('llama:test', { baseUrl, apiKey });
    if (!models || models.length === 0) {
      return {
        success: false,
        models: [],
        error: 'llama.cpp サーバーに接続できましたが、利用可能なモデルが 0 件でした。',
      };
    }
    const currentConfig = store.getConfig();
    if (!currentConfig.llama.model && models.length > 0) {
      store.saveConfig({ llama: { ...currentConfig.llama, model: models[0] } });
    }
    return {
      success: true,
      models,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      models: [],
      error: `接続失敗: ${msg}`,
    };
  }
});

ipcMain.handle(
  'mcp:connect',
  async (_, endpoint: string, apiKey: string, insecureSkipVerify: boolean) => {
    try {
      const res = await workerMgr.send('mcp:connect', { endpoint, apiKey, insecureSkipVerify });
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, toolCount: 0, error: msg };
    }
  }
);

ipcMain.handle('mcp:disconnect', async () => {
  await workerMgr.send('mcp:disconnect');
});

ipcMain.handle('mcp:getTools', async () => {
  return workerMgr.send<MCPTool[]>('mcp:getTools');
});

ipcMain.handle(
  'mcp:callTool',
  async (_, name: string, args?: Record<string, unknown>) => {
    try {
      const res = await workerMgr.send('mcp:callTool', { name, args: args || {} });
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { isError: true, text: msg };
    }
  }
);

ipcMain.handle('app:openExternal', async (_, targetUrl: string) => {
  if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    await shell.openExternal(targetUrl);
  }
});

function getProxyScriptPath(): string {
  // 1. If running in development or from source repo
  const devPath = path.join(__dirname, '../bin/nanokvm-mcp-proxy.js');
  if (fs.existsSync(devPath)) {
    return path.resolve(devPath);
  }

  // 2. If packaged with electron-builder and unpacked
  if (process.resourcesPath) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked/bin/nanokvm-mcp-proxy.js');
    if (fs.existsSync(unpackedPath)) {
      return path.resolve(unpackedPath);
    }
  }

  // 3. From appPath
  const appPath = app.getAppPath();
  const inAppPath = path.join(appPath, 'bin/nanokvm-mcp-proxy.js');
  if (fs.existsSync(inAppPath)) {
    return path.resolve(inAppPath);
  }

  return path.resolve(devPath);
}

ipcMain.handle('app:getProxyScriptPath', () => {
  return getProxyScriptPath();
});

function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('app:checkUpdate', async (): Promise<UpdateCheckResult> => {
  const currentVersion = app.getVersion();
  const repoUrl = 'https://api.github.com/repos/blue1st/nanokvm-ai-console/releases/latest';
  try {
    const res = await fetch(repoUrl, {
      headers: {
        'User-Agent': `NanoKVM-AI-Console/${currentVersion}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return {
          currentVersion,
          latestVersion: currentVersion,
          hasUpdate: false,
          releaseUrl: 'https://github.com/blue1st/nanokvm-ai-console/releases',
        };
      }
      throw new Error(`GitHub API returned status ${res.status}`);
    }

    const data: any = await res.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');
    const releaseUrl = data.html_url || 'https://github.com/blue1st/nanokvm-ai-console/releases';
    const hasUpdate = latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false;

    return {
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      hasUpdate,
      releaseUrl,
      releaseNotes: data.body || '',
      publishedAt: data.published_at,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: 'https://github.com/blue1st/nanokvm-ai-console/releases',
      error: msg,
    };
  }
});

ipcMain.handle('app:getStatus', async (): Promise<ConnectionStatus> => {
  const config = store.getConfig();
  try {
    const status = await workerMgr.send<ConnectionStatus>('app:getStatus');
    if (status.llm.connected && status.llm.model && !config.llama.model) {
      config.llama.model = status.llm.model;
      store.saveConfig({ llama: { ...config.llama, model: status.llm.model } });
    }
    return status;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      llm: { connected: false, error: err },
      mcp: { connected: false, toolCount: 0 },
    };
  }
});

ipcMain.handle(
  'chat:send',
  async (
    _,
    params: {
      history: ChatMessage[];
      content: string;
    }
  ) => {
    const config = store.getConfig();

    await workerMgr.stream(
      'chat:send',
      {
        history: params.history,
        content: params.content,
        config,
      },
      (event) => {
        if (!win || win.isDestroyed()) return;
        switch (event.type) {
          case 'token':
            win.webContents.send('chat:token', event.token);
            break;
          case 'tool_call_start':
            win.webContents.send('chat:tool_start', event.toolCall);
            break;
          case 'tool_call_waiting_approval':
            win.webContents.send('chat:tool_waiting_approval', event.toolCall);
            break;
          case 'tool_call_complete':
            win.webContents.send('chat:tool_complete', event.toolCall);
            break;
          case 'done':
            win.webContents.send('chat:done');
            break;
          case 'error':
            win.webContents.send('chat:error', event.error);
            break;
        }
      }
    );
  }
);

ipcMain.handle('chat:abort', async () => {
  return workerMgr.send('chat:abort');
});

ipcMain.handle(
  'chat:approveDecision',
  async (_, toolCallId: string, decision: 'approve' | 'skip' | 'abort') => {
    return workerMgr.send('chat:approveDecision', { toolCallId, decision });
  }
);

// Job / Scheduler IPC Handlers
ipcMain.handle('jobs:getAll', () => {
  return jobStore.getJobs();
});

ipcMain.handle('jobs:save', (_, job: ScheduledJob) => {
  const updated = jobStore.saveJob(job);
  return updated;
});

ipcMain.handle('jobs:delete', (_, id: string) => {
  return jobStore.deleteJob(id);
});

ipcMain.handle('jobs:toggle', (_, id: string, enabled?: boolean) => {
  return jobStore.toggleJob(id, enabled);
});

ipcMain.handle('jobs:triggerNow', async (_, id: string) => {
  if (scheduler) {
    return scheduler.runJobNow(id);
  }
  return null;
});

ipcMain.handle('jobs:getLogs', () => {
  return jobStore.getLogs();
});

ipcMain.handle('jobs:clearLogs', () => {
  jobStore.clearLogs();
  return [];
});
