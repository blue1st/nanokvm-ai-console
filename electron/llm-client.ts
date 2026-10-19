import http from 'node:http';
import https from 'node:https';
import type {
  ChatMessage,
  ToolCallItem,
  SystemOneConfig,
  SystemOneRiskMeta,
  SystemOneVerifyMeta,
  SystemOneWatchdogMeta,
  SystemOneTestResult,
} from '../src/types';
import type { NanoKVMMCPClient } from './mcp-client';

export interface SystemOneQuestion {
  type: 'choice' | 'score' | 'noul';
  instructions: string;
  criteria?: Record<string, string | null> | string[];
}

export interface SystemOneAnswer {
  type: 'choice' | 'score' | 'noul';
  choice?: string;
  score?: number;
  noul?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface SystemOneRawResponse {
  model?: string;
  answers?: Record<string, SystemOneAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface StreamEvent {
  type:
    | 'token'
    | 'tool_call_start'
    | 'tool_call_waiting_approval'
    | 'tool_call_complete'
    | 'done'
    | 'error';
  token?: string;
  toolCall?: ToolCallItem;
  error?: string;
}

/**
 * Robust HTTP/HTTPS request helper using standard node:http / node:https
 * Bypasses undici/fetch multi-homing EHOSTUNREACH routing issues on macOS
 */
import os from 'node:os';

let cachedWorkingLocalAddress: string | null = null;

function getLocalIPv4Addresses(targetHost?: string): string[] {
  const addresses: string[] = [];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      // Exclude virtual bridges, VPN tunnels, and Apple Wireless Direct Link
      if (
        name.startsWith('bridge') ||
        name.startsWith('utun') ||
        name.startsWith('awdl') ||
        name.startsWith('llw')
      ) {
        continue;
      }
      for (const iface of ifaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
  } catch {
    // fallback
  }

  // If targetHost is an IPv4 like 192.168.1.33, prioritize matching /24 subnet addresses
  if (targetHost && /^\d+\.\d+\.\d+\.\d+$/.test(targetHost)) {
    const subnetPrefix = targetHost.split('.').slice(0, 3).join('.');
    addresses.sort((a, b) => {
      const aMatches = a.startsWith(subnetPrefix);
      const bMatches = b.startsWith(subnetPrefix);
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });
  }

  return addresses;
}

/**
 * Raw HTTP/HTTPS request helper using standard node:http / node:https
 */
function rawHttpRequest(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    localAddress?: string;
  }
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const reqOptions: http.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      family: 4, // Force IPv4
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...(options.headers || {}),
      },
      timeout: options.timeout || 10000,
    };

    if (options.localAddress) {
      reqOptions.localAddress = options.localAddress;
    }

    if (isHttps) {
      // @ts-expect-error rejectUnauthorized option for https
      reqOptions.rejectUnauthorized = false;
    }

    if (options.body) {
      reqOptions.headers = {
        ...reqOptions.headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(options.body).toString(),
      };
    }

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode || 200,
          text: data,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection to ${url.hostname}:${reqOptions.port} timed out.`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Robust HTTP/HTTPS request with multi-homed network interface fallback
 */
async function httpRequest(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  }
): Promise<{ status: number; text: string }> {
  const url = new URL(urlStr);
  const candidates: Array<string | undefined> = [
    undefined,
    cachedWorkingLocalAddress || undefined,
    ...getLocalIPv4Addresses(url.hostname),
  ].filter((c, i, arr) => arr.indexOf(c) === i);

  let lastError: unknown = null;
  for (const localAddr of candidates) {
    try {
      const res = await rawHttpRequest(urlStr, { ...options, localAddress: localAddr });
      if (localAddr) {
        cachedWorkingLocalAddress = localAddr;
      }
      return res;
    } catch (err: unknown) {
      lastError = err;
      const isUnreach = err instanceof Error && (
        err.message.includes('EHOSTUNREACH') ||
        err.message.includes('EHOSTDOWN') ||
        err.message.includes('ENETUNREACH')
      );
      if (!isUnreach) {
        // If it's a 4xx/5xx or timeout, don't keep cycling interfaces
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * Raw streaming HTTP POST request helper for OpenAI compatible SSE
 */
function rawHttpStreamPost(
  urlStr: string,
  bodyObj: unknown,
  headers: Record<string, string>,
  localAddress: string | undefined,
  onData: (chunk: string) => void,
  options?: {
    timeoutMs?: number;
    idleTimeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new Error('Operation aborted by user'));
      return;
    }

    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const bodyStr = JSON.stringify(bodyObj);

    const timeoutMs = options?.timeoutMs ?? 180000;
    const idleTimeoutMs = options?.idleTimeoutMs ?? 60000;

    let isDone = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const abortHandler = () => {
      if (!isDone) {
        isDone = true;
        cleanup();
        req.destroy();
        reject(new Error('Operation aborted by user'));
      }
    };

    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resetTimer = (duration: number, msg: string) => {
      cleanup();
      timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          req.destroy(new Error(msg));
          reject(new Error(msg));
        }
      }, duration);
    };

    // Initial timeout for prefill / time-to-first-byte
    resetTimer(
      timeoutMs,
      `LLM サーバーからの応答がタイムアウトしました (${Math.round(timeoutMs / 1000)}秒)。モデルの処理が高負荷か、サーバーがクラッシュ/停止した可能性があります。`
    );

    const reqOptions: http.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      family: 4, // Force IPv4
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr).toString(),
        Accept: 'text/event-stream',
        ...headers,
      },
    };

    if (localAddress) {
      reqOptions.localAddress = localAddress;
    }

    if (isHttps) {
      // @ts-expect-error rejectUnauthorized option for https
      reqOptions.rejectUnauthorized = false;
    }

    const req = client.request(reqOptions, (res) => {
      if ((res.statusCode || 200) >= 400) {
        let errData = '';
        res.on('data', (c) => (errData += c));
        res.on('end', () => {
          if (!isDone) {
            isDone = true;
            cleanup();
            reject(new Error(`HTTP ${res.statusCode}: ${errData}`));
          }
        });
        return;
      }

      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        // Reset idle timer between chunks
        resetTimer(
          idleTimeoutMs,
          `LLM サーバーからのストリーミングが途絶しました (${Math.round(idleTimeoutMs / 1000)}秒間チャンクなし)。サーバーがクラッシュした可能性があります。`
        );
        onData(chunk);
      });

      res.on('end', () => {
        if (!isDone) {
          isDone = true;
          cleanup();
          resolve();
        }
      });

      res.on('close', () => {
        if (!isDone) {
          isDone = true;
          cleanup();
          reject(new Error('LLM サーバーとの接続が切断されました（サーバープロセスがクラッシュまたは停止した可能性があります）。'));
        }
      });

      res.on('error', (err) => {
        if (!isDone) {
          isDone = true;
          cleanup();
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      if (!isDone) {
        isDone = true;
        cleanup();
        reject(err);
      }
    });

    req.on('close', () => {
      if (!isDone) {
        isDone = true;
        cleanup();
        reject(new Error('LLM サーバーとの通信が切断されました（ソケットがクローズされました）。'));
      }
    });

    req.write(bodyStr);
    req.end();
  });
}

/**
 * Streaming HTTP POST with interface fallback
 */
async function httpStreamPost(
  urlStr: string,
  bodyObj: unknown,
  headers: Record<string, string>,
  onData: (chunk: string) => void,
  options?: {
    timeoutMs?: number;
    idleTimeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<void> {
  const url = new URL(urlStr);
  const candidates: Array<string | undefined> = [
    undefined,
    cachedWorkingLocalAddress || undefined,
    ...getLocalIPv4Addresses(url.hostname),
  ].filter((c, i, arr) => arr.indexOf(c) === i);

  let lastError: unknown = null;
  for (const localAddr of candidates) {
    try {
      await rawHttpStreamPost(urlStr, bodyObj, headers, localAddr, onData, options);
      if (localAddr) {
        cachedWorkingLocalAddress = localAddr;
      }
      return;
    } catch (err: unknown) {
      lastError = err;
      const isUnreach = err instanceof Error && (
        err.message.includes('EHOSTUNREACH') ||
        err.message.includes('EHOSTDOWN') ||
        err.message.includes('ENETUNREACH')
      );
      if (!isUnreach) {
        throw err;
      }
    }
  }

  throw lastError;
}

export function sanitizeToolResultText(text: string | undefined): string {
  if (!text) return '(no output)';

  // If text contains a large base64 data URI or raw base64 image data
  if (
    text.includes('data:image/') ||
    text.includes('"data":') ||
    text.includes('"type":"image"') ||
    text.length > 20000
  ) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.map((item: unknown) => {
          if (item && typeof item === 'object' && (item as { type?: string }).type === 'image') {
            return {
              type: 'image',
              mimeType: (item as { mimeType?: string }).mimeType || 'image/png',
              data: '[image data omitted]',
            };
          }
          return item;
        });
        return JSON.stringify(sanitized);
      } else if (parsed && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>;
        if (p.data && typeof p.data === 'string' && p.data.length > 500) {
          return JSON.stringify({ ...p, data: '[image data omitted]' });
        }
      }
    } catch {
      // Not JSON
    }

    let cleaned = text.replace(
      /data:image\/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+/g,
      '[image data omitted]'
    );

    if (cleaned.length > 10000) {
      cleaned = cleaned.slice(0, 10000) + '\n... [output truncated to prevent context overflow]';
    }

    return cleaned;
  }

  return text;
}

export class LlamaClient {
  private currentBaseUrl: string = '';
  private currentApiKey: string = '';

  constructor() {}

  public init(baseUrl: string, apiKey: string) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    this.currentBaseUrl = cleanUrl.endsWith('/v1') ? cleanUrl : `${cleanUrl}/v1`;
    this.currentApiKey = apiKey || 'dummy-llama-cpp-key';
  }

  private resolveApiBase(customBaseUrl?: string): string {
    const raw = (customBaseUrl && customBaseUrl.trim()) ? customBaseUrl.trim() : this.currentBaseUrl;
    const cleanUrl = raw.replace(/\/+$/, '');
    return cleanUrl.endsWith('/v1') ? cleanUrl : `${cleanUrl}/v1`;
  }

  private resolveApiKey(customApiKey?: string): string {
    return (customApiKey && customApiKey.trim()) ? customApiKey.trim() : this.currentApiKey;
  }

  /**
   * Fetch available models from llama.cpp server
   */
  public async getModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
    const apiBase = this.resolveApiBase(baseUrl);
    const keyToUse = this.resolveApiKey(apiKey) || 'dummy-llama-cpp-key';

    const headers: Record<string, string> = {};
    if (keyToUse) {
      headers['Authorization'] = `Bearer ${keyToUse}`;
    }

    const res = await httpRequest(`${apiBase}/models`, {
      method: 'GET',
      headers,
      timeout: 5000,
    });

    if (res.status >= 400) {
      throw new Error(`HTTP ${res.status}: ${res.text}`);
    }

    const json = JSON.parse(res.text) as {
      data?: Array<{ id: string }>;
      models?: Array<{ name?: string; model?: string; id?: string }>;
    };

    const extracted: string[] = [];
    if (Array.isArray(json.data)) {
      for (const item of json.data) {
        if (item?.id && !extracted.includes(item.id)) {
          extracted.push(item.id);
        }
      }
    }
    if (Array.isArray(json.models)) {
      for (const item of json.models) {
        const id = item?.name || item?.model || item?.id;
        if (id && !extracted.includes(id)) {
          extracted.push(id);
        }
      }
    }

    return extracted;
  }

  /**
   * Call llama.cpp /v1/systemone Decision Models API
   */
  public async callSystemOne(params: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    state: unknown;
    images?: string[];
    questions: Record<string, SystemOneQuestion>;
    timeoutMs?: number;
    allowTextFallbackOnVisionError?: boolean;
  }): Promise<SystemOneRawResponse & { durationMs: number }> {
    const apiBase = this.resolveApiBase(params.baseUrl);
    const keyToUse = this.resolveApiKey(params.apiKey);
    const endpoint = `${apiBase}/systemone`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (keyToUse) {
      headers['Authorization'] = `Bearer ${keyToUse}`;
    }

    const executeRequest = async (withImages: boolean) => {
      const startTime = Date.now();
      const payload: Record<string, unknown> = {
        state: params.state,
        questions: params.questions,
      };
      if (params.model && params.model.trim()) {
        payload.model = params.model.trim();
      }
      if (withImages && params.images && params.images.length > 0) {
        payload.images = params.images;
      }

      const res = await httpRequest(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        timeout: params.timeoutMs || 30000,
      });

      const durationMs = Date.now() - startTime;
      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status}: ${res.text}`);
      }

      const parsed = JSON.parse(res.text) as SystemOneRawResponse;
      if (!parsed || typeof parsed !== 'object' || !parsed.answers) {
        throw new Error('Invalid /v1/systemone response: missing answers object');
      }
      return {
        ...parsed,
        durationMs,
      };
    };

    try {
      return await executeRequest(true);
    } catch (err) {
      if (
        params.allowTextFallbackOnVisionError &&
        params.images &&
        params.images.length > 0
      ) {
        console.warn('[SystemOne] Vision payload failed, retrying text-only state:', err);
        return await executeRequest(false);
      }
      throw err;
    }
  }

  /**
   * Test /v1/systemone endpoint availability and measure latency
   */
  public async testSystemOne(params: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }): Promise<SystemOneTestResult> {
    try {
      const res = await this.callSystemOne({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        model: params.model,
        state:
          'NanoKVM System Status: Target machine display is active at 1920x1080 showing OS login screen.',
        questions: {
          ready: {
            type: 'noul',
            instructions: 'Is the target display active and showing a login screen?',
          },
          screen_type: {
            type: 'choice',
            instructions: 'What type of screen is shown?',
            criteria: {
              login_screen: 'OS login or authentication prompt',
              bsod_crash: 'blue screen of death or kernel panic',
              bios_setup: 'BIOS or UEFI firmware settings',
            },
          },
        },
        timeoutMs: 15000,
      });

      const prob = res.answers?.ready?.noul;
      const choice = res.answers?.screen_type?.choice;

      return {
        success: true,
        model: res.model || params.model || 'default',
        durationMs: res.durationMs,
        sampleProbability: typeof prob === 'number' ? prob : undefined,
        sampleChoice: choice,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: msg,
      };
    }
  }

  /**
   * Evaluate tool call risk via /v1/systemone before execution (Idea 3: Smart Approval Guard)
   */
  public async evaluateToolRiskWithSystemOne(params: {
    systemOne: SystemOneConfig;
    toolName: string;
    toolArgs: Record<string, unknown>;
    userContext: string;
  }): Promise<SystemOneRiskMeta | null> {
    const { systemOne, toolName, toolArgs, userContext } = params;
    if (!systemOne.enabled || !systemOne.useForSmartApproval) {
      return null;
    }

    try {
      const stateText = `User instruction: ${userContext || '(autonomous step)'}\nProposed MCP Tool Call: ${toolName}(${JSON.stringify(toolArgs)})`;
      const res = await this.callSystemOne({
        baseUrl: systemOne.baseUrl,
        apiKey: systemOne.apiKey,
        model: systemOne.model,
        state: stateText,
        questions: {
          needs_approval: {
            type: 'noul',
            instructions:
              'Could this KVM action cause system reboot, power off, data loss, security risk, or destructive change that requires human confirmation before execution?',
          },
          risk_level: {
            type: 'score',
            instructions: 'How risky or destructive is this KVM operation?',
            criteria: [
              'safe read-only screen capture or status check',
              'benign mouse move or routine UI click',
              'keyboard text input or system setting modification',
              'destructive hardware power off, reset, reboot, or critical command',
            ],
          },
          category: {
            type: 'choice',
            instructions: 'Which operation category best describes this tool call?',
            criteria: {
              screen_capture: 'capturing screenshot or inspecting display',
              pointer_action: 'mouse move, click, double click, drag, scroll',
              keyboard_input: 'typing text, pressing Enter, or key combinations',
              power_control: 'ATX power button, hardware reset, force power off',
              other: 'other utility action',
            },
          },
        },
        timeoutMs: 10000,
      });

      const needsApprovalProb = res.answers?.needs_approval?.noul ?? 0;
      const riskScore = res.answers?.risk_level?.score ?? 0;
      const category = res.answers?.category?.choice;
      const threshold = systemOne.confidenceThreshold || 0.7;

      const riskLabels = ['安全 (Read-only)', '低リスク (UI操作)', '中リスク (入力/変更)', '高リスク (電源/重要操作)'];
      const riskIdx = Math.min(3, Math.max(0, Math.round(riskScore)));
      const riskLabel = riskLabels[riskIdx];

      const triggeredApproval = needsApprovalProb >= threshold || riskScore >= 2.2;

      return {
        used: true,
        model: res.model || systemOne.model || 'default',
        durationMs: res.durationMs,
        riskScore,
        riskLabel,
        needsApprovalProb,
        category,
        triggeredApproval,
      };
    } catch (err) {
      console.warn('[SystemOne] Tool risk evaluation failed, continuing with standard flow:', err);
      return null;
    }
  }

  /**
   * Verify tool execution step result via /v1/systemone (Idea 2: Step Verification)
   */
  public async verifyToolStepWithSystemOne(params: {
    systemOne: SystemOneConfig;
    toolName: string;
    toolArgs: Record<string, unknown>;
    resultText?: string;
    resultImage?: string;
    isError?: boolean;
    userContext: string;
    downscaleImage?: (dataUrl: string) => Promise<string>;
  }): Promise<SystemOneVerifyMeta | null> {
    const {
      systemOne,
      toolName,
      toolArgs,
      resultText,
      resultImage,
      isError,
      userContext,
      downscaleImage,
    } = params;
    if (!systemOne.enabled || !systemOne.useForStepVerification) {
      return null;
    }

    try {
      let images: string[] | undefined;
      if (resultImage) {
        let imgToUse = resultImage;
        if (downscaleImage) {
          try {
            imgToUse = await downscaleImage(resultImage);
          } catch {
            // fallback
          }
        }
        images = [imgToUse];
      }

      const stateText = [
        `User goal: ${userContext || '(autonomous operation)'}`,
        `Executed MCP tool: ${toolName}(${JSON.stringify(toolArgs)})`,
        `Tool status: ${isError ? 'ERROR' : 'OK'}`,
        `Tool output: ${sanitizeToolResultText(resultText).slice(0, 1000)}`,
      ].join('\n');

      const res = await this.callSystemOne({
        baseUrl: systemOne.baseUrl,
        apiKey: systemOne.apiKey,
        model: systemOne.model,
        state: stateText,
        images,
        allowTextFallbackOnVisionError: true,
        questions: {
          step_succeeded: {
            type: 'noul',
            instructions:
              'Did this tool execution succeed without error and produce a valid state toward the user goal?',
          },
          screen_state: {
            type: 'choice',
            instructions: 'What is the current state of the target system after this tool step?',
            criteria: {
              ready_for_next_action: 'system is responsive and ready for the next interaction',
              loading_or_busy: 'screen is still loading, booting, or waiting for a process',
              error_or_blocked: 'an error message, crash, or unexpected obstacle is present',
              goal_completed: 'the requested task or target state has been achieved',
            },
          },
        },
        timeoutMs: 15000,
      });

      const succeededProb = res.answers?.step_succeeded?.noul ?? (isError ? 0.1 : 0.85);
      const screenStateAns = res.answers?.screen_state;
      const screenState = screenStateAns?.choice || 'ready_for_next_action';
      const screenStateProb =
        screenStateAns?.probabilities && screenStateAns.choice
          ? screenStateAns.probabilities[screenStateAns.choice]
          : screenStateAns?.confidence;

      return {
        used: true,
        model: res.model || systemOne.model || 'default',
        durationMs: res.durationMs,
        succeededProb,
        screenState,
        screenStateProb,
      };
    } catch (err) {
      console.warn('[SystemOne] Step verification failed, skipping verification metadata:', err);
      return null;
    }
  }

  /**
   * Run chat loop with automatic MCP Tool Calling
   */
  public async streamChat(options: {
    history: ChatMessage[];
    systemPrompt: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutSeconds?: number;
    systemOne?: SystemOneConfig;
    downscaleImage?: (dataUrl: string) => Promise<string>;
    mcpClient?: NanoKVMMCPClient;
    signal?: AbortSignal;
    stepExecutionMode?: boolean;
    onRequestApproval?: (toolCall: ToolCallItem) => Promise<'approve' | 'skip' | 'abort'>;
    onEvent: (event: StreamEvent) => void;
  }): Promise<void> {
    const {
      history,
      systemPrompt,
      model,
      temperature,
      maxTokens,
      timeoutSeconds,
      systemOne,
      downscaleImage,
      mcpClient,
      signal,
      stepExecutionMode,
      onRequestApproval,
      onEvent,
    } = options;
    const timeoutMs = (timeoutSeconds && timeoutSeconds > 0 ? timeoutSeconds : 180) * 1000;

    if (!this.currentBaseUrl) {
      onEvent({ type: 'error', error: 'llama.cpp client is not initialized.' });
      return;
    }

    // Extract latest user prompt text for SystemOne context
    const lastUserMessage =
      [...history].reverse().find((m) => m.role === 'user')?.content || '';

    // Prepare OpenAI compatible messages
    const openAiMessages: Array<Record<string, unknown>> = [];

    if (systemPrompt.trim()) {
      openAiMessages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Convert chat history
    for (const msg of history) {
      if (msg.role === 'user') {
        openAiMessages.push({
          role: 'user',
          content: msg.content,
        });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          openAiMessages.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          });

          // Add tool results
          for (const tc of msg.toolCalls) {
            let resultContent = sanitizeToolResultText(tc.result?.text);
            if (tc.result?.image && !resultContent.includes('[Image captured')) {
              resultContent += '\n[Image captured from NanoKVM]';
            }
            openAiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: resultContent,
            });
          }
        } else {
          openAiMessages.push({
            role: 'assistant',
            content: msg.content,
          });
        }
      }
    }

    // Prepare tools if MCP is connected
    const tools = mcpClient && mcpClient.getConnected()
      ? mcpClient.getOpenAITools()
      : [];

    const MAX_TOOL_ROUNDS = 10;
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;
      try {
        const headers: Record<string, string> = {};
        if (this.currentApiKey) {
          headers['Authorization'] = `Bearer ${this.currentApiKey}`;
        }

        const requestBody = {
          model: model || 'default',
          messages: openAiMessages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        };

        let accumulatedContent = '';
        const pendingToolCalls: Map<
          number,
          { id: string; name: string; argumentsStr: string }
        > = new Map();
        let sseBuffer = '';

        const executeChatStream = async () => {
          accumulatedContent = '';
          pendingToolCalls.clear();
          sseBuffer = '';

          await httpStreamPost(
            `${this.currentBaseUrl}/chat/completions`,
            requestBody,
            headers,
            (chunk: string) => {
              sseBuffer += chunk;
              const lines = sseBuffer.split('\n');
              sseBuffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) continue;
                if (trimmed === 'data: [DONE]') continue;

                if (trimmed.startsWith('data: ')) {
                  const jsonStr = trimmed.slice(6);
                  try {
                    const parsed = JSON.parse(jsonStr);
                    const delta = parsed.choices?.[0]?.delta;
                    if (!delta) continue;

                    if (delta.content) {
                      accumulatedContent += delta.content;
                      onEvent({ type: 'token', token: delta.content });
                    }

                    if (delta.tool_calls) {
                      for (const tc of delta.tool_calls) {
                        const index = tc.index ?? 0;
                        const existing = pendingToolCalls.get(index) || {
                          id: tc.id || `call_${Date.now()}_${index}`,
                          name: '',
                          argumentsStr: '',
                        };

                        if (tc.id) existing.id = tc.id;
                        if (tc.function?.name) existing.name += tc.function.name;
                        if (tc.function?.arguments) existing.argumentsStr += tc.function.arguments;

                        pendingToolCalls.set(index, existing);
                      }
                    }
                  } catch {
                    // ignore incomplete json chunk
                  }
                }
              }
            },
            {
              timeoutMs,
              idleTimeoutMs: 60000,
              signal,
            }
          );
        };

        try {
          await executeChatStream();
        } catch (streamErr: unknown) {
          if (signal?.aborted) {
            onEvent({ type: 'done' });
            return;
          }
          const lastMsg = openAiMessages[openAiMessages.length - 1];
          const hasVisionMessage = Array.isArray(lastMsg?.content);
          if (hasVisionMessage) {
            console.warn('Vision request failed, falling back to text-only mode:', streamErr);
            // Replace the vision message with a text prompt notice
            openAiMessages.pop();
            openAiMessages.push({
              role: 'user',
              content:
                '[NanoKVM Screenshot Note: The screenshot was taken, but image input could not be processed by the LLM (vision/mmproj may not be loaded on the server). Continuing in text-only mode.]',
            });
            requestBody.messages = openAiMessages;
            await executeChatStream();
          } else {
            throw streamErr;
          }
        }

        if (signal?.aborted) {
          onEvent({ type: 'done' });
          return;
        }

        // If no tool calls were requested, we are done!
        if (pendingToolCalls.size === 0) {
          onEvent({ type: 'done' });
          return;
        }

        // Execute tool calls on NanoKVM MCP
        const executedCalls: ToolCallItem[] = [];
        const assistantToolCallsParam: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }> = [];

        for (const [, tcData] of pendingToolCalls.entries()) {
          if (signal?.aborted) {
            onEvent({ type: 'done' });
            return;
          }

          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = tcData.argumentsStr ? JSON.parse(tcData.argumentsStr) : {};
          } catch (e) {
            console.warn(`Failed to parse arguments JSON: ${tcData.argumentsStr}`, e);
          }

          const toolCallItem: ToolCallItem = {
            id: tcData.id,
            name: tcData.name,
            arguments: parsedArgs,
            status: 'running',
          };

          // Idea 3: Evaluate Tool Risk with /v1/systemone if enabled
          if (systemOne?.enabled && systemOne.useForSmartApproval) {
            const riskMeta = await this.evaluateToolRiskWithSystemOne({
              systemOne,
              toolName: tcData.name,
              toolArgs: parsedArgs,
              userContext: lastUserMessage,
            });
            if (riskMeta) {
              toolCallItem.systemOneRisk = riskMeta;
            }
          }

          // Determine if human approval is required (either manual stepExecutionMode OR SystemOne Smart Approval)
          const shouldRequestApproval =
            onRequestApproval &&
            (stepExecutionMode || toolCallItem.systemOneRisk?.triggeredApproval);

          if (shouldRequestApproval) {
            toolCallItem.status = 'waiting_approval';
            onEvent({ type: 'tool_call_waiting_approval', toolCall: toolCallItem });
            const decision = await onRequestApproval(toolCallItem);
            if (decision === 'abort') {
              onEvent({ type: 'done' });
              return;
            } else if (decision === 'skip') {
              toolCallItem.status = 'skipped';
              toolCallItem.result = {
                text: 'ユーザーによりこのツールの実行はスキップされました。',
              };
              executedCalls.push(toolCallItem);
              assistantToolCallsParam.push({
                id: tcData.id,
                type: 'function',
                function: {
                  name: tcData.name,
                  arguments: tcData.argumentsStr,
                },
              });
              onEvent({ type: 'tool_call_complete', toolCall: toolCallItem });
              continue;
            }
            toolCallItem.status = 'running';
          }

          onEvent({ type: 'tool_call_start', toolCall: toolCallItem });

          assistantToolCallsParam.push({
            id: tcData.id,
            type: 'function',
            function: {
              name: tcData.name,
              arguments: tcData.argumentsStr,
            },
          });

          if (mcpClient && mcpClient.getConnected()) {
            const result = await mcpClient.callTool(tcData.name, parsedArgs);
            toolCallItem.result = {
              text: result.text,
              image: result.image,
              isError: result.isError,
            };
            toolCallItem.status = result.isError ? 'failed' : 'completed';
          } else {
            toolCallItem.result = {
              text: 'NanoKVM MCP サーバーに接続されていません。',
              isError: true,
            };
            toolCallItem.status = 'failed';
          }

          // Idea 2: Verify step execution via /v1/systemone if enabled
          if (systemOne?.enabled && systemOne.useForStepVerification) {
            const verifyMeta = await this.verifyToolStepWithSystemOne({
              systemOne,
              toolName: tcData.name,
              toolArgs: parsedArgs,
              resultText: toolCallItem.result?.text,
              resultImage: toolCallItem.result?.image,
              isError: toolCallItem.result?.isError,
              userContext: lastUserMessage,
              downscaleImage,
            });
            if (verifyMeta) {
              toolCallItem.systemOneVerify = verifyMeta;
            }
          }

          executedCalls.push(toolCallItem);
          onEvent({ type: 'tool_call_complete', toolCall: toolCallItem });
        }

        // Add assistant message with tool calls to prompt history
        openAiMessages.push({
          role: 'assistant',
          content: accumulatedContent || null,
          tool_calls: assistantToolCallsParam,
        });

        // Add tool responses to prompt history (all tool messages must immediately follow assistant message)
        for (const tc of executedCalls) {
          let contentStr = sanitizeToolResultText(tc.result?.text);
          if (tc.result?.image && !contentStr.includes('[Image captured')) {
            contentStr += '\n[Image captured from NanoKVM: Screenshot is attached]';
          }
          if (tc.systemOneVerify?.used) {
            const pct = Math.round(tc.systemOneVerify.succeededProb * 100);
            contentStr += `\n[SystemOne Step Verification: step_succeeded=${pct}%, screen_state=${tc.systemOneVerify.screenState}]`;
          }

          openAiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: contentStr,
          });
        }

        // Inject multimodal image for vision models after all tool calls
        const imageCalls = executedCalls.filter((tc) => tc.result?.image);
        if (imageCalls.length > 0) {
          console.log(`[Worker] Optimizing and submitting ${imageCalls.length} captured image(s) to LLM for visual reasoning...`);
          const contentParts: Array<{
            type: string;
            text?: string;
            image_url?: { url: string };
          }> = [
            {
              type: 'text',
              text: `Here is the screen captured by tool ${imageCalls.map((c) => c.name).join(', ')}:`,
            },
          ];

          for (const tc of imageCalls) {
            let imgUrl = tc.result!.image!;
            if (downscaleImage) {
              try {
                imgUrl = await downscaleImage(tc.result!.image!);
              } catch (e) {
                console.warn('[Worker] Downscaling failed, falling back to original image:', e);
              }
            }

            console.log(`[Worker] Attached image to LLM payload (format: ${imgUrl.slice(0, 30)}..., size: ${Math.round(imgUrl.length / 1024)} KB)`);
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: imgUrl,
              },
            });
          }

          openAiMessages.push({
            role: 'user',
            content: contentParts,
          });
        }
      } catch (err) {
        console.error('Error during LLM chat stream:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        onEvent({ type: 'error', error: errMsg });
        return;
      }
    }

    onEvent({
      type: 'error',
      error: `Maximum tool call iterations (${MAX_TOOL_ROUNDS}) reached.`,
    });
  }

  /**
   * Evaluate a visual watchdog condition against a captured screen image
   * Uses /v1/systemone if enabled, with transparent fallback to /v1/chat/completions
   */
  public async evaluateWatchdogCondition(options: {
    imageUrl?: string;
    condition: string;
    model: string;
    temperature?: number;
    timeoutSeconds?: number;
    systemOne?: SystemOneConfig;
    downscaleImage?: (dataUrl: string) => Promise<string>;
  }): Promise<{
    matched: boolean;
    confidence: number;
    reason: string;
    systemOne?: SystemOneWatchdogMeta;
  }> {
    const {
      imageUrl,
      condition,
      model,
      temperature = 0.2,
      timeoutSeconds = 60,
      systemOne,
      downscaleImage,
    } = options;

    let processedImageUrl = imageUrl;
    if (imageUrl && downscaleImage) {
      try {
        processedImageUrl = await downscaleImage(imageUrl);
      } catch (e) {
        console.warn('[Worker] Downscale before watchdog eval failed, using raw:', e);
      }
    }

    // Idea 1: Try /v1/systemone first if enabled for Watchdog
    if (systemOne?.enabled && systemOne.useForWatchdog) {
      try {
        const threshold = systemOne.confidenceThreshold || 0.7;
        const sysRes = await this.callSystemOne({
          baseUrl: systemOne.baseUrl,
          apiKey: systemOne.apiKey,
          model: systemOne.model || model,
          state: `Target PC screen captured via NanoKVM. Watchdog condition to verify: "${condition}"`,
          images: processedImageUrl ? [processedImageUrl] : undefined,
          questions: {
            condition_matched: {
              type: 'noul',
              instructions: `Does the current screen satisfy this condition: "${condition}"?`,
            },
            screen_category: {
              type: 'choice',
              instructions: 'What type of screen is currently displayed on the monitor?',
              criteria: {
                normal_desktop: 'normal OS desktop or application window',
                login_or_lock: 'OS login prompt, lock screen, or password input',
                installer_or_update: 'software installer, progress bar, or update screen',
                error_or_dialog: 'error popup, warning dialog, or unresponsive application',
                crash_or_bsod: 'blue screen of death (BSOD), kernel panic, or system crash',
                bios_or_boot: 'BIOS setup, bootloader, black screen, or no signal',
              },
            },
            severity: {
              type: 'score',
              instructions: 'How urgent or critical is the current screen state?',
              criteria: ['normal', 'informational', 'warning', 'critical'],
            },
          },
          timeoutMs: timeoutSeconds * 1000,
        });

        const probability = sysRes.answers?.condition_matched?.noul ?? 0;
        const matched = probability >= threshold;
        const categoryAns = sysRes.answers?.screen_category;
        const screenCategory = categoryAns?.choice || 'unknown';
        const screenCategoryProb =
          categoryAns?.probabilities && categoryAns.choice
            ? categoryAns.probabilities[categoryAns.choice]
            : categoryAns?.confidence;
        const severityScore = sysRes.answers?.severity?.score ?? 0;
        const severityLabels = ['正常 (Normal)', '情報 (Info)', '警告 (Warning)', '緊急 (Critical)'];
        const severityLabel = severityLabels[Math.min(3, Math.max(0, Math.round(severityScore)))];

        const usedModel = sysRes.model || systemOne.model || model || 'default';
        const reason = `⚡ [/v1/systemone 判定 (${sysRes.durationMs}ms)] 条件合致確率: ${Math.round(
          probability * 100
        )}% (閾値: ${Math.round(threshold * 100)}%) | 画面分類: ${screenCategory} (${Math.round(
          (screenCategoryProb || 0) * 100
        )}%) | 重要度スコア: ${severityScore.toFixed(2)}/3.0 (${severityLabel})`;

        return {
          matched,
          confidence: probability,
          reason,
          systemOne: {
            used: true,
            model: usedModel,
            durationMs: sysRes.durationMs,
            probability,
            screenCategory,
            screenCategoryProb,
            severityScore,
            severityLabel,
            batchSize: 1,
          },
        };
      } catch (sysErr) {
        console.warn(
          '[SystemOne] Watchdog /v1/systemone evaluation failed, falling back to /v1/chat/completions:',
          sysErr
        );
      }
    }

    const systemMsg = `あなたは画面状態の監視・判定システムです。
画面キャプチャを詳細に確認し、指定された【監視条件】を満たしているかどうかを客観的・正確に判定してください。

必ず以下のJSON形式のみで回答してください。Markdownのコードブロックや余分な解説は含めないでください。
{
  "matched": trueまたはfalse,
  "confidence": 0.0から1.0までの数値,
  "reason": "画面のどこに何が表示されているか、なぜ条件に一致または不一致と判定したかの簡潔な説明"
}`;

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      {
        type: 'text',
        text: `【監視条件】: ${condition}\n\n上記の監視条件が現在の画面で成立しているかを判定し、指定されたJSONフォーマットで回答してください。`,
      },
    ];

    if (processedImageUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: processedImageUrl },
      });
    }

    const messages = [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userContent },
    ];

    const body = {
      model: model || 'default',
      messages,
      temperature,
      max_tokens: 512,
      stream: false,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.currentApiKey) {
      headers['Authorization'] = `Bearer ${this.currentApiKey}`;
    }

    const cleanBase = this.currentBaseUrl.replace(/\/+$/, '');
    const endpoint = cleanBase.endsWith('/v1')
      ? `${cleanBase}/chat/completions`
      : `${cleanBase}/v1/chat/completions`;

    const res = await httpRequest(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout: timeoutSeconds * 1000,
    });

    if (res.status >= 400) {
      throw new Error(`LLM Server error ${res.status}: ${res.text}`);
    }

    const parsed = JSON.parse(res.text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = parsed.choices?.[0]?.message?.content || '';

    // Attempt to extract JSON
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          matched: Boolean(result.matched),
          confidence: typeof result.confidence === 'number' ? result.confidence : 0.8,
          reason: String(result.reason || content).trim(),
        };
      }
    } catch {
      // Fallback parse
    }

    const lower = content.toLowerCase();
    const matched = lower.includes('"matched": true') || lower.includes('matched: true') || lower.includes('true');
    return {
      matched,
      confidence: 0.5,
      reason: content.trim(),
    };
  }

  /**
   * Idea 4: Batch evaluate multiple Watchdog jobs in a single /v1/systemone forward pass
   */
  public async evaluateWatchdogBatch(options: {
    imageUrl?: string;
    items: Array<{ jobId: string; jobName: string; condition: string }>;
    model: string;
    timeoutSeconds?: number;
    systemOne: SystemOneConfig;
    downscaleImage?: (dataUrl: string) => Promise<string>;
  }): Promise<
    Record<
      string,
      {
        matched: boolean;
        confidence: number;
        reason: string;
        systemOne: SystemOneWatchdogMeta;
      }
    >
  > {
    const { imageUrl, items, model, timeoutSeconds = 60, systemOne, downscaleImage } = options;

    let processedImageUrl = imageUrl;
    if (imageUrl && downscaleImage) {
      try {
        processedImageUrl = await downscaleImage(imageUrl);
      } catch (e) {
        console.warn('[Worker] Downscale before batch watchdog eval failed, using raw:', e);
      }
    }

    const questions: Record<string, SystemOneQuestion> = {
      screen_category: {
        type: 'choice',
        instructions: 'What type of screen is currently displayed on the monitor?',
        criteria: {
          normal_desktop: 'normal OS desktop or application window',
          login_or_lock: 'OS login prompt, lock screen, or password input',
          installer_or_update: 'software installer, progress bar, or update screen',
          error_or_dialog: 'error popup, warning dialog, or unresponsive application',
          crash_or_bsod: 'blue screen of death (BSOD), kernel panic, or system crash',
          bios_or_boot: 'BIOS setup, bootloader, black screen, or no signal',
        },
      },
      severity: {
        type: 'score',
        instructions: 'How urgent or critical is the current screen state?',
        criteria: ['normal', 'informational', 'warning', 'critical'],
      },
    };

    for (const item of items) {
      questions[`job_${item.jobId}`] = {
        type: 'noul',
        instructions: `Does the current screen satisfy this condition: "${item.condition}"?`,
      };
    }

    const sysRes = await this.callSystemOne({
      baseUrl: systemOne.baseUrl,
      apiKey: systemOne.apiKey,
      model: systemOne.model || model,
      state: `Target PC screen captured via NanoKVM. Evaluating ${items.length} watchdog conditions simultaneously.`,
      images: processedImageUrl ? [processedImageUrl] : undefined,
      questions,
      timeoutMs: timeoutSeconds * 1000,
    });

    const threshold = systemOne.confidenceThreshold || 0.7;
    const categoryAns = sysRes.answers?.screen_category;
    const screenCategory = categoryAns?.choice || 'unknown';
    const screenCategoryProb =
      categoryAns?.probabilities && categoryAns.choice
        ? categoryAns.probabilities[categoryAns.choice]
        : categoryAns?.confidence;
    const severityScore = sysRes.answers?.severity?.score ?? 0;
    const severityLabels = ['正常 (Normal)', '情報 (Info)', '警告 (Warning)', '緊急 (Critical)'];
    const severityLabel = severityLabels[Math.min(3, Math.max(0, Math.round(severityScore)))];
    const usedModel = sysRes.model || systemOne.model || model || 'default';

    const results: Record<
      string,
      {
        matched: boolean;
        confidence: number;
        reason: string;
        systemOne: SystemOneWatchdogMeta;
      }
    > = {};

    for (const item of items) {
      const qKey = `job_${item.jobId}`;
      const probability = sysRes.answers?.[qKey]?.noul ?? 0;
      const matched = probability >= threshold;
      const reason = `⚡ [/v1/systemone 一括バッチ判定 (${items.length}件同時・計${sysRes.durationMs}ms)] 条件合致確率: ${Math.round(
        probability * 100
      )}% (閾値: ${Math.round(threshold * 100)}%) | 画面分類: ${screenCategory} (${Math.round(
        (screenCategoryProb || 0) * 100
      )}%) | 重要度スコア: ${severityScore.toFixed(2)}/3.0 (${severityLabel})`;

      results[item.jobId] = {
        matched,
        confidence: probability,
        reason,
        systemOne: {
          used: true,
          model: usedModel,
          durationMs: sysRes.durationMs,
          probability,
          screenCategory,
          screenCategoryProb,
          severityScore,
          severityLabel,
          batchSize: items.length,
        },
      };
    }

    return results;
  }
}
