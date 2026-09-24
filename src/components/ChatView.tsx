import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Monitor, Square, X } from 'lucide-react';
import { MessageItem } from './MessageItem';
import { QuickActionBar } from './QuickActionBar';
import type { ChatMessage, MCPTool } from '../types';

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  mcpConnected: boolean;
  mcpTools: MCPTool[];
  onAddMessage: (msg: ChatMessage) => void;
  insertPrompt?: string;
  onClearInsertPrompt?: () => void;
}

const QUICK_ACTIONS = [
  { label: '現在の画面を確認', prompt: 'NanoKVMを使って現在の画面を確認し、どのような状態が表示されているか教えてください。' },
  { label: '画面中央をクリック', prompt: '画面の中央をクリックしてください。' },
  { label: 'Enterキーを押す', prompt: 'Enterキーを入力してください。' },
  { label: '端末を開いて確認', prompt: 'ターミナルを開いて、ifconfigまたはip aでネットワーク情報を確認してください。' },
];

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isStreaming,
  onSendMessage,
  mcpConnected,
  mcpTools,
  onAddMessage,
  insertPrompt,
  onClearInsertPrompt,
}) => {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Insert prompt from visual picker or external suggestions
  useEffect(() => {
    if (insertPrompt) {
      setInput((prev) => (prev ? `${prev}\n${insertPrompt}` : insertPrompt));
      onClearInsertPrompt?.();
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = `${Math.min(
            textareaRef.current.scrollHeight,
            160
          )}px`;
        }
      }, 50);
    }
  }, [insertPrompt, onClearInsertPrompt]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSendMessage(input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950 select-text"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Quick Action Bar for KVM & Hardware controls */}
      <QuickActionBar
        mcpConnected={mcpConnected}
        mcpTools={mcpTools}
        onAddMessage={onAddMessage}
        onSendChatPrompt={onSendMessage}
      />

      {/* Messages timeline */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-blue-400 shadow-xl shadow-blue-500/10">
              <Monitor className="w-8 h-8" />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="text-lg font-semibold text-slate-200">
                NanoKVM AI Console
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                ローカルの llama.cpp server と NanoKVM Go の Remote MCP が連携して、ターゲットPCの画面認識やキーボード・マウス操作を実行します。
              </p>
            </div>

            {/* Quick Actions */}
            <div className="w-full max-w-lg space-y-2 pt-4">
              <div className="flex items-center justify-center gap-1 text-xs text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>ワンクリックで試す:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                {QUICK_ACTIONS.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSendMessage(action.prompt)}
                    disabled={isStreaming}
                    className="p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 text-xs text-slate-300 hover:text-white transition flex flex-col gap-0.5 group"
                  >
                    <span className="font-medium text-slate-200 group-hover:text-blue-400 transition">
                      {action.label}
                    </span>
                    <span className="text-[11px] text-slate-400 line-clamp-1">
                      {action.prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <MessageItem
                key={msg.id || idx}
                message={msg}
                isStreaming={isStreaming && idx === messages.length - 1 && msg.role === 'assistant'}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/40">
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Quick suggestions when conversation exists */}
          {messages.length > 0 && showSuggestions && (
            <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-slate-400 shrink-0 text-[11px]">提案:</span>
                {QUICK_ACTIONS.slice(0, 3).map((act, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSendMessage(act.prompt)}
                    disabled={isStreaming}
                    className="px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] whitespace-nowrap transition border border-slate-700/60 cursor-pointer"
                  >
                    {act.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowSuggestions(false)}
                className="p-1 text-slate-500 hover:text-slate-300 transition shrink-0 cursor-pointer"
                title="提案を非表示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="relative flex items-end bg-slate-900 border border-slate-700/80 rounded-xl shadow-lg focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputResize}
              onKeyDown={handleKeyDown}
              placeholder={
                mcpConnected
                  ? 'NanoKVMへの指示を入力してください (例: 画面を確認して、ターミナルでlsを実行して...)'
                  : 'メッセージを入力してください (NanoKVM MCPが未接続の場合は通常チャットになります)'
              }
              rows={1}
              className="w-full py-3 pl-4 pr-12 text-sm bg-transparent text-slate-100 placeholder-slate-500 resize-none focus:outline-none max-h-40 min-h-[44px]"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={() => window.api?.abortChat()}
                className="absolute right-2 bottom-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition shadow-md shadow-rose-600/30 flex items-center gap-1.5 animate-pulse cursor-pointer"
                title="思考・操作を緊急停止 (Kill)"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className="absolute right-2 bottom-2 p-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition shadow-md shadow-blue-600/20 cursor-pointer"
                title="送信 (Enter)"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
            <span>Shift + Enter で改行 / Enter で送信</span>
            {isStreaming && (
              <span className="text-blue-400 animate-pulse">LLMが思考中...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
