import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import eventSourcePkg from 'eventsource';
import type { MCPTool } from '../src/types';

// Robustly resolve EventSource constructor across ESM and CommonJS
// @ts-expect-error handle both CJS default export and named export patterns
const ResolvedEventSource = eventSourcePkg?.EventSource || eventSourcePkg?.default || eventSourcePkg;

// Ensure EventSource is available globally for MCP SDK in Node.js
if (typeof globalThis.EventSource === 'undefined' && ResolvedEventSource) {
  (globalThis as unknown as { EventSource: unknown }).EventSource = ResolvedEventSource;
}

export class NanoKVMMCPClient {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private isConnected = false;
  private cachedTools: MCPTool[] = [];

  constructor() {}

  public getConnected(): boolean {
    return this.isConnected;
  }

  public getCachedTools(): MCPTool[] {
    return this.cachedTools;
  }

  /**
   * Connect to the NanoKVM Go remote MCP server
   */
  public async connect(
    endpoint: string,
    apiKey: string,
    insecureSkipVerify: boolean = true
  ): Promise<{ success: boolean; toolCount: number; error?: string }> {
    try {
      // Disconnect existing connection if any
      await this.disconnect();

      if (insecureSkipVerify) {
        // Disable TLS certificate verification for self-signed NanoKVM endpoints
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      }

      const formattedAuth = apiKey
        ? apiKey.startsWith('Bearer ')
          ? apiKey
          : `Bearer ${apiKey}`
        : '';

      const headers: Record<string, string> = {};
      if (formattedAuth) {
        headers['Authorization'] = formattedAuth;
      }

      const url = new URL(endpoint);

      this.client = new Client(
        {
          name: 'nanokvm-chat-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      console.log(`Connecting to NanoKVM MCP at ${endpoint}...`);

      // Try StreamableHTTPClientTransport first (Standard for modern NanoKVM Go MCP)
      try {
        const streamableTransport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers,
          },
        });
        await this.client.connect(streamableTransport);
        this.transport = streamableTransport;
        this.isConnected = true;
        console.log('Connected via StreamableHTTPClientTransport.');
      } catch (streamableErr: unknown) {
        console.warn('StreamableHTTPClientTransport failed, falling back to SSEClientTransport:', streamableErr);
        // Fallback to legacy SSEClientTransport
        const sseTransport = new SSEClientTransport(url, {
          eventSourceInit: {
            headers,
          } as unknown as EventSourceInit,
          requestInit: {
            headers,
          },
        });
        await this.client.connect(sseTransport);
        this.transport = sseTransport;
        this.isConnected = true;
        console.log('Connected via SSEClientTransport fallback.');
      }

      // Fetch tools
      const toolsResult = await this.client.listTools();
      this.cachedTools = (toolsResult.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as MCPTool['inputSchema'],
      }));

      console.log(`Discovered ${this.cachedTools.length} MCP tools:`, this.cachedTools.map(t => t.name));

      return {
        success: true,
        toolCount: this.cachedTools.length,
      };
    } catch (err: unknown) {
      console.error('Failed to connect to NanoKVM MCP:', err);
      this.isConnected = false;
      this.cachedTools = [];
      let errorMsg = err instanceof Error ? err.message : String(err);

      if (errorMsg.includes('401')) {
        errorMsg = '認証エラー (401): NanoKVM の API Key が正しくありません。NanoKVM Web画面の Settings > MCP の API Key を入力してください。';
      } else if (errorMsg.includes('EHOSTUNREACH')) {
        errorMsg = `ホスト到達不能 (EHOSTUNREACH): 端末 (${endpoint}) にアクセスできません。NanoKVMが同一LANに接続されているか確認してください。`;
      } else if (errorMsg.includes('ECONNREFUSED')) {
        errorMsg = `接続拒否 (ECONNREFUSED): 端末 (${endpoint}) への接続が拒否されました。`;
      }

      return {
        success: false,
        toolCount: 0,
        error: errorMsg,
      };
    }
  }

  /**
   * Disconnect from the MCP server
   */
  public async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (e) {
        console.warn('Error closing MCP transport:', e);
      }
      this.transport = null;
    }
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Call a tool on the NanoKVM Go MCP server
   */
  public async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{
    text?: string;
    image?: string; // base64 data URI
    isError?: boolean;
    raw?: unknown;
  }> {
    if (!this.client || !this.isConnected) {
      throw new Error('NanoKVM MCP is not connected.');
    }

    console.log(`Calling MCP tool: ${name} with args:`, args);

    try {
      const response = await this.client.callTool({
        name,
        arguments: args,
      });

      let textOutput = '';
      let imageOutput: string | undefined;

      if (Array.isArray(response.content)) {
        for (const item of response.content) {
          if (item.type === 'text') {
            textOutput += (textOutput ? '\n' : '') + item.text;
          } else if (item.type === 'image') {
            // item is { type: 'image', data: 'base64...', mimeType: 'image/png' }
            const mimeType = (item as { mimeType?: string }).mimeType || 'image/png';
            const data = (item as { data?: string }).data || '';
            imageOutput = `data:${mimeType};base64,${data}`;
          }
        }
      }

      let summaryText = textOutput;
      if (!summaryText) {
        if (imageOutput) {
          summaryText = 'スクリーンショットを取得しました。(画像データ取得済み)';
        } else if (response.content) {
          // Sanitize any potential image objects in content before stringifying
          const safeContent = Array.isArray(response.content)
            ? response.content.map((item) =>
                item && typeof item === 'object' && (item as { type?: string }).type === 'image'
                  ? {
                      type: 'image',
                      mimeType: (item as { mimeType?: string }).mimeType,
                      data: '[image data omitted]',
                    }
                  : item
              )
            : response.content;
          summaryText = JSON.stringify(safeContent);
        } else {
          summaryText = '(出力なし)';
        }
      }

      console.log(`[Worker] MCP tool ${name} completed successfully. (hasImage: ${!!imageOutput}, text: "${summaryText.slice(0, 60)}...")`);

      return {
        text: summaryText,
        image: imageOutput,
        isError: !!response.isError,
        raw: response,
      };
    } catch (err: unknown) {
      console.error(`Error calling MCP tool ${name}:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        text: `Error executing tool ${name}: ${errMsg}`,
        isError: true,
      };
    }
  }

  /**
   * Convert cached MCP tools to OpenAI function calling format
   */
  public getOpenAITools(): Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }> {
    return this.cachedTools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: (t.inputSchema as Record<string, unknown>) || {
          type: 'object',
          properties: {},
        },
      },
    }));
  }
}
