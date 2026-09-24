import React, { useState } from 'react';
import {
  Camera,
  Power,
  RotateCcw,
  Keyboard,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { MCPTool, ChatMessage } from '../types';

interface QuickActionBarProps {
  mcpConnected: boolean;
  mcpTools: MCPTool[];
  onAddMessage: (msg: ChatMessage) => void;
  onSendChatPrompt: (prompt: string) => void;
}

export const QuickActionBar: React.FC<QuickActionBarProps> = ({
  mcpConnected,
  mcpTools,
  onAddMessage,
  onSendChatPrompt,
}) => {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('nanokvm_quick_action_collapsed') === 'true';
  });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('nanokvm_quick_action_collapsed', String(next));
      return next;
    });
  };

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((current) => (current?.text === text ? null : current));
    }, 4000);
  };

  // 1. Capture screen directly
  const handleCaptureScreen = async () => {
    if (!mcpConnected || !window.api) {
      onSendChatPrompt('現在の画面を確認してください');
      return;
    }

    setRunningAction('capture');
    try {
      // Find screenshot tool
      const screenTool =
        mcpTools.find((t) => /screen|capture|shot|display|image/i.test(t.name))?.name ||
        'screenshot';

      const res = await window.api.callMCPTool(screenTool, {});
      if (res.isError) {
        showFeedback('error', res.text || '画面取得に失敗しました');
      } else {
        showFeedback('success', '画面をキャプチャしました');
        // Add to chat messages so it automatically appears in timeline & sidebar
        const captureMessage: ChatMessage = {
          id: `capture_${Date.now()}`,
          role: 'assistant',
          content: '📸 **クイック画面キャプチャ**: 最新の画面を取得しました。',
          timestamp: Date.now(),
          toolCalls: [
            {
              id: `tc_${Date.now()}`,
              name: screenTool,
              arguments: {},
              status: 'completed',
              result: {
                text: res.text,
                image: res.image,
              },
            },
          ],
        };
        onAddMessage(captureMessage);
      }
    } catch (err) {
      showFeedback('error', `エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningAction(null);
    }
  };

  // 2. Send Ctrl+Alt+Del
  const handleCtrlAltDel = async () => {
    if (!mcpConnected || !window.api) {
      onSendChatPrompt('Ctrl+Alt+Delete を送信してください');
      return;
    }

    setRunningAction('ctrl_alt_del');
    try {
      const keyTool = mcpTools.find((t) => /key|hotkey|combo|press/i.test(t.name))?.name;
      if (keyTool) {
        // Try common key combination argument patterns
        const argsCandidates = [
          { keys: ['Control', 'Alt', 'Delete'] },
          { combination: 'ctrl+alt+del' },
          { key: 'ctrl+alt+delete' },
          { text: 'ctrl+alt+del' },
        ];
        let called = false;
        for (const args of argsCandidates) {
          const res = await window.api.callMCPTool(keyTool, args);
          if (!res.isError) {
            called = true;
            break;
          }
        }
        if (called) {
          showFeedback('success', 'Ctrl+Alt+Del を送信しました');
        } else {
          // Fallback to chat prompt
          onSendChatPrompt('Ctrl+Alt+Delete キーを送信してください');
        }
      } else {
        onSendChatPrompt('Ctrl+Alt+Delete キーを送信してください');
      }
    } catch (err) {
      showFeedback('error', `エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningAction(null);
    }
  };

  // 3. Power Button (Short Press)
  const handlePowerShort = async () => {
    if (!confirm('電源ボタン（短押し）を送信しますか？')) return;
    setRunningAction('power_short');
    try {
      const powerTool = mcpTools.find((t) => /power|pwr|gpio/i.test(t.name))?.name;
      if (powerTool && window.api) {
        const res = await window.api.callMCPTool(powerTool, { action: 'press', type: 'short' });
        if (!res.isError) {
          showFeedback('success', '電源ボタン（短押し）シグナルを送信しました');
        } else {
          onSendChatPrompt('電源ボタン（短押し）を押してください');
        }
      } else {
        onSendChatPrompt('ターゲットPCの電源ボタン（短押し）を押してください');
      }
    } catch (err) {
      showFeedback('error', `エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningAction(null);
    }
  };

  // 4. Force Power Off (Long Press 5s)
  const handlePowerLong = async () => {
    if (!confirm('⚠️ 警告: 電源ボタン長押し（強制電源OFF）を実行しますか？')) return;
    setRunningAction('power_long');
    try {
      const powerTool = mcpTools.find((t) => /power|pwr|gpio/i.test(t.name))?.name;
      if (powerTool && window.api) {
        const res = await window.api.callMCPTool(powerTool, { action: 'long_press', duration_sec: 5 });
        if (!res.isError) {
          showFeedback('success', '強制電源OFF（長押し）を実行しました');
        } else {
          onSendChatPrompt('電源ボタンを5秒長押しして強制シャットダウンしてください');
        }
      } else {
        onSendChatPrompt('電源ボタンを5秒長押しして強制シャットダウンしてください');
      }
    } catch (err) {
      showFeedback('error', `エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningAction(null);
    }
  };

  // 5. Hardware Reset
  const handleReset = async () => {
    if (!confirm('⚠️ 警告: マシンをハードウェアリセット（再起動）しますか？')) return;
    setRunningAction('reset');
    try {
      const resetTool = mcpTools.find((t) => /reset|reboot/i.test(t.name))?.name;
      if (resetTool && window.api) {
        const res = await window.api.callMCPTool(resetTool, { action: 'reset' });
        if (!res.isError) {
          showFeedback('success', 'リセットシグナルを送信しました');
        } else {
          onSendChatPrompt('マシンをハードウェアリセットしてください');
        }
      } else {
        onSendChatPrompt('NanoKVMのリセットボタンを押してマシンを再起動してください');
      }
    } catch (err) {
      showFeedback('error', `エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningAction(null);
    }
  };

  if (isCollapsed) {
    return (
      <div className="h-6 px-4 border-b border-slate-800/60 bg-slate-900/30 flex items-center justify-between text-[11px] select-none text-slate-400">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-1.5 hover:text-slate-200 transition cursor-pointer"
          title="KVMハードウェア操作バーを展開"
        >
          <ChevronDown className="w-3.5 h-3.5 text-blue-400" />
          <span>KVMハードウェア操作バーを表示</span>
        </button>
        {feedback && (
          <div
            className={`flex items-center gap-1 text-[10px] animate-fadeIn ${
              feedback.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-rose-400" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-10 px-4 border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-sm flex items-center justify-between gap-3 text-xs select-none">
      {/* Left: Action Buttons */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1 hidden sm:inline">
          KVM Action:
        </span>

        {/* Capture button */}
        <button
          type="button"
          onClick={handleCaptureScreen}
          disabled={runningAction !== null}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/70 transition shadow-sm disabled:opacity-40 cursor-pointer"
          title="今すぐスクリーンショットを取得"
        >
          {runningAction === 'capture' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
          ) : (
            <Camera className="w-3.5 h-3.5 text-blue-400" />
          )}
          <span className="font-medium">スクショ撮影</span>
        </button>

        {/* Ctrl+Alt+Del */}
        <button
          type="button"
          onClick={handleCtrlAltDel}
          disabled={runningAction !== null}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/70 transition shadow-sm disabled:opacity-40 cursor-pointer"
          title="Ctrl+Alt+Del キーシグナル送信"
        >
          {runningAction === 'ctrl_alt_del' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
          ) : (
            <Keyboard className="w-3.5 h-3.5 text-purple-400" />
          )}
          <span className="font-mono text-[11px]">Ctrl+Alt+Del</span>
        </button>

        {/* Power Short */}
        <button
          type="button"
          onClick={handlePowerShort}
          disabled={runningAction !== null}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/70 transition shadow-sm disabled:opacity-40 cursor-pointer"
          title="電源ボタン（短押し: 電源ON/ACPI通常終了）"
        >
          {runningAction === 'power_short' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span>電源ボタン</span>
        </button>

        {/* Reset */}
        <button
          type="button"
          onClick={handleReset}
          disabled={runningAction !== null}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800 hover:bg-rose-950/60 hover:text-rose-200 hover:border-rose-800/80 text-slate-300 border border-slate-700/70 transition shadow-sm disabled:opacity-40 cursor-pointer"
          title="ハードウェアリセット"
        >
          {runningAction === 'reset' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
          )}
          <span>リセット</span>
        </button>

        {/* Power Long Press (Force OFF) */}
        <button
          type="button"
          onClick={handlePowerLong}
          disabled={runningAction !== null}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800 hover:bg-rose-950/60 hover:text-rose-200 hover:border-rose-800/80 text-slate-300 border border-slate-700/70 transition shadow-sm disabled:opacity-40 cursor-pointer"
          title="強制電源OFF (5秒長押し)"
        >
          {runningAction === 'power_long' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
          ) : (
            <Power className="w-3.5 h-3.5 text-rose-500" />
          )}
          <span>強制OFF</span>
        </button>
      </div>

      {/* Right: Feedback Toast & Collapse Toggle */}
      <div className="flex items-center gap-2">
        {feedback && (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] animate-fadeIn ${
              feedback.type === 'success'
                ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
                : 'bg-rose-950/70 border border-rose-800 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            )}
            <span className="font-medium">{feedback.text}</span>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          title="バーを折りたたむ"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
