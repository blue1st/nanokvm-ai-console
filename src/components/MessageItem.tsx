import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  User,
  Bot,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  Target,
  ShieldAlert,
  Check,
  SkipForward,
} from 'lucide-react';
import { VisualOverlayImage } from './VisualOverlayImage';
import type { ChatMessage, ToolCallItem } from '../types';

interface MessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isStreaming = false,
}) => {
  const isUser = message.role === 'user';
  const [selectedPreview, setSelectedPreview] = useState<{
    imageUrl: string;
    marker?: { x: number; y: number; label?: string };
  } | null>(null);

  // Helper to extract mouse click / move coordinates from this message's tool calls
  const findMarkerForImage = (currentToolCallIndex: number): { x: number; y: number; label?: string } | undefined => {
    if (!message.toolCalls) return undefined;
    // Check next tool calls or current tool call for mouse action
    for (let i = currentToolCallIndex; i < message.toolCalls.length; i++) {
      const tc = message.toolCalls[i];
      const args = tc.arguments || {};
      const x = typeof args.x === 'number' ? args.x : typeof args.x === 'string' ? parseFloat(args.x) : undefined;
      const y = typeof args.y === 'number' ? args.y : typeof args.y === 'string' ? parseFloat(args.y) : undefined;
      if (x !== undefined && y !== undefined && !isNaN(x) && !isNaN(y)) {
        return {
          x,
          y,
          label: `${tc.name} (${Math.round(x)}, ${Math.round(y)})`,
        };
      }
    }
    return undefined;
  };

  // ESC key to close preview modal
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedPreview) {
        setSelectedPreview(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPreview]);

  return (
    <div
      id={`msg-${message.id}`}
      className={`flex gap-4 p-4 rounded-xl transition-all duration-300 ${
        isUser
          ? 'bg-blue-950/20 border border-blue-900/30'
          : 'bg-slate-900/40 border border-slate-800/60'
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isUser
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
            : 'bg-purple-600 text-white shadow-lg shadow-purple-500/20'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-3 min-w-0">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-medium text-slate-300">
            {isUser ? 'あなた' : 'NanoKVM AI アシスタント'}
          </span>
          <span className="font-mono">{new Date(message.timestamp).toLocaleTimeString()}</span>
        </div>

        {/* Tool calls (if any) */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-2 pt-1">
            {message.toolCalls.map((tc, idx) => {
              const marker = findMarkerForImage(idx);
              return (
                <ToolCallCard
                  key={tc.id || idx}
                  toolCall={tc}
                  marker={marker}
                  onSelectImage={(img, m) => setSelectedPreview({ imageUrl: img, marker: m })}
                />
              );
            })}
          </div>
        )}

        {/* Content markdown */}
        {message.content ? (
          <div className="text-sm leading-relaxed text-slate-200 prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-blue-400 animate-pulse align-middle" />
            )}
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span>応答を生成中...</span>
          </div>
        ) : null}
      </div>

      {/* Image Modal Preview (Expanded to window size) */}
      {selectedPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-2 md:p-3 select-none"
          onClick={() => setSelectedPreview(null)}
        >
          <div
            className="relative w-[98vw] h-[96vh] max-w-[1920px] bg-slate-900 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="h-11 px-4 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                  <Target className="w-4 h-4 text-blue-400" />
                  <span>画面プレビュー & 操作オーバーレイ</span>
                </span>
                <span className="text-[10px] text-slate-400 bg-slate-800/80 border border-slate-700 px-2 py-0.5 rounded-full font-mono">
                  Esc で閉じる
                </span>
              </div>
              <button
                onClick={() => setSelectedPreview(null)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition cursor-pointer"
                title="閉じる (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 p-2 md:p-4 bg-slate-950 flex items-center justify-center overflow-hidden min-h-0 relative">
              <VisualOverlayImage
                src={selectedPreview.imageUrl}
                marker={selectedPreview.marker}
                className="max-h-full max-w-full border-none shadow-none flex items-center justify-center bg-transparent"
                imageClassName="max-h-[calc(96vh-4rem)] max-w-[calc(98vw-2rem)] w-auto h-auto object-contain rounded-lg shadow-xl"
                showOverlayToggle={true}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ToolCallCardProps {
  toolCall: ToolCallItem;
  marker?: { x: number; y: number; label?: string };
  onSelectImage: (img: string, marker?: { x: number; y: number; label?: string }) => void;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolCall,
  marker,
  onSelectImage,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const getStatusBadge = () => {
    switch (toolCall.status) {
      case 'waiting_approval':
        return (
          <span className="flex items-center gap-1 text-[11px] text-amber-300 bg-amber-950/70 border border-amber-500/60 px-2 py-0.5 rounded-full font-medium animate-pulse">
            <ShieldAlert className="w-3 h-3 text-amber-400" />
            承認待ち
          </span>
        );
      case 'running':
        return (
          <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/50 px-2 py-0.5 rounded-full">
            <Loader2 className="w-3 h-3 animate-spin" />
            実行中...
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            完了
          </span>
        );
      case 'skipped':
        return (
          <span className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded-full">
            <SkipForward className="w-3 h-3 text-slate-400" />
            スキップ
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-[11px] text-rose-400 bg-rose-950/40 border border-rose-800/50 px-2 py-0.5 rounded-full">
            <XCircle className="w-3 h-3" />
            エラー
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`border rounded-lg overflow-hidden text-xs transition-colors ${
        toolCall.status === 'waiting_approval'
          ? 'border-amber-500/80 bg-slate-950 shadow-lg shadow-amber-500/10'
          : 'border-slate-800 bg-slate-950/60'
      }`}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-3 py-2 bg-slate-900/60 hover:bg-slate-800/40 cursor-pointer select-none transition"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          )}
          <Wrench className="w-3.5 h-3.5 text-purple-400" />
          <span className="font-mono font-medium text-purple-300">
            {toolCall.name}
          </span>
        </div>
        <div className="flex items-center gap-2">{getStatusBadge()}</div>
      </div>

      {/* Waiting Approval Interactive Banner */}
      {toolCall.status === 'waiting_approval' && (
        <div className="p-3 bg-amber-950/40 border-t border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-amber-200">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />
            <div>
              <div className="font-semibold text-xs text-amber-300">
                ツールの実行承認が必要です
              </div>
              <div className="text-[11px] text-amber-400/90 font-mono">
                {toolCall.name}({JSON.stringify(toolCall.arguments).slice(0, 50)}...)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => window.api?.sendToolApproval(toolCall.id, 'approve')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>承認して実行</span>
            </button>
            <button
              type="button"
              onClick={() => window.api?.sendToolApproval(toolCall.id, 'skip')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition border border-slate-700 cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
              <span>スキップ</span>
            </button>
            <button
              type="button"
              onClick={() => window.api?.sendToolApproval(toolCall.id, 'abort')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>中断</span>
            </button>
          </div>
        </div>
      )}

      {/* Screen Capture Image Preview with Visual Overlay */}
      {toolCall.result?.image && (
        <div className="p-3 bg-slate-950 border-t border-slate-800/80">
          <VisualOverlayImage
            src={toolCall.result.image}
            marker={marker}
            onPreview={() => onSelectImage(toolCall.result!.image!, marker)}
          />
        </div>
      )}

      {/* Expandable Details: Arguments & Text Output */}
      {isOpen && (
        <div className="p-3 space-y-2 border-t border-slate-800 bg-slate-950 font-mono text-[11px]">
          <div>
            <div className="text-slate-400 font-semibold mb-1">引数 (Arguments):</div>
            <pre className="p-2 rounded bg-slate-900 text-slate-300 overflow-x-auto">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>

          {toolCall.result?.text && (
            <div>
              <div className="text-slate-400 font-semibold mb-1">出力 (Result):</div>
              <pre className="p-2 rounded bg-slate-900 text-slate-300 overflow-x-auto whitespace-pre-wrap">
                {toolCall.result.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
