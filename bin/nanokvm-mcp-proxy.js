#!/usr/bin/env node

/**
 * NanoKVM MCP Stdio Proxy
 *
 * Bridges local MCP clients (Claude Desktop, Cursor, Antigravity, etc.) using stdio
 * to the remote NanoKVM Go MCP server over HTTPS (with automatic self-signed TLS bypass & API Key auth).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import eventSourcePkg from 'eventsource';

const ResolvedEventSource = eventSourcePkg?.EventSource || eventSourcePkg?.default || eventSourcePkg;
if (typeof globalThis.EventSource === 'undefined' && ResolvedEventSource) {
  globalThis.EventSource = ResolvedEventSource;
}

// Disable TLS reject for self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Log exclusively to stderr to not corrupt stdio JSON-RPC on stdout
function log(...args) {
  console.error('[NanoKVM MCP Proxy]', ...args);
}

// 1. Resolve Config (CLI args -> ENV -> config.json)
function loadConfig() {
  const args = process.argv.slice(2);
  let endpoint = process.env.NANOKVM_ENDPOINT || '';
  let apiKey = process.env.NANOKVM_API_KEY || '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--endpoint' && args[i + 1]) {
      endpoint = args[i + 1];
      i++;
    } else if (args[i] === '--api-key' && args[i + 1]) {
      apiKey = args[i + 1];
      i++;
    }
  }

  if (!endpoint || !apiKey) {
    const candidatePaths = [
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../config.json'),
      path.join(process.cwd(), 'config.json'),
      path.join(os.homedir(), 'Library/Application Support/nanokvm-ai-console/config.json'),
      path.join(os.homedir(), '.config/nanokvm-ai-console/config.json'),
      path.join(os.homedir(), 'Library/Application Support/nanokvm-go-client/config.json'),
      path.join(os.homedir(), '.config/nanokvm-go-client/config.json'),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (raw?.nanokvm?.endpoint) endpoint = endpoint || raw.nanokvm.endpoint;
          if (raw?.nanokvm?.apiKey) apiKey = apiKey || raw.nanokvm.apiKey;
          log(`Loaded NanoKVM config from: ${p}`);
          break;
        } catch {
          // continue
        }
      }
    }
  }

  if (!endpoint) {
    console.error('Error: NanoKVM MCP endpoint is required.');
    console.error('Please specify NANOKVM_ENDPOINT environment variable, --endpoint argument, or configure it in the GUI app.');
    console.error('Check the IP address on your NanoKVM Go OLED screen or Web interface (Settings > MCP).');
    process.exit(1);
  }

  return {
    endpoint,
    apiKey: apiKey || '',
  };
}

async function main() {
  const config = loadConfig();
  log(`Connecting to NanoKVM remote endpoint: ${config.endpoint}...`);

  const formattedAuth = config.apiKey
    ? config.apiKey.startsWith('Bearer ')
      ? config.apiKey
      : `Bearer ${config.apiKey}`
    : '';

  const headers = {};
  if (formattedAuth) {
    headers['Authorization'] = formattedAuth;
  }

  const url = new URL(config.endpoint);

  // Initialize remote MCP client
  const remoteClient = new Client(
    { name: 'nanokvm-stdio-proxy-remote', version: '1.0.0' },
    { capabilities: {} }
  );

  let connected = false;
  try {
    const streamable = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
    await remoteClient.connect(streamable);
    connected = true;
    log('Connected to NanoKVM via Streamable HTTP transport.');
  } catch (err) {
    log('Streamable HTTP connection failed, attempting SSE fallback...', err?.message || err);
    try {
      const sse = new SSEClientTransport(url, {
        eventSourceInit: { headers },
        requestInit: { headers },
      });
      await remoteClient.connect(sse);
      connected = true;
      log('Connected to NanoKVM via SSE transport fallback.');
    } catch (sseErr) {
      log('FATAL: Could not connect to remote NanoKVM MCP server:', sseErr?.message || sseErr);
      process.exit(1);
    }
  }

  // Fetch initial tools to verify connection
  const initialToolsResult = await remoteClient.listTools();
  const toolCount = initialToolsResult.tools?.length || 0;
  log(`Successfully discovered ${toolCount} NanoKVM tool(s):`, initialToolsResult.tools?.map((t) => t.name).join(', '));

  // Initialize Local Stdio Server for Claude Desktop / Cursor / Antigravity
  const localServer = new Server(
    {
      name: 'nanokvm-proxy',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle listTools: delegate to NanoKVM remote
  localServer.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      const res = await remoteClient.listTools();
      return {
        tools: res.tools || [],
      };
    } catch (err) {
      log('Error delegating listTools:', err);
      return { tools: [] };
    }
  });

  // Handle callTool: delegate to NanoKVM remote
  localServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    log(`Executing tool call: ${name} with args:`, JSON.stringify(toolArgs));

    try {
      const res = await remoteClient.callTool({
        name,
        arguments: toolArgs || {},
      });

      return {
        content: res.content || [],
        isError: res.isError || false,
      };
    } catch (err) {
      log(`Error calling tool ${name}:`, err);
      return {
        content: [
          {
            type: 'text',
            text: `Error executing NanoKVM tool ${name}: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect local stdio transport
  const stdioTransport = new StdioServerTransport();
  await localServer.connect(stdioTransport);
  log('NanoKVM MCP Stdio Proxy is running and listening on stdio.');
}

main().catch((err) => {
  log('Unhandled proxy error:', err);
  process.exit(1);
});
