import React from 'react';
import { Cpu, Server, CheckCircle2, XCircle, Zap } from 'lucide-react';
import type { ConnectionStatus } from '../types';

interface StatusBadgeProps {
  status: ConnectionStatus;
  onOpenSettings: () => void;
  onOpenTools: () => void;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  onOpenSettings,
  onOpenTools,
}) => {
  return (
    <div className="flex items-center gap-2.5 text-xs">
      {/* llama.cpp status */}
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition cursor-pointer"
        title={status.llm.error ? `Error: ${status.llm.error}` : 'llama.cpp status'}
      >
        <Cpu className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-slate-300 font-medium">llama.cpp:</span>
        {status.llm.connected ? (
          <span className="flex items-center text-emerald-400 gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span className="truncate max-w-[100px]">{status.llm.model || 'Connected'}</span>
          </span>
        ) : (
          <span className="flex items-center text-rose-400 gap-1">
            <XCircle className="w-3 h-3" />
            <span>Disconnected</span>
          </span>
        )}
      </button>

      {/* /v1/systemone Decision Model status (shown when enabled) */}
      {status.systemOne?.enabled && (
        <button
          onClick={onOpenSettings}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition cursor-pointer ${
            status.systemOne.available
              ? 'bg-cyan-950/60 hover:bg-cyan-900/60 border-cyan-700/70 text-cyan-200'
              : 'bg-amber-950/60 hover:bg-amber-900/60 border-amber-700/70 text-amber-200'
          }`}
          title={
            status.systemOne.error
              ? `SystemOne Error: ${status.systemOne.error}`
              : `/v1/systemone Decision Model 有効 (${status.systemOne.endpoint || '同一サーバー'})`
          }
        >
          <Zap className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-medium">SystemOne:</span>
          {status.systemOne.available ? (
            <span className="flex items-center text-cyan-300 gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="truncate max-w-[90px] font-mono text-[11px]">
                {status.systemOne.model || 'Active'}
              </span>
            </span>
          ) : (
            <span className="flex items-center text-amber-300 gap-1">
              <XCircle className="w-3 h-3 text-amber-400" />
              <span>Unreachable</span>
            </span>
          )}
        </button>
      )}

      {/* NanoKVM MCP status */}
      <button
        onClick={status.mcp.connected ? onOpenTools : onOpenSettings}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition cursor-pointer"
        title={status.mcp.error ? `Error: ${status.mcp.error}` : 'NanoKVM MCP status'}
      >
        <Server className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-slate-300 font-medium">NanoKVM MCP:</span>
        {status.mcp.connected ? (
          <span className="flex items-center text-emerald-400 gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>{status.mcp.toolCount} tools</span>
          </span>
        ) : (
          <span className="flex items-center text-rose-400 gap-1">
            <XCircle className="w-3 h-3" />
            <span>Offline</span>
          </span>
        )}
      </button>
    </div>
  );
};
