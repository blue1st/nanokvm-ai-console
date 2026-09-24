import React from 'react';
import { Cpu, Server, CheckCircle2, XCircle } from 'lucide-react';
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
    <div className="flex items-center gap-3 text-xs">
      {/* llama.cpp status */}
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition"
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

      {/* NanoKVM MCP status */}
      <button
        onClick={status.mcp.connected ? onOpenTools : onOpenSettings}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition"
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
