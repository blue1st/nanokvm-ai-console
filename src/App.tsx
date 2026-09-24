import React, { useState, useEffect, useMemo } from 'react';
import {
  Settings,
  MonitorPlay,
  Tv,
  Image as ImageIcon,
  X,
  Shield,
  ShieldCheck,
  Clock,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { StatusBadge } from './components/StatusBadge';
import { SettingsModal } from './components/SettingsModal';
import { ToolListModal } from './components/ToolListModal';
import { SchedulerModal } from './components/SchedulerModal';
import { ChatView } from './components/ChatView';
import { ScreenshotSidebar } from './components/ScreenshotSidebar';
import { LiveViewPanel } from './components/LiveViewPanel';
import { DiffModal } from './components/DiffModal';
import { VisualOverlayImage } from './components/VisualOverlayImage';
import type {
  AppConfig,
  ChatMessage,
  ConnectionStatus,
  MCPTool,
  ToolCallItem,
  ScreenshotHistoryItem,
  ScheduledJob,
  UpdateCheckResult,
} from './types';

export const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>({
    llm: { connected: false },
    mcp: { connected: false, toolCount: 0 },
  });
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);

  // App version and updates
  const [appVersion, setAppVersion] = useState<string>('');
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');

  // UI state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLiveViewOpen, setIsLiveViewOpen] = useState(false);
  const [insertPrompt, setInsertPrompt] = useState<string>('');

  // Modals state
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [diffModal, setDiffModal] = useState<{
    isOpen: boolean;
    before: ScreenshotHistoryItem | null;
    after: ScreenshotHistoryItem | null;
  }>({ isOpen: false, before: null, after: null });

  // Load status, tools and config
  const refreshStatus = async () => {
    if (!window.api) return;
    try {
      const currentStatus = await window.api.getStatus();
      setStatus(currentStatus);
      if (currentStatus.mcp.connected) {
        const tools = await window.api.getMCPTools();
        setMcpTools(tools);
      } else {
        setMcpTools([]);
      }
      const loadedConfig = await window.api.getConfig();
      setConfig(loadedConfig);
      const jobs: ScheduledJob[] = await window.api.getJobs();
      setActiveJobCount(jobs.filter((j: ScheduledJob) => j.enabled).length);
    } catch (err) {
      console.error('Failed to get status:', err);
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 8000);

    if (window.api) {
      window.api.getVersion().then((v: string) => {
        setAppVersion(v);
      }).catch(() => {});

      // Check update in background
      window.api.checkUpdate().then((res: UpdateCheckResult) => {
        if (res.hasUpdate) {
          setHasUpdate(true);
          setLatestVersion(res.latestVersion);
        }
      }).catch(() => {});
    }

    return () => clearInterval(interval);
  }, []);

  // Listen for scheduled job updates
  useEffect(() => {
    if (!window.api?.onJobsUpdated) return;
    const unsub = window.api.onJobsUpdated((jobs: ScheduledJob[]) => {
      setActiveJobCount(jobs.filter((j: ScheduledJob) => j.enabled).length);
    });
    return unsub;
  }, []);

  // Listen for Electron stream events
  useEffect(() => {
    if (!window.api) return;

    const unsubToken = window.api.onStreamToken((token: string) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role === 'assistant') {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + token },
          ];
        }
        return prev;
      });
    });

    const unsubToolStart = window.api.onToolCallStart((toolCall: ToolCallItem) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role === 'assistant') {
          const currentCalls = last.toolCalls || [];
          const exists = currentCalls.some((c) => c.id === toolCall.id);
          const updatedCalls = exists
            ? currentCalls.map((c) => (c.id === toolCall.id ? toolCall : c))
            : [...currentCalls, toolCall];
          return [
            ...prev.slice(0, -1),
            { ...last, toolCalls: updatedCalls },
          ];
        }
        return prev;
      });
    });

    const unsubToolWaitingApproval = window.api.onToolCallWaitingApproval(
      (toolCall: ToolCallItem) => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role === 'assistant') {
            const currentCalls = last.toolCalls || [];
            const exists = currentCalls.some((c) => c.id === toolCall.id);
            const updatedCalls = exists
              ? currentCalls.map((c) => (c.id === toolCall.id ? toolCall : c))
              : [...currentCalls, toolCall];
            return [
              ...prev.slice(0, -1),
              { ...last, toolCalls: updatedCalls },
            ];
          }
          return prev;
        });
      }
    );

    const unsubToolComplete = window.api.onToolCallComplete((toolCall: ToolCallItem) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role === 'assistant') {
          const currentCalls = last.toolCalls || [];
          const updatedCalls = currentCalls.map((c) =>
            c.id === toolCall.id ? toolCall : c
          );
          return [
            ...prev.slice(0, -1),
            { ...last, toolCalls: updatedCalls },
          ];
        }
        return prev;
      });
    });

    const unsubDone = window.api.onStreamDone(() => {
      setIsStreaming(false);
    });

    const unsubError = window.api.onStreamError((err: string) => {
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **エラーが発生しました**: ${err}`,
          timestamp: Date.now(),
        },
      ]);
    });

    return () => {
      unsubToken();
      unsubToolStart();
      unsubToolWaitingApproval();
      unsubToolComplete();
      unsubDone();
      unsubError();
    };
  }, []);

  // Collect screenshot history from messages (chronological descending)
  const screenshots: ScreenshotHistoryItem[] = useMemo(() => {
    const list: ScreenshotHistoryItem[] = [];
    messages.forEach((msg) => {
      if (msg.toolCalls) {
        msg.toolCalls.forEach((tc, tcIdx) => {
          if (tc.result?.image) {
            // Find coordinate marker if there is a mouse action
            let marker: { x: number; y: number; label?: string } | undefined;
            for (let i = tcIdx; i < msg.toolCalls!.length; i++) {
              const nextTc = msg.toolCalls![i];
              const args = nextTc.arguments || {};
              const x =
                typeof args.x === 'number'
                  ? args.x
                  : typeof args.x === 'string'
                  ? parseFloat(args.x)
                  : undefined;
              const y =
                typeof args.y === 'number'
                  ? args.y
                  : typeof args.y === 'string'
                  ? parseFloat(args.y)
                  : undefined;
              if (x !== undefined && y !== undefined && !isNaN(x) && !isNaN(y)) {
                marker = {
                  x,
                  y,
                  label: `${nextTc.name} (${Math.round(x)}, ${Math.round(y)})`,
                };
                break;
              }
            }

            list.unshift({
              id: `${msg.id}_${tc.id}`,
              timestamp: msg.timestamp,
              imageUrl: tc.result.image,
              messageId: msg.id,
              toolName: tc.name,
              toolArgs: tc.arguments,
              marker,
            });
          }
        });
      }
    });
    return list;
  }, [messages]);

  // Delete a single screenshot by its ID (`${msg.id}_${tc.id}`)
  const handleDeleteScreenshot = (screenshotId: string) => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) => {
        if (!msg.toolCalls) return msg;
        const updatedCalls = msg.toolCalls.map((tc) => {
          if (`${msg.id}_${tc.id}` === screenshotId) {
            return {
              ...tc,
              result: tc.result ? { ...tc.result, image: undefined } : undefined,
            };
          }
          return tc;
        });
        return { ...msg, toolCalls: updatedCalls };
      })
    );
  };

  // Delete multiple screenshots by IDs
  const handleDeleteScreenshots = (ids: string[]) => {
    const idSet = new Set(ids);
    setMessages((prevMessages) =>
      prevMessages.map((msg) => {
        if (!msg.toolCalls) return msg;
        const updatedCalls = msg.toolCalls.map((tc) => {
          if (idSet.has(`${msg.id}_${tc.id}`)) {
            return {
              ...tc,
              result: tc.result ? { ...tc.result, image: undefined } : undefined,
            };
          }
          return tc;
        });
        return { ...msg, toolCalls: updatedCalls };
      })
    );
  };

  // Prune screenshots, keeping only the latest `keepCount` items
  const handlePruneScreenshots = (keepCount: number) => {
    if (screenshots.length <= keepCount) return;
    const toDeleteIds = screenshots.slice(keepCount).map((s) => s.id);
    handleDeleteScreenshots(toDeleteIds);
  };

  // Clear all screenshot image data from messages to reclaim memory
  const handleClearAllScreenshots = () => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) => {
        if (!msg.toolCalls) return msg;
        const updatedCalls = msg.toolCalls.map((tc) => ({
          ...tc,
          result: tc.result ? { ...tc.result, image: undefined } : undefined,
        }));
        return { ...msg, toolCalls: updatedCalls };
      })
    );
  };

  // Auto-prune screenshots when exceeding maxScreenshots limit
  useEffect(() => {
    const limit = config?.maxScreenshots;
    if (typeof limit === 'number' && limit > 0 && screenshots.length > limit) {
      const toDeleteIds = screenshots.slice(limit).map((s) => s.id);
      handleDeleteScreenshots(toDeleteIds);
    }
  }, [screenshots.length, config?.maxScreenshots]);

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewImage) setPreviewImage(null);
        if (diffModal.isOpen) setDiffModal({ isOpen: false, before: null, after: null });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage, diffModal.isOpen]);

  const handleSendMessage = async (text: string) => {
    if (!window.api || isStreaming) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const assistantMessage: ChatMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
    };

    const newHistory = [...messages, userMessage];
    setMessages([...newHistory, assistantMessage]);
    setIsStreaming(true);

    try {
      await window.api.sendMessage({
        history: messages,
        content: text,
      });
    } catch (err: unknown) {
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          ...assistantMessage,
          content: `⚠️ **メッセージ送信エラー**: ${errMsg}`,
        },
      ]);
    }
  };

  const handleAddDirectMessage = (msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  };

  const handleSaveConfig = async (newConfig: AppConfig) => {
    if (!window.api) return;
    await window.api.saveConfig(newConfig);
    await refreshStatus();
  };

  const handleClearHistory = () => {
    if (confirm('チャット履歴をクリアしますか？')) {
      setMessages([]);
    }
  };

  // Smooth scroll and flash highlight message in timeline
  const handleSelectMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-blue-500', 'bg-blue-950/40');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-950/40');
      }, 2000);
    }
  };

  const handleToggleStepMode = async () => {
    if (!config) return;
    const updated = { ...config, stepExecutionMode: !config.stepExecutionMode };
    setConfig(updated);
    if (window.api) {
      await window.api.saveConfig(updated);
    }
  };

  const handlePickCoordinates = (coords: { x: number; y: number }) => {
    setInsertPrompt(`画面上の座標 (${coords.x}, ${coords.y}) をクリックしてください。`);
    setPreviewImage(null);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 select-none overflow-hidden text-slate-100">
      {/* Top Header Bar */}
      <header
        className="h-14 border-b border-slate-800 bg-slate-900/70 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: App Title (Space for Mac traffic lights) */}
        <div
          className="flex items-center gap-2.5 pl-16"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <MonitorPlay className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold text-white tracking-tight leading-none">
                NanoKVM AI Console
              </h1>
              {appVersion && (
                <span className="text-[10px] text-slate-400 font-mono bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60 leading-none">
                  v{appVersion}
                </span>
              )}
              {hasUpdate && (
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-950/80 border border-amber-600/70 px-1.5 py-0.5 rounded-full font-medium hover:bg-amber-900 transition animate-pulse cursor-pointer"
                  title={`新バージョン v${latestVersion} が利用可能です。クリックして設定画面を開く`}
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>v{latestVersion} 更新あり</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-slate-400 font-mono">
                Remote MCP &amp; LLM Agent
              </span>
              <button
                type="button"
                onClick={() =>
                  window.api
                    ? window.api.openExternal('https://github.com/blue1st/nanokvm-ai-console')
                    : window.open('https://github.com/blue1st/nanokvm-ai-console', '_blank')
                }
                className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-0.5 transition cursor-pointer"
                title="GitHub リポジトリ (https://github.com/blue1st/nanokvm-ai-console)"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                <span>GitHub</span>
              </button>
            </div>
          </div>
        </div>

        {/* Center: Connection status */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <StatusBadge
            status={status}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenTools={() => setIsToolsOpen(true)}
          />
        </div>

        {/* Right: Actions & Panel Toggles */}
        <div
          className="flex items-center gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Step Approval Safety Mode Toggle */}
          <button
            onClick={handleToggleStepMode}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
              config?.stepExecutionMode
                ? 'bg-amber-950/80 border-amber-600 text-amber-300 shadow-md shadow-amber-500/20'
                : 'bg-slate-800/80 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
            title={
              config?.stepExecutionMode
                ? 'ステップ承認モード: 有効 (操作前に確認ダイアログを表示)'
                : 'ステップ承認モード: 無効 (クリックして安全承認モードを有効化)'
            }
          >
            {config?.stepExecutionMode ? (
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Shield className="w-3.5 h-3.5" />
            )}
            <span className="hidden md:inline">
              {config?.stepExecutionMode ? '承認モードON' : '承認モード'}
            </span>
          </button>

          {/* Live View Toggle */}
          <button
            onClick={() => setIsLiveViewOpen(!isLiveViewOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
              isLiveViewOpen
                ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700'
            }`}
            title="リアルタイムWebKVM画面の表示/非表示"
          >
            <Tv className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Live View</span>
          </button>

          {/* Screenshot Sidebar Toggle */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`p-2 rounded-lg border text-xs transition cursor-pointer relative ${
              isSidebarOpen
                ? 'bg-blue-950/80 border-blue-600 text-blue-300 shadow-md shadow-blue-500/20'
                : 'bg-slate-800/80 border-slate-700/80 text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
            title="スクショ履歴サイドバー"
          >
            <ImageIcon className="w-4 h-4" />
            {screenshots.length > 0 && !isSidebarOpen && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-600 text-[9px] font-bold text-white flex items-center justify-center">
                {screenshots.length}
              </span>
            )}
          </button>

          {/* Scheduler & Watchdog Modal Button */}
          <button
            onClick={() => setIsSchedulerOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer relative ${
              isSchedulerOpen
                ? 'bg-purple-950/80 border-purple-600 text-purple-300 shadow-md shadow-purple-500/20'
                : activeJobCount > 0
                ? 'bg-slate-800/90 border-purple-500/50 text-purple-300 hover:text-white hover:bg-slate-700'
                : 'bg-slate-800/80 border-slate-700/80 text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
            title="定期実行・条件監視 (Watchdog) の設定・管理"
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">スケジュール・監視</span>
            {activeJobCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-purple-600 text-[9px] font-bold text-white flex items-center justify-center">
                {activeJobCount}
              </span>
            )}
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
            title="設定"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace Body: ChatView + LiveViewPanel + ScreenshotSidebar */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        {/* Main chat view */}
        <ChatView
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={handleSendMessage}
          mcpConnected={status.mcp.connected}
          mcpTools={mcpTools}
          onAddMessage={handleAddDirectMessage}
          insertPrompt={insertPrompt}
          onClearInsertPrompt={() => setInsertPrompt('')}
        />

        {/* Live WebKVM Embed Panel (Toggleable) */}
        <LiveViewPanel
          isOpen={isLiveViewOpen}
          onClose={() => setIsLiveViewOpen(false)}
          endpoint={config?.nanokvm.endpoint || ''}
        />

        {/* Screenshot Gallery & Timeline Sidebar */}
        <ScreenshotSidebar
          screenshots={screenshots}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          onSelectMessage={handleSelectMessage}
          onOpenDiff={(before, after) =>
            setDiffModal({ isOpen: true, before, after })
          }
          onPreviewImage={(url) => setPreviewImage(url)}
          onDeleteScreenshot={handleDeleteScreenshot}
          onDeleteScreenshots={handleDeleteScreenshots}
          onPruneScreenshots={handlePruneScreenshots}
          onClearAllScreenshots={handleClearAllScreenshots}
        />
      </div>

      {/* Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveConfig}
        onClearHistory={messages.length > 0 ? handleClearHistory : undefined}
      />

      <ToolListModal
        isOpen={isToolsOpen}
        tools={mcpTools}
        onClose={() => setIsToolsOpen(false)}
      />

      <DiffModal
        isOpen={diffModal.isOpen}
        beforeItem={diffModal.before}
        afterItem={diffModal.after}
        onClose={() => setDiffModal({ isOpen: false, before: null, after: null })}
      />

      <SchedulerModal
        isOpen={isSchedulerOpen}
        onClose={() => setIsSchedulerOpen(false)}
        mcpTools={mcpTools}
      />

      {/* Single Image Zoom Modal (Expanded to window size) */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-2 md:p-3 select-none"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative w-[98vw] h-[96vh] max-w-[1920px] bg-slate-900 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-11 px-4 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  画面プレビュー
                </span>
                <span className="text-[10px] text-slate-400 bg-slate-800/80 border border-slate-700 px-2 py-0.5 rounded-full font-mono">
                  Esc で閉じる
                </span>
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition cursor-pointer"
                title="閉じる (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 p-2 md:p-4 bg-slate-950 flex items-center justify-center overflow-hidden min-h-0 relative">
              <VisualOverlayImage
                src={previewImage}
                className="max-h-full max-w-full border-none shadow-none flex items-center justify-center bg-transparent"
                imageClassName="max-h-[calc(96vh-4rem)] max-w-[calc(98vw-2rem)] w-auto h-auto object-contain rounded-lg shadow-xl"
                showOverlayToggle={false}
                onPickCoordinates={handlePickCoordinates}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
