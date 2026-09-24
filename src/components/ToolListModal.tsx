import React from 'react';
import { X, Wrench, Code2 } from 'lucide-react';
import type { MCPTool } from '../types';

interface ToolListModalProps {
  isOpen: boolean;
  tools: MCPTool[];
  onClose: () => void;
}

export const ToolListModal: React.FC<ToolListModalProps> = ({
  isOpen,
  tools,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">
              NanoKVM MCP ツール一覧 ({tools.length})
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tools.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>利用可能なツールがありません。NanoKVM MCP サーバーに接続してください。</p>
            </div>
          ) : (
            tools.map((tool) => (
              <div
                key={tool.name}
                className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-purple-300">
                    {tool.name}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    MCP Tool
                  </span>
                </div>
                {tool.description && (
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {tool.description}
                  </p>
                )}
                {tool.inputSchema?.properties &&
                  Object.keys(tool.inputSchema.properties).length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80">
                      <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-1">
                        <Code2 className="w-3 h-3" />
                        <span>引数 (Parameters):</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1 text-xs font-mono bg-slate-950 p-2 rounded">
                        {Object.entries(tool.inputSchema.properties).map(
                          ([key, prop]) => (
                            <div key={key} className="flex items-baseline gap-2">
                              <span className="text-blue-400">{key}:</span>
                              <span className="text-slate-400 text-[11px]">
                                {prop.type}
                                {prop.description ? ` (${prop.description})` : ''}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
