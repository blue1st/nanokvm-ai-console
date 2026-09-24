import fs from 'node:fs';
import path from 'node:path';
import electronPkg from 'electron';
import type { AppConfig } from '../src/types';

// Safely access app whether running in Electron or pure Node.js test environment
const app = typeof electronPkg === 'object' && electronPkg !== null
  ? (electronPkg.app || (electronPkg as unknown as { default?: { app?: typeof electronPkg.app } }).default?.app)
  : undefined;

const DEFAULT_SYSTEM_PROMPT = `あなたはNanoKVM Goを介してターゲットPCを遠隔操作・サポートするAIアシスタントです。
利用可能なMCPツールを使用して、PCの画面確認、キーボード入力、マウス操作、電源管理などを実行できます。

【重要指針】
1. 操作を行う前に、まずは画面キャプチャツール等で現在の画面状態を確認してください。
2. 画面上のボタンやUI要素の位置を確認してからクリックや入力を行ってください。
3. リスクの高い操作（再起動、シャットダウン、ファイル削除など）を行う場合は、実行前にユーザーの意図を確認または明示してください。
4. ツールの実行結果を分かりやすくユーザーに報告してください。`;

export const DEFAULT_CONFIG: AppConfig = {
  llama: {
    baseUrl: 'http://localhost:8080',
    model: '',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    timeoutSeconds: 180,
  },
  nanokvm: {
    endpoint: 'https://192.168.1.45/api/mcp',
    apiKey: '',
    insecureSkipVerify: true,
  },
  stepExecutionMode: false,
  maxScreenshots: 30,
};

export class ConfigStore {
  private configPath: string;
  private config: AppConfig;

  constructor() {
    const userDataPath = app?.getPath ? app.getPath('userData') : process.cwd();
    this.configPath = path.join(userDataPath, 'config.json');
    this.config = this.load();
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public saveConfig(newConfig: Partial<AppConfig>): AppConfig {
    this.config = {
      llama: {
        ...this.config.llama,
        ...(newConfig.llama || {}),
      },
      nanokvm: {
        ...this.config.nanokvm,
        ...(newConfig.nanokvm || {}),
      },
      stepExecutionMode:
        newConfig.stepExecutionMode !== undefined
          ? newConfig.stepExecutionMode
          : this.config.stepExecutionMode,
      maxScreenshots:
        newConfig.maxScreenshots !== undefined
          ? newConfig.maxScreenshots
          : this.config.maxScreenshots,
    };

    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save config:', err);
    }

    return this.getConfig();
  }

  private load(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          llama: { ...DEFAULT_CONFIG.llama, ...(parsed.llama || {}) },
          nanokvm: { ...DEFAULT_CONFIG.nanokvm, ...(parsed.nanokvm || {}) },
          stepExecutionMode:
            parsed.stepExecutionMode !== undefined
              ? parsed.stepExecutionMode
              : DEFAULT_CONFIG.stepExecutionMode,
          maxScreenshots:
            parsed.maxScreenshots !== undefined
              ? parsed.maxScreenshots
              : DEFAULT_CONFIG.maxScreenshots,
        };
      }
    } catch (err) {
      console.error('Failed to read config file, falling back to default:', err);
    }
    return { ...DEFAULT_CONFIG };
  }
}
