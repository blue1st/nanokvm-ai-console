import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Cpu,
  ShieldAlert,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Copy,
  Terminal,
  ShieldCheck,
  Check,
  Images,
  Trash2,
} from 'lucide-react';
import type { AppConfig } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: AppConfig) => Promise<void>;
  onClearHistory?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onClearHistory,
}) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isTestingLlama, setIsTestingLlama] = useState(false);
  const [llamaTestResult, setLlamaTestResult] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  const [isTestingMcp, setIsTestingMcp] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopySnippet = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  useEffect(() => {
    if (isOpen) {
      setLlamaTestResult(null);
      setMcpTestResult(null);

      if (window.api) {
        window.api.getConfig().then((cfg: AppConfig) => {
          setConfig(cfg);
          window.api.getLlamaModels(cfg.llama.baseUrl, cfg.llama.apiKey).then((models: string[]) => {
            setAvailableModels(models);
          }).catch(() => {});
        }).catch((err: unknown) => {
          console.error('Failed to load config:', err);
        });
      } else {
        console.warn('window.api is not defined yet');
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  if (!config) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-300 flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
          <p className="text-sm">設定を読み込み中...</p>
        </div>
      </div>
    );
  }

  const handleTestLlama = async () => {
    setIsTestingLlama(true);
    setLlamaTestResult(null);
    try {
      const res = await window.api.testLlamaConnection(
        config.llama.baseUrl,
        config.llama.apiKey
      );
      if (res.success && res.models.length > 0) {
        setAvailableModels(res.models);
        setConfig((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            llama: {
              ...prev.llama,
              model: prev.llama.model || res.models[0],
            },
          };
        });
        setLlamaTestResult({
          success: true,
          message: `接続成功 (${res.models.length} 個のモデルを検出: ${res.models.join(', ')})`,
        });
      } else {
        setLlamaTestResult({
          success: false,
          message: res.error || 'モデルが検出されませんでした',
        });
      }
    } catch (e: unknown) {
      setLlamaTestResult({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsTestingLlama(false);
    }
  };

  const handleTestMcp = async () => {
    setIsTestingMcp(true);
    setMcpTestResult(null);
    try {
      const res = await window.api.connectMCP(
        config.nanokvm.endpoint,
        config.nanokvm.apiKey,
        config.nanokvm.insecureSkipVerify
      );
      if (res.success) {
        setMcpTestResult({
          success: true,
          message: `接続成功 (${res.toolCount} 個のMCPツールを検出)`,
        });
      } else {
        setMcpTestResult({
          success: false,
          message: res.error || '接続に失敗しました',
        });
      }
    } catch (e: unknown) {
      setMcpTestResult({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsTestingMcp(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(config);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <span>接続・動作設定</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section: llama.cpp server */}
          <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-700/60 pb-2">
              <Cpu className="w-5 h-5 text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                1. llama.cpp Server 設定 (LLM)
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">サーバーエンドポイント URL</label>
                <input
                  type="text"
                  value={config.llama.baseUrl}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      llama: { ...config.llama, baseUrl: e.target.value },
                    })
                  }
                  placeholder="http://192.168.1.100:8080"
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">API Key (任意)</label>
                <input
                  type="password"
                  value={config.llama.apiKey}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      llama: { ...config.llama, apiKey: e.target.value },
                    })
                  }
                  placeholder="空欄可"
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400">Model 名</label>
                  <button
                    type="button"
                    onClick={handleTestLlama}
                    disabled={isTestingLlama}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isTestingLlama ? 'animate-spin' : ''}`}
                    />
                    <span>接続テスト / モデル一覧更新</span>
                  </button>
                </div>
                {availableModels.length > 0 ? (
                  <select
                    value={config.llama.model}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        llama: { ...config.llama, model: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">モデルを選択 (未選択時はデフォルト)</option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.llama.model}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        llama: { ...config.llama, model: e.target.value },
                      })
                    }
                    placeholder="例: default, qwen2.5-coder-7b-instruct など"
                    className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                )}
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs text-slate-400">
                  LLM 応答タイムアウト時間 (ローカルLLM / 画像認識向け)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={30}
                    max={1200}
                    step={30}
                    value={config.llama.timeoutSeconds ?? 180}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        llama: {
                          ...config.llama,
                          timeoutSeconds: parseInt(e.target.value, 10) || 180,
                        },
                      })
                    }
                    className="w-28 px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-xs text-slate-400">
                    秒 (デフォルト: 180秒。ローカルLLMの画像処理やPrefillに時間がかかる場合は300秒などに延長可能)
                  </span>
                </div>
              </div>
            </div>

            {llamaTestResult && (
              <div
                className={`text-xs p-2.5 rounded-md flex items-center gap-2 ${
                  llamaTestResult.success
                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                    : 'bg-rose-950/60 text-rose-400 border border-rose-800'
                }`}
              >
                {llamaTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{llamaTestResult.message}</span>
              </div>
            )}
          </div>

          {/* Section: NanoKVM Go MCP */}
          <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-700/60 pb-2">
              <Server className="w-5 h-5 text-purple-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                2. NanoKVM Go Remote MCP 設定
              </h3>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">
                  MCP エンドポイント URL (HTTPS)
                </label>
                <input
                  type="text"
                  value={config.nanokvm.endpoint}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      nanokvm: { ...config.nanokvm, endpoint: e.target.value },
                    })
                  }
                  placeholder="https://192.168.1.45/api/mcp"
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-purple-500"
                  required
                />
                <p className="text-[11px] text-slate-400">
                  NanoKVM Web画面の Settings &gt; MCP で表示される Endpoint を入力してください。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">
                  API Key (Authorization ヘッダー)
                </label>
                <input
                  type="password"
                  value={config.nanokvm.apiKey}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      nanokvm: { ...config.nanokvm, apiKey: e.target.value },
                    })
                  }
                  placeholder="NanoKVM の MCP API Key"
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-purple-500"
                />
                <p className="text-[11px] text-slate-400">
                  NanoKVM Web画面で生成された API Key。接続時に Bearer ヘッダーとして自動付与されます。
                </p>
              </div>

              {/* Insecure skip verify checkbox */}
              <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-lg flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.nanokvm.insecureSkipVerify}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          nanokvm: {
                            ...config.nanokvm,
                            insecureSkipVerify: e.target.checked,
                          },
                        })
                      }
                      className="rounded border-slate-700 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-xs font-medium text-amber-200">
                      自己署名証明書 / 証明書検証エラーを無視する (推奨: 有効)
                    </span>
                  </label>
                  <p className="text-[11px] text-amber-300/80">
                    NanoKVM Go はHTTPS通信を行いますが、ローカルIPアドレスのためSSL証明書が未発行です。チェックを入れることでTLS証明書エラーを無視して安全にローカル接続します。
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleTestMcp}
                  disabled={isTestingMcp}
                  className="px-3 py-1.5 text-xs rounded-md bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center gap-1.5 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingMcp ? 'animate-spin' : ''}`} />
                  <span>NanoKVM MCP 接続テスト</span>
                </button>
              </div>

              {mcpTestResult && (
                <div
                  className={`text-xs p-2.5 rounded-md flex items-center gap-2 ${
                    mcpTestResult.success
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                      : 'bg-rose-950/60 text-rose-400 border border-rose-800'
                  }`}
                >
                  {mcpTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{mcpTestResult.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section: System Prompt & Tuning */}
          <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">3. システムプロンプト</h3>
            <div className="space-y-1.5">
              <textarea
                value={config.llama.systemPrompt}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    llama: { ...config.llama, systemPrompt: e.target.value },
                  })
                }
                rows={4}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Section 4: Safety & Step Execution */}
          <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200">4. 安全性・自律操作ガード</h3>
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!!config.stepExecutionMode}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    stepExecutionMode: e.target.checked,
                  })
                }
                className="mt-0.5 rounded border-slate-700 text-amber-600 focus:ring-amber-500"
              />
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-200">
                  ステップ承認モード（Human-in-the-Loop）を有効にする
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  AIが画面操作（マウスクリック、キーボード入力、電源操作等）のMCPツールを実行する直前に一時停止し、人間の承認・スキップ・中断の判断を待つ安全ガードです。
                </p>
              </div>
            </label>
          </div>

          {/* Section 5: Screenshot Memory Management */}
          <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <Images className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-200">5. スクリーンショット・メモリ管理</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-300 font-medium">
                  スクショ画像データの保持上限
                </label>
                <select
                  value={config.maxScreenshots ?? 30}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      maxScreenshots: Number(e.target.value),
                    })
                  }
                  className="px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500 font-mono cursor-pointer"
                >
                  <option value={10}>最新 10 枚 (省メモリ優先)</option>
                  <option value={20}>最新 20 枚</option>
                  <option value={30}>最新 30 枚 (推奨)</option>
                  <option value={50}>最新 50 枚</option>
                  <option value={0}>無制限 (自動破棄なし)</option>
                </select>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                NanoKVMの画面キャプチャはBase64形式の画像データとしてメモリ上に蓄積されます。保持上限を超えた古いキャプチャの画像データのみを自動破棄することで、長時間の遠隔操作でもメモリ肥大化を防ぎます（※チャット履歴のテキストやツール実行結果はそのまま保持されます）。サイドバー上部のゴミ箱メニューからもいつでも手動削除・整理が可能です。
              </p>
            </div>
          </div>

          {/* Section 6: External Agent MCP Proxy (Claude Desktop, Cursor, Antigravity) */}
          <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  6. 外部LLM連携 MCP Proxy (Claude / Cursor / Antigravity)
                </h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-800/70 text-cyan-300">
                stdio proxy
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              本アプリ付属の Stdio MCP Proxy を利用すると、Claude Desktop や Cursor、Antigravity からでも NanoKVM の自己署名証明書やAPI認証を自動処理し、遠隔操作ツールをそのまま呼び出せます。
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">
                  Claude Desktop 設定 (<code className="text-cyan-300 font-mono text-[11px]">claude_desktop_config.json</code>)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleCopySnippet(
                      'claude',
                      JSON.stringify(
                        {
                          mcpServers: {
                            nanokvm: {
                              command: 'node',
                              args: [
                                '<path-to-nanokvm-go-client>/bin/nanokvm-mcp-proxy.js',
                              ],
                              env: {
                                NANOKVM_ENDPOINT: config.nanokvm.endpoint,
                                NANOKVM_API_KEY: config.nanokvm.apiKey,
                              },
                            },
                          },
                        },
                        null,
                        2
                      )
                    )
                  }
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition border border-slate-700 cursor-pointer"
                >
                  {copiedKey === 'claude' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300">コピー完了!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>設定JSONをコピー</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed select-all">
{JSON.stringify(
  {
    mcpServers: {
      nanokvm: {
        command: "node",
        args: [
          "<path-to-nanokvm-go-client>/bin/nanokvm-mcp-proxy.js"
        ],
        env: {
          NANOKVM_ENDPOINT: config.nanokvm.endpoint,
          NANOKVM_API_KEY: config.nanokvm.apiKey ? "******" : ""
        }
      }
    }
  },
  null,
  2
)}
              </pre>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-mono">v1.0.0</span>
              {onClearHistory && (
                <button
                  type="button"
                  onClick={() => {
                    onClearHistory();
                    onClose();
                  }}
                  className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 hover:underline px-2 py-1 rounded transition"
                  title="現在のチャット会話履歴を全消去します"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>チャット履歴を消去</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-1.5 shadow-lg shadow-blue-500/20 transition cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? '保存中...' : '設定を保存'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
