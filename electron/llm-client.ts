import http from 'node:http';
import https from 'node:https';
import type { ChatMessage, ToolCallItem } from '../src/types';
import type { NanoKVMMCPClient } from './mcp-client';

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

  /**
   * Fetch available models from llama.cpp server
   */
  public async getModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
    const urlToUse = baseUrl || this.currentBaseUrl;
    const keyToUse = apiKey || this.currentApiKey || 'dummy-llama-cpp-key';
    const cleanUrl = urlToUse.replace(/\/+$/, '');
    const apiBase = cleanUrl.endsWith('/v1') ? cleanUrl : `${cleanUrl}/v1`;

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
   * Run chat loop with automatic MCP Tool Calling
   */
  public async streamChat(options: {
    history: ChatMessage[];
    systemPrompt: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutSeconds?: number;
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

          // Step Execution Approval Check
          if (stepExecutionMode && onRequestApproval) {
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
   */
  public async evaluateWatchdogCondition(options: {
    imageUrl?: string;
    condition: string;
    model: string;
    temperature?: number;
    timeoutSeconds?: number;
    downscaleImage?: (dataUrl: string) => Promise<string>;
  }): Promise<{ matched: boolean; confidence: number; reason: string }> {
    const { imageUrl, condition, model, temperature = 0.2, timeoutSeconds = 60, downscaleImage } = options;

    let processedImageUrl = imageUrl;
    if (imageUrl && downscaleImage) {
      try {
        processedImageUrl = await downscaleImage(imageUrl);
      } catch (e) {
        console.warn('[Worker] Downscale before watchdog eval failed, using raw:', e);
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
}
