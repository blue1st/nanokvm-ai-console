import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  ChatMessage,
  ConnectionStatus,
  MCPTool,
  ToolCallItem,
  ScheduledJob,
  JobExecutionLog,
  UpdateCheckResult,
} from '../src/types';

export interface ElectronAPI {
  getVersion: () => Promise<string>;
  checkUpdate: () => Promise<UpdateCheckResult>;
  getProxyScriptPath: () => Promise<string>;
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  getLlamaModels: (baseUrl?: string, apiKey?: string) => Promise<string[]>;
  testLlamaConnection: (
    baseUrl: string,
    apiKey: string
  ) => Promise<{ success: boolean; models: string[]; error?: string }>;
  connectMCP: (
    endpoint: string,
    apiKey: string,
    insecureSkipVerify: boolean
  ) => Promise<{ success: boolean; toolCount: number; error?: string }>;
  disconnectMCP: () => Promise<void>;
  getMCPTools: () => Promise<MCPTool[]>;
  callMCPTool: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ text?: string; image?: string; isError?: boolean }>;
  openExternal: (url: string) => Promise<void>;
  getStatus: () => Promise<ConnectionStatus>;
  sendMessage: (params: { history: ChatMessage[]; content: string }) => Promise<void>;
  abortChat: () => Promise<void>;
  sendToolApproval: (toolCallId: string, decision: 'approve' | 'skip' | 'abort') => Promise<void>;

  // Scheduled & Watchdog Jobs
  getJobs: () => Promise<ScheduledJob[]>;
  saveJob: (job: ScheduledJob) => Promise<ScheduledJob[]>;
  deleteJob: (id: string) => Promise<ScheduledJob[]>;
  toggleJob: (id: string, enabled?: boolean) => Promise<ScheduledJob | null>;
  triggerJobNow: (id: string) => Promise<JobExecutionLog | null>;
  getJobLogs: () => Promise<JobExecutionLog[]>;
  clearJobLogs: () => Promise<JobExecutionLog[]>;

  // Event listeners
  onStreamToken: (callback: (token: string) => void) => () => void;
  onToolCallStart: (callback: (toolCall: ToolCallItem) => void) => () => void;
  onToolCallWaitingApproval: (callback: (toolCall: ToolCallItem) => void) => () => void;
  onToolCallComplete: (callback: (toolCall: ToolCallItem) => void) => () => void;
  onStreamDone: (callback: () => void) => () => void;
  onStreamError: (callback: (error: string) => void) => () => void;
  onJobsUpdated: (callback: (jobs: ScheduledJob[]) => void) => () => void;
  onJobLogsUpdated: (callback: (logs: JobExecutionLog[]) => void) => () => void;
}

const api: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  getProxyScriptPath: () => ipcRenderer.invoke('app:getProxyScriptPath'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  getLlamaModels: (url, key) => ipcRenderer.invoke('llama:getModels', url, key),
  testLlamaConnection: (url, key) => ipcRenderer.invoke('llama:test', url, key),
  connectMCP: (endpoint, apiKey, insecureSkipVerify) =>
    ipcRenderer.invoke('mcp:connect', endpoint, apiKey, insecureSkipVerify),
  disconnectMCP: () => ipcRenderer.invoke('mcp:disconnect'),
  getMCPTools: () => ipcRenderer.invoke('mcp:getTools'),
  callMCPTool: (name, args) => ipcRenderer.invoke('mcp:callTool', name, args),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  sendMessage: (params) => ipcRenderer.invoke('chat:send', params),
  abortChat: () => ipcRenderer.invoke('chat:abort'),
  sendToolApproval: (toolCallId, decision) =>
    ipcRenderer.invoke('chat:approveDecision', toolCallId, decision),

  // Scheduled & Watchdog Jobs
  getJobs: () => ipcRenderer.invoke('jobs:getAll'),
  saveJob: (job) => ipcRenderer.invoke('jobs:save', job),
  deleteJob: (id) => ipcRenderer.invoke('jobs:delete', id),
  toggleJob: (id, enabled) => ipcRenderer.invoke('jobs:toggle', id, enabled),
  triggerJobNow: (id) => ipcRenderer.invoke('jobs:triggerNow', id),
  getJobLogs: () => ipcRenderer.invoke('jobs:getLogs'),
  clearJobLogs: () => ipcRenderer.invoke('jobs:clearLogs'),

  onStreamToken: (callback) => {
    const subscription = (_: unknown, token: string) => callback(token);
    ipcRenderer.on('chat:token', subscription);
    return () => ipcRenderer.removeListener('chat:token', subscription);
  },
  onToolCallStart: (callback) => {
    const subscription = (_: unknown, tc: ToolCallItem) => callback(tc);
    ipcRenderer.on('chat:tool_start', subscription);
    return () => ipcRenderer.removeListener('chat:tool_start', subscription);
  },
  onToolCallWaitingApproval: (callback) => {
    const subscription = (_: unknown, tc: ToolCallItem) => callback(tc);
    ipcRenderer.on('chat:tool_waiting_approval', subscription);
    return () => ipcRenderer.removeListener('chat:tool_waiting_approval', subscription);
  },
  onToolCallComplete: (callback) => {
    const subscription = (_: unknown, tc: ToolCallItem) => callback(tc);
    ipcRenderer.on('chat:tool_complete', subscription);
    return () => ipcRenderer.removeListener('chat:tool_complete', subscription);
  },
  onStreamDone: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('chat:done', subscription);
    return () => ipcRenderer.removeListener('chat:done', subscription);
  },
  onStreamError: (callback) => {
    const subscription = (_: unknown, err: string) => callback(err);
    ipcRenderer.on('chat:error', subscription);
    return () => ipcRenderer.removeListener('chat:error', subscription);
  },
  onJobsUpdated: (callback) => {
    const subscription = (_: unknown, jobs: any) => callback(jobs);
    ipcRenderer.on('jobs:updated', subscription);
    return () => ipcRenderer.removeListener('jobs:updated', subscription);
  },
  onJobLogsUpdated: (callback) => {
    const subscription = (_: unknown, logs: any) => callback(logs);
    ipcRenderer.on('jobs:logsUpdated', subscription);
    return () => ipcRenderer.removeListener('jobs:logsUpdated', subscription);
  },
};

contextBridge.exposeInMainWorld('api', api);
