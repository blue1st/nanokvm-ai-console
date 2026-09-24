export interface AppConfig {
  llama: {
    baseUrl: string; // e.g. http://192.168.1.100:8080
    model: string;
    apiKey: string;
    temperature: number;
    maxTokens: number;
    systemPrompt: string;
    timeoutSeconds?: number; // e.g. 180 (3 min) or 300 (5 min) for local LLMs
  };
  nanokvm: {
    endpoint: string; // e.g. https://<NanoKVM-IP>/api/mcp
    apiKey: string;
    insecureSkipVerify: boolean; // default true for self-signed certificates
  };
  stepExecutionMode?: boolean; // Step-by-step approval mode before executing tools
  maxScreenshots?: number; // Maximum screenshots to retain (older screenshot image data is discarded)
}

export interface MCPToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  [key: string]: unknown;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, MCPToolParameterProperty>;
    required?: string[];
  };
}

export interface ToolCallItem {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: {
    text?: string;
    image?: string; // data:image/png;base64,...
    isError?: boolean;
  };
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'skipped';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallItem[];
  images?: string[]; // array of base64 data URLs
}

export interface ConnectionStatus {
  llm: {
    connected: boolean;
    model?: string;
    error?: string;
  };
  mcp: {
    connected: boolean;
    toolCount: number;
    error?: string;
  };
}

export interface ScreenshotHistoryItem {
  id: string;
  timestamp: number;
  imageUrl: string;
  messageId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  marker?: {
    x: number;
    y: number;
    label?: string;
  };
}

export interface MCPToolCallResult {
  text?: string;
  image?: string;
  isError?: boolean;
}

export interface JobExecutionLog {
  id: string;
  jobId: string;
  jobName: string;
  mode: 'prompt' | 'watchdog';
  timestamp: number;
  durationMs: number;
  success: boolean;
  summary: string;
  matched?: boolean;           // For watchdog: whether condition matched
  confidence?: number;        // AI confidence score (0.0 - 1.0)
  reason?: string;            // AI explanation / reason
  screenshotUrl?: string;     // Base64 screenshot captured during run
  actionTaken?: string;       // Details of action taken if any
  error?: string;
}

export interface ScheduledJob {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;

  trigger: {
    type: 'interval' | 'once' | 'cron';
    intervalMinutes?: number;  // e.g. 5 (every 5 min)
    runAt?: string;            // ISO date string e.g. "2026-09-24T18:00:00"
    cronExpression?: string;   // e.g. "0 2 * * *"
  };

  mode: 'prompt' | 'watchdog';

  // For mode === 'prompt'
  promptConfig?: {
    prompt: string;
    systemPromptOverride?: string;
  };

  // For mode === 'watchdog' ("When X happens, do Y")
  watchdogConfig?: {
    condition: string;          // Natural language condition, e.g. "Blue screen of death or system crash"
    onMatched: {
      notify: boolean;          // Send OS desktop notification
      notificationTitle?: string;
      notificationBody?: string;
      actionType: 'none' | 'mcp_tool' | 'prompt';
      toolName?: string;        // e.g. "press_power" or "power_reset"
      toolArgs?: Record<string, unknown>;
      followUpPrompt?: string;  // e.g. "Enter the password and press Enter"
      autoDisableAfterMatch: boolean; // One-shot watchdog (disable once matched)
    };
  };

  policy?: {
    timeoutSeconds?: number;
    maxSteps?: number;
  };

  lastResult?: {
    timestamp: number;
    success: boolean;
    summary: string;
    matched?: boolean;
    error?: string;
  };
}
