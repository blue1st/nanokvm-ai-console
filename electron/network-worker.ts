import { NanoKVMMCPClient } from './mcp-client';
import { LlamaClient } from './llm-client';
import type { ChatMessage, SystemOneConfig } from '../src/types';

const mcpClient = new NanoKVMMCPClient();
const llamaClient = new LlamaClient();
let currentSystemOneConfig: SystemOneConfig | undefined;

let currentAbortController: AbortController | null = null;
const pendingApprovals = new Map<string, (decision: 'approve' | 'skip' | 'abort') => void>();

const pendingMainRequests = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();
let mainReqSeq = 1;

export function downscaleImageViaMain(dataUrl: string, maxDim: number = 1024): Promise<string> {
  return new Promise((resolve) => {
    const id = `downscale_${mainReqSeq++}`;
    const origSizeKb = Math.round(dataUrl.length / 1024);
    console.log(`[Worker] Requesting main process to downscale image (${origSizeKb} KB)...`);

    pendingMainRequests.set(id, {
      resolve: (downscaled) => {
        console.log(`[Worker] Image downscale succeeded (${origSizeKb} KB -> ${Math.round(downscaled.length / 1024)} KB).`);
        resolve(downscaled);
      },
      reject: (err) => {
        console.warn('[Worker] Downscaling failed, using original:', err);
        resolve(dataUrl); // fallback to original on error
      },
    });
    process.send?.({ id, action: 'main:downscaleImage', payload: { dataUrl, maxDim } });

    // Safety timeout: fallback to original if main doesn't respond in 3 seconds
    setTimeout(() => {
      const p = pendingMainRequests.get(id);
      if (p) {
        pendingMainRequests.delete(id);
        console.warn(`[Worker] Downscale request timed out after 3s, using original (${origSizeKb} KB).`);
        resolve(dataUrl);
      }
    }, 3000);
  });
}

interface WorkerMessage {
  id: string;
  action: string;
  payload?: any;
  success?: boolean;
  data?: any;
  error?: string;
}

process.on('message', async (msg: WorkerMessage) => {
  if (!msg) return;

  // Handle responses from main process to worker requests
  if (msg.id && pendingMainRequests.has(msg.id)) {
    const pending = pendingMainRequests.get(msg.id)!;
    pendingMainRequests.delete(msg.id);
    if (msg.success) {
      pending.resolve(msg.data);
    } else {
      pending.reject(new Error(msg.error || 'Main request failed'));
    }
    return;
  }

  if (!msg.action) return;
  const { id, action, payload } = msg;

  try {
    switch (action) {
      case 'init': {
        const { llama, systemOne, nanokvm } = payload;
        if (llama?.baseUrl) {
          llamaClient.init(llama.baseUrl, llama.apiKey || '');
        }
        if (systemOne) {
          currentSystemOneConfig = systemOne;
        }
        if (nanokvm?.endpoint && nanokvm?.apiKey) {
          await mcpClient.connect(
            nanokvm.endpoint,
            nanokvm.apiKey,
            nanokvm.insecureSkipVerify !== false
          );
        }
        process.send?.({ id, success: true });
        break;
      }

      case 'llama:getModels': {
        const { baseUrl, apiKey } = payload || {};
        const models = await llamaClient.getModels(baseUrl, apiKey);
        process.send?.({ id, success: true, data: models });
        break;
      }

      case 'llama:test': {
        const { baseUrl, apiKey } = payload || {};
        const models = await llamaClient.getModels(baseUrl, apiKey);
        if (models.length === 0) {
          process.send?.({
            id,
            success: false,
            error: 'llama.cpp サーバーに接続できましたが、モデルが 0 件でした。',
          });
        } else {
          process.send?.({ id, success: true, data: models });
        }
        break;
      }

      case 'systemOne:test': {
        const { baseUrl, apiKey, model } = payload || {};
        const testRes = await llamaClient.testSystemOne({ baseUrl, apiKey, model });
        process.send?.({ id, success: true, data: testRes });
        break;
      }

      case 'mcp:connect': {
        const { endpoint, apiKey, insecureSkipVerify } = payload;
        const result = await mcpClient.connect(endpoint, apiKey, insecureSkipVerify !== false);
        process.send?.({ id, success: result.success, data: result, error: result.error });
        break;
      }

      case 'mcp:disconnect': {
        await mcpClient.disconnect();
        process.send?.({ id, success: true });
        break;
      }

      case 'mcp:getTools': {
        const tools = mcpClient.getCachedTools();
        process.send?.({ id, success: true, data: tools });
        break;
      }

      case 'mcp:callTool': {
        const { name, args } = payload || {};
        if (!name) {
          process.send?.({ id, success: false, error: 'Tool name is required' });
          break;
        }
        const res = await mcpClient.callTool(name, args || {});
        process.send?.({ id, success: !res.isError, data: res, error: res.isError ? res.text : undefined });
        break;
      }

      case 'app:getStatus': {
        let llmOk = false;
        let llmError: string | undefined;
        let detectedModel: string | undefined;

        try {
          const models = await llamaClient.getModels();
          llmOk = true;
          if (models.length > 0) {
            detectedModel = models[0];
          }
        } catch (e) {
          llmError = e instanceof Error ? e.message : String(e);
        }

        let systemOneStatus: {
          enabled: boolean;
          available: boolean;
          model?: string;
          endpoint?: string;
          error?: string;
        } = {
          enabled: !!currentSystemOneConfig?.enabled,
          available: false,
          model: currentSystemOneConfig?.model || detectedModel || 'default',
          endpoint: currentSystemOneConfig?.baseUrl || undefined,
        };

        if (currentSystemOneConfig?.enabled) {
          if (currentSystemOneConfig.baseUrl) {
            try {
              const sysModels = await llamaClient.getModels(
                currentSystemOneConfig.baseUrl,
                currentSystemOneConfig.apiKey
              );
              systemOneStatus.available = true;
              if (!currentSystemOneConfig.model && sysModels.length > 0) {
                systemOneStatus.model = sysModels[0];
              }
            } catch (e) {
              systemOneStatus.available = false;
              systemOneStatus.error = e instanceof Error ? e.message : String(e);
            }
          } else {
            systemOneStatus.available = llmOk;
            systemOneStatus.error = llmError;
          }
        }

        process.send?.({
          id,
          success: true,
          data: {
            llm: {
              connected: llmOk,
              model: detectedModel || 'default',
              error: llmError,
            },
            systemOne: systemOneStatus,
            mcp: {
              connected: mcpClient.getConnected(),
              toolCount: mcpClient.getCachedTools().length,
            },
          },
        });
        break;
      }

      case 'chat:abort': {
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        for (const resolve of pendingApprovals.values()) {
          resolve('abort');
        }
        pendingApprovals.clear();
        process.send?.({ id, success: true });
        break;
      }

      case 'chat:approveDecision': {
        const { toolCallId, decision } = payload || {};
        const resolve = pendingApprovals.get(toolCallId);
        if (resolve) {
          pendingApprovals.delete(toolCallId);
          resolve(decision || 'approve');
          process.send?.({ id, success: true });
        } else {
          process.send?.({ id, success: false, error: 'No pending approval for tool call' });
        }
        break;
      }

      case 'chat:send': {
        const { history, content, config } = payload;
        llamaClient.init(config.llama.baseUrl, config.llama.apiKey);
        if (config.systemOne) {
          currentSystemOneConfig = config.systemOne;
        }

        const fullHistory: ChatMessage[] = [
          ...history,
          {
            id: `user_${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
        ];

        currentAbortController = new AbortController();
        pendingApprovals.clear();

        await llamaClient.streamChat({
          history: fullHistory,
          systemPrompt: config.llama.systemPrompt,
          model: config.llama.model,
          temperature: config.llama.temperature,
          maxTokens: config.llama.maxTokens,
          timeoutSeconds: config.llama.timeoutSeconds,
          systemOne: config.systemOne,
          downscaleImage: downscaleImageViaMain,
          mcpClient,
          signal: currentAbortController.signal,
          stepExecutionMode: !!config.stepExecutionMode,
          onRequestApproval: (toolCall) => {
            return new Promise((resolve) => {
              pendingApprovals.set(toolCall.id, resolve);
            });
          },
          onEvent: (event) => {
            process.send?.({
              id,
              isStreamEvent: true,
              event,
            });
          },
        });

        currentAbortController = null;
        pendingApprovals.clear();

        process.send?.({ id, success: true, isStreamComplete: true });
        break;
      }

      case 'watchdog:evaluate': {
        const { imageUrl, condition, config } = payload || {};
        if (config?.llama?.baseUrl) {
          llamaClient.init(config.llama.baseUrl, config.llama.apiKey);
        }

        const modelToUse = config?.llama?.model || (await llamaClient.getModels())[0] || 'default';
        const evalResult = await llamaClient.evaluateWatchdogCondition({
          imageUrl,
          condition,
          model: modelToUse,
          timeoutSeconds: config?.llama?.timeoutSeconds || 60,
          systemOne: config?.systemOne,
          downscaleImage: downscaleImageViaMain,
        });

        process.send?.({ id, success: true, data: evalResult });
        break;
      }

      case 'watchdog:evaluateBatch': {
        const { imageUrl, items, config } = payload || {};
        if (config?.llama?.baseUrl) {
          llamaClient.init(config.llama.baseUrl, config.llama.apiKey);
        }
        const modelToUse = config?.llama?.model || 'default';
        const batchResult = await llamaClient.evaluateWatchdogBatch({
          imageUrl,
          items: items || [],
          model: modelToUse,
          timeoutSeconds: config?.llama?.timeoutSeconds || 60,
          systemOne: config?.systemOne,
          downscaleImage: downscaleImageViaMain,
        });

        process.send?.({ id, success: true, data: batchResult });
        break;
      }

      default:
        process.send?.({ id, success: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    process.send?.({ id, success: false, error: errorMsg });
  }
});
