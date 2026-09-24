import React, { useState, useEffect } from 'react';
import {
  Clock,
  Play,
  Plus,
  Trash2,
  Edit3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  FileText,
  Sparkles,
  Bell,
  Zap,
  X,
  History,
  ShieldAlert,
} from 'lucide-react';
import type { ScheduledJob, JobExecutionLog, MCPTool } from '../types';

interface SchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mcpTools: MCPTool[];
}

type TabType = 'list' | 'create' | 'logs';

export const SchedulerModal: React.FC<SchedulerModalProps> = ({
  isOpen,
  onClose,
  mcpTools,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('list');
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [logs, setLogs] = useState<JobExecutionLog[]>([]);
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [previewLogImage, setPreviewLogImage] = useState<string | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formMode, setFormMode] = useState<'watchdog' | 'prompt'>('watchdog');
  const [formTriggerType, setFormTriggerType] = useState<'interval' | 'once'>('interval');
  const [formIntervalMinutes, setFormIntervalMinutes] = useState(5);
  const [formRunAt, setFormRunAt] = useState('');
  
  // Watchdog specific
  const [formCondition, setFormCondition] = useState('');
  const [formNotify, setFormNotify] = useState(true);
  const [formActionType, setFormActionType] = useState<'none' | 'mcp_tool' | 'prompt'>('none');
  const [formToolName, setFormToolName] = useState('');
  const [formFollowUpPrompt, setFormFollowUpPrompt] = useState('');
  const [formAutoDisable, setFormAutoDisable] = useState(false);

  // Prompt specific
  const [formPrompt, setFormPrompt] = useState('');

  // Fetch initial data
  const loadData = async () => {
    if (!window.api) return;
    try {
      const loadedJobs = await window.api.getJobs();
      setJobs(loadedJobs);
      const loadedLogs = await window.api.getJobLogs();
      setLogs(loadedLogs);
    } catch (e) {
      console.error('Failed to load scheduler data:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  // Listen for live updates
  useEffect(() => {
    if (!window.api) return;
    const unsubJobs = window.api.onJobsUpdated((updatedJobs: ScheduledJob[]) => {
      setJobs(updatedJobs);
    });
    const unsubLogs = window.api.onJobLogsUpdated((updatedLogs: JobExecutionLog[]) => {
      setLogs(updatedLogs);
    });
    return () => {
      unsubJobs();
      unsubLogs();
    };
  }, []);

  // Presets definition
  const applyPreset = (presetKey: string) => {
    if (presetKey === 'bsod') {
      setFormName('ブルースクリーン・クラッシュ自動監視');
      setFormMode('watchdog');
      setFormTriggerType('interval');
      setFormIntervalMinutes(2);
      setFormCondition('画面がブルースクリーン(BSOD)または深刻なシステムクラッシュ、カーネルパニック画面になっている');
      setFormNotify(true);
      setFormActionType('mcp_tool');
      // Look for power_reset or hardware_reset or reset
      const resetTool = mcpTools.find((t) => t.name.toLowerCase().includes('reset'))?.name || 'power_reset';
      setFormToolName(resetTool);
      setFormAutoDisable(false);
    } else if (presetKey === 'login') {
      setFormName('ログイン画面到達の検知');
      setFormMode('watchdog');
      setFormTriggerType('interval');
      setFormIntervalMinutes(1);
      setFormCondition('WindowsやLinuxのOSログイン画面（パスワード入力画面やようこそ画面）が表示されている');
      setFormNotify(true);
      setFormActionType('none');
      setFormAutoDisable(true); // Disable once matched
    } else if (presetKey === 'install_complete') {
      setFormName('インストール・アップデート完了の検知');
      setFormMode('watchdog');
      setFormTriggerType('interval');
      setFormIntervalMinutes(3);
      setFormCondition('インストーラーまたはアップデータの処理が100%になるか、「完了」「Finish」「Close」ボタンが表示されている');
      setFormNotify(true);
      setFormActionType('none');
      setFormAutoDisable(true);
    } else if (presetKey === 'hourly_health') {
      setFormName('画面健全性・エラーダイアログの定期巡回');
      setFormMode('watchdog');
      setFormTriggerType('interval');
      setFormIntervalMinutes(15);
      setFormCondition('画面上にエラーダイアログ、警告ポップアップ、または応答停止メッセージが表示されている');
      setFormNotify(true);
      setFormActionType('none');
      setFormAutoDisable(false);
    }
  };

  const resetForm = () => {
    setEditingJob(null);
    setFormName('');
    setFormMode('watchdog');
    setFormTriggerType('interval');
    setFormIntervalMinutes(5);
    setFormRunAt('');
    setFormCondition('');
    setFormNotify(true);
    setFormActionType('none');
    setFormToolName(mcpTools[0]?.name || '');
    setFormFollowUpPrompt('');
    setFormAutoDisable(false);
    setFormPrompt('');
  };

  const handleEditJob = (job: ScheduledJob) => {
    setEditingJob(job);
    setFormName(job.name);
    setFormMode(job.mode);
    setFormTriggerType(job.trigger.type === 'once' ? 'once' : 'interval');
    setFormIntervalMinutes(job.trigger.intervalMinutes || 5);
    setFormRunAt(job.trigger.runAt || '');

    if (job.mode === 'watchdog' && job.watchdogConfig) {
      setFormCondition(job.watchdogConfig.condition);
      setFormNotify(job.watchdogConfig.onMatched.notify !== false);
      setFormActionType(job.watchdogConfig.onMatched.actionType);
      setFormToolName(job.watchdogConfig.onMatched.toolName || mcpTools[0]?.name || '');
      setFormFollowUpPrompt(job.watchdogConfig.onMatched.followUpPrompt || '');
      setFormAutoDisable(!!job.watchdogConfig.onMatched.autoDisableAfterMatch);
    } else if (job.mode === 'prompt' && job.promptConfig) {
      setFormPrompt(job.promptConfig.prompt);
    }

    setActiveTab('create');
  };

  const handleSaveJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const newJob: ScheduledJob = {
      id: editingJob ? editingJob.id : `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: formName.trim(),
      enabled: editingJob ? editingJob.enabled : true,
      createdAt: editingJob ? editingJob.createdAt : Date.now(),
      trigger: {
        type: formTriggerType,
        intervalMinutes: formTriggerType === 'interval' ? Number(formIntervalMinutes) : undefined,
        runAt: formTriggerType === 'once' ? formRunAt : undefined,
      },
      mode: formMode,
      watchdogConfig:
        formMode === 'watchdog'
          ? {
              condition: formCondition.trim(),
              onMatched: {
                notify: formNotify,
                actionType: formActionType,
                toolName: formActionType === 'mcp_tool' ? formToolName : undefined,
                followUpPrompt: formActionType === 'prompt' ? formFollowUpPrompt : undefined,
                autoDisableAfterMatch: formAutoDisable,
              },
            }
          : undefined,
      promptConfig:
        formMode === 'prompt'
          ? {
              prompt: formPrompt.trim(),
            }
          : undefined,
    };

    if (newJob.enabled && newJob.trigger.type === 'interval' && newJob.trigger.intervalMinutes) {
      newJob.nextRunAt = Date.now() + newJob.trigger.intervalMinutes * 60 * 1000;
    }

    try {
      const updated = await window.api.saveJob(newJob);
      setJobs(updated);
      resetForm();
      setActiveTab('list');
    } catch (err) {
      console.error('Failed to save job:', err);
    }
  };

  const handleToggleJob = async (id: string, currentEnabled: boolean) => {
    try {
      const updatedJob = await window.api.toggleJob(id, !currentEnabled);
      if (updatedJob) {
        setJobs((prev) => prev.map((j) => (j.id === id ? updatedJob : j)));
      }
    } catch (err) {
      console.error('Failed to toggle job:', err);
    }
  };

  const handleDeleteJob = async (id: string) => {
    if (!window.confirm('このタスクを削除してもよろしいですか？')) return;
    try {
      const updated = await window.api.deleteJob(id);
      setJobs(updated);
    } catch (err) {
      console.error('Failed to delete job:', err);
    }
  };

  const handleTriggerNow = async (id: string) => {
    setRunningJobId(id);
    try {
      const log = await window.api.triggerJobNow(id);
      if (log) {
        setLogs((prev) => [log, ...prev]);
        const updatedJobs = await window.api.getJobs();
        setJobs(updatedJobs);
      }
    } catch (err) {
      console.error('Manual trigger failed:', err);
    } finally {
      setRunningJobId(null);
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm('実行ログをすべてクリアしますか？')) return;
    try {
      await window.api.clearJobLogs();
      setLogs([]);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                定期実行・条件監視 (Watchdog)
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium border border-blue-500/30">
                  {jobs.filter((j) => j.enabled).length}件 稼働中
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                あらかじめ設定した条件やプロンプトをバックグラウンドで自動監視・実行
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Tabs */}
            <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700/60 text-xs">
              <button
                type="button"
                onClick={() => { setActiveTab('list'); resetForm(); }}
                className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                  activeTab === 'list'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                タスク一覧 ({jobs.length})
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('create'); if (!editingJob) resetForm(); }}
                className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer flex items-center gap-1 ${
                  activeTab === 'create'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                {editingJob ? 'タスク編集' : '新規作成'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer flex items-center gap-1 ${
                  activeTab === 'logs'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                実行履歴 ({logs.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          
          {/* TAB 1: LIST */}
          {activeTab === 'list' && (
            <div className="space-y-4">
              {jobs.length === 0 ? (
                <div className="text-center py-16 px-4 border border-dashed border-slate-800 rounded-xl">
                  <Eye className="w-12 h-12 text-slate-600 mx-auto mb-3 opacity-60" />
                  <h3 className="text-sm font-medium text-slate-300 mb-1">
                    登録されているタスクがありません
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mb-5">
                    「〜の状態になったら通知する」監視タスクや、定期実行プロンプトを作成できます。
                  </p>
                  <button
                    onClick={() => { setActiveTab('create'); resetForm(); }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition shadow-lg shadow-blue-500/20 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    最初のタスクを作成する
                  </button>
                </div>
              ) : (
                <div className="grid gap-3">
                  {jobs.map((job) => {
                    const isRunning = runningJobId === job.id;
                    return (
                      <div
                        key={job.id}
                        className={`p-4 rounded-xl border transition flex flex-col gap-3 ${
                          job.enabled
                            ? 'bg-slate-850/80 border-slate-700/80'
                            : 'bg-slate-900/40 border-slate-800 opacity-70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            {/* Toggle switch */}
                            <button
                              type="button"
                              onClick={() => handleToggleJob(job.id, job.enabled)}
                              className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                job.enabled ? 'bg-blue-600' : 'bg-slate-700'
                              }`}
                              title={job.enabled ? 'クリックして無効化' : 'クリックして有効化'}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  job.enabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-white">
                                  {job.name}
                                </span>
                                {job.mode === 'watchdog' ? (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-medium border border-purple-500/30 flex items-center gap-1">
                                    <Eye className="w-2.5 h-2.5" />
                                    条件監視 (Watchdog)
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30 flex items-center gap-1">
                                    <FileText className="w-2.5 h-2.5" />
                                    定期プロンプト
                                  </span>
                                )}
                              </div>

                              {/* Details */}
                              <div className="mt-1 text-xs text-slate-400 space-y-0.5">
                                {job.mode === 'watchdog' && job.watchdogConfig && (
                                  <div className="flex items-center gap-1 text-slate-300">
                                    <span className="text-slate-500">条件:</span>
                                    <span className="font-mono bg-slate-800/80 px-1.5 py-0.5 rounded text-[11px] text-amber-300 border border-slate-700">
                                      {job.watchdogConfig.condition}
                                    </span>
                                  </div>
                                )}

                                {job.mode === 'prompt' && job.promptConfig && (
                                  <div className="text-slate-300 truncate max-w-xl">
                                    <span className="text-slate-500">指示: </span>
                                    {job.promptConfig.prompt}
                                  </div>
                                )}

                                <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                                  <span>
                                    ⏰ {job.trigger.type === 'interval'
                                      ? `${job.trigger.intervalMinutes}分 おき`
                                      : `予約: ${job.trigger.runAt}`}
                                  </span>

                                  {job.enabled && job.nextRunAt && (
                                    <span>
                                      次回: {new Date(job.nextRunAt).toLocaleTimeString()}
                                    </span>
                                  )}

                                  {job.lastRunAt && (
                                    <span>
                                      前回実行: {new Date(job.lastRunAt).toLocaleTimeString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleTriggerNow(job.id)}
                              disabled={isRunning}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                              title="今すぐ手動でテスト実行"
                            >
                              <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin text-blue-400' : ''}`} />
                              {isRunning ? '実行中...' : '今すぐ実行'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleEditJob(job)}
                              className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition cursor-pointer"
                              title="編集"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteJob(job.id)}
                              className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 border border-slate-700/60 transition cursor-pointer"
                              title="削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Last Result Banner */}
                        {job.lastResult && (
                          <div
                            className={`px-3 py-2 rounded-lg text-xs flex items-center justify-between border ${
                              job.lastResult.success
                                ? job.lastResult.matched
                                  ? 'bg-purple-950/40 border-purple-800 text-purple-300'
                                  : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
                                : 'bg-rose-950/40 border-rose-800 text-rose-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              {job.lastResult.success ? (
                                job.lastResult.matched ? (
                                  <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                )
                              ) : (
                                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                              )}
                              <span className="truncate">{job.lastResult.summary}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                              {new Date(job.lastResult.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CREATE / EDIT */}
          {activeTab === 'create' && (
            <form onSubmit={handleSaveJob} className="space-y-6 max-w-2xl mx-auto">
              
              {/* Presets Header */}
              {!editingJob && (
                <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-xl space-y-2.5">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    プリセットから素早く作成
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => applyPreset('bsod')}
                      className="text-left p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 border border-slate-700 text-xs transition cursor-pointer"
                    >
                      <div className="font-semibold text-rose-300 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        クラッシュ / BSOD検知 & 再起動
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        ブルースクリーン時に通知し電源リセット
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyPreset('login')}
                      className="text-left p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 border border-slate-700 text-xs transition cursor-pointer"
                    >
                      <div className="font-semibold text-blue-300 flex items-center gap-1">
                        <Bell className="w-3.5 h-3.5" />
                        ログイン画面到達で通知
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        起動完了してログイン画面になったら教えてくれる
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyPreset('install_complete')}
                      className="text-left p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 border border-slate-700 text-xs transition cursor-pointer"
                    >
                      <div className="font-semibold text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        インストーラー完了検知
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        長時間の更新やインストール完了を検知
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyPreset('hourly_health')}
                      className="text-left p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-700/60 border border-slate-700 text-xs transition cursor-pointer"
                    >
                      <div className="font-semibold text-purple-300 flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        定期エラー・警告ダイアログ巡回
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        15分おきに画面のエラーポップアップを監視
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Task Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  タスク名 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例: 深夜のクラッシュ監視、ログイン検知など"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Mode Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  実行モード
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormMode('watchdog')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      formMode === 'watchdog'
                        ? 'bg-purple-950/40 border-purple-500 text-white shadow-md shadow-purple-500/10'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-purple-300 mb-1">
                      <Eye className="w-4 h-4" />
                      条件監視 (Watchdog)
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      画面キャプチャを定期確認し、「〜の状態になったら」通知や操作を発火します。
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormMode('prompt')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      formMode === 'prompt'
                        ? 'bg-blue-950/40 border-blue-500 text-white shadow-md shadow-blue-500/10'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-blue-300 mb-1">
                      <FileText className="w-4 h-4" />
                      定期・予約プロンプト
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      指定したプロンプトをAIに定期送信し、自律操作・対話を実行します。
                    </p>
                  </button>
                </div>
              </div>

              {/* Schedule / Trigger */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    トリガー種別
                  </label>
                  <select
                    value={formTriggerType}
                    onChange={(e) => setFormTriggerType(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="interval">定期インターバル (N分おき)</option>
                    <option value="once">指定日時に1回実行 (予約)</option>
                  </select>
                </div>

                {formTriggerType === 'interval' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      実行間隔 (分)
                    </label>
                    <select
                      value={formIntervalMinutes}
                      onChange={(e) => setFormIntervalMinutes(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value={1}>1分おき (高頻度監視)</option>
                      <option value={2}>2分おき</option>
                      <option value={5}>5分おき (標準)</option>
                      <option value={10}>10分おき</option>
                      <option value={15}>15分おき</option>
                      <option value={30}>30分おき</option>
                      <option value={60}>1時間おき</option>
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      実行予定日時
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={formRunAt}
                      onChange={(e) => setFormRunAt(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </div>

              {/* WATCHDOG SETTINGS */}
              {formMode === 'watchdog' && (
                <div className="space-y-4 p-4 rounded-xl bg-purple-950/20 border border-purple-900/40">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-purple-200 flex items-center justify-between">
                      <span>監視条件（どのような状態になったら検知するか）</span>
                      <span className="text-[10px] text-purple-400">自然言語で自由に入力可能</span>
                    </label>
                    <textarea
                      required
                      rows={2}
                      value={formCondition}
                      onChange={(e) => setFormCondition(e.target.value)}
                      placeholder="例: Windowsのブルースクリーンまたはクラッシュ画面が表示されている、または「問題が発生したため、PCを再起動する必要があります」という文字がある"
                      className="w-full bg-slate-950 border border-purple-900/80 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 leading-relaxed font-sans"
                    />
                  </div>

                  <div className="space-y-3 pt-2 border-t border-purple-900/30">
                    <div className="text-xs font-semibold text-purple-200">
                      条件に合致したときのアクション
                    </div>

                    {/* Notify checkbox */}
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={formNotify}
                        onChange={(e) => setFormNotify(e.target.checked)}
                        className="rounded border-slate-700 text-purple-600 focus:ring-purple-500 bg-slate-950"
                      />
                      <span>デスクトップOS通知を表示する（AIの診断理由付き）</span>
                    </label>

                    {/* Action type */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300">
                        自動実行アクション
                      </label>
                      <select
                        value={formActionType}
                        onChange={(e) => setFormActionType(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                      >
                        <option value="none">なし (通知・ログ記録のみ)</option>
                        <option value="mcp_tool">MCPツールを直接実行する (電源リセット、キー入力など)</option>
                        <option value="prompt">AIにフォローアッププロンプトを投げて対処させる</option>
                      </select>
                    </div>

                    {formActionType === 'mcp_tool' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-300">
                          実行するMCPツール
                        </label>
                        <select
                          value={formToolName}
                          onChange={(e) => setFormToolName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono cursor-pointer"
                        >
                          {mcpTools.map((t) => (
                            <option key={t.name} value={t.name}>
                              {t.name} {t.description ? `(${t.description})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {formActionType === 'prompt' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-300">
                          フォローアップ指示
                        </label>
                        <textarea
                          rows={2}
                          value={formFollowUpPrompt}
                          onChange={(e) => setFormFollowUpPrompt(e.target.value)}
                          placeholder="例: パスワードを入力してログインしてください"
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    )}

                    {/* Auto disable */}
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 pt-1">
                      <input
                        type="checkbox"
                        checked={formAutoDisable}
                        onChange={(e) => setFormAutoDisable(e.target.checked)}
                        className="rounded border-slate-700 text-purple-600 focus:ring-purple-500 bg-slate-950"
                      />
                      <span>1度条件に合致したらタスクを自動終了する（1回きりの監視）</span>
                    </label>
                  </div>
                </div>
              )}

              {/* PROMPT SETTINGS */}
              {formMode === 'prompt' && (
                <div className="space-y-1.5 p-4 rounded-xl bg-blue-950/20 border border-blue-900/40">
                  <label className="text-xs font-medium text-blue-200">
                    実行するプロンプト指示 <span className="text-rose-400">*</span>
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={formPrompt}
                    onChange={(e) => setFormPrompt(e.target.value)}
                    placeholder="例: 現在の画面を確認し、作業が正常に進行しているかを診断して要約してください。"
                    className="w-full bg-slate-950 border border-blue-900/80 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 leading-relaxed font-sans"
                  />
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => { setActiveTab('list'); resetForm(); }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition shadow-lg shadow-blue-500/20 cursor-pointer"
                >
                  {editingJob ? 'タスクを更新' : 'タスクを保存して有効化'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  直近のバックグラウンド実行・条件判定履歴 (最大50件)
                </span>
                {logs.length > 0 && (
                  <button
                    onClick={handleClearLogs}
                    className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    履歴を全消去
                  </button>
                )}
              </div>

              {logs.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-xs">
                  まだ実行ログはありません。タスクが実行されるとここに結果が記録されます。
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3.5 rounded-xl bg-slate-850/60 border border-slate-800 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">
                            {log.jobName}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            {log.mode === 'watchdog' ? '条件監視' : '定期プロンプト'}
                          </span>
                          {log.matched !== undefined && (
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                                log.matched
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                              }`}
                            >
                              {log.matched ? '🎯 条件合致' : '条件不一致'}
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-400 flex items-center gap-3">
                          <span>⏱️ {log.durationMs}ms</span>
                          <span>{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Summary / Reason */}
                      <p className="text-slate-300 leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                        {log.reason || log.summary}
                      </p>

                      {/* Action taken */}
                      {log.actionTaken && (
                        <div className="flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-950/20 border border-amber-900/40 px-2 py-1 rounded">
                          <Zap className="w-3 h-3 text-amber-400" />
                          <span>{log.actionTaken}</span>
                        </div>
                      )}

                      {/* Screenshot preview button if available */}
                      {log.screenshotUrl && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setPreviewLogImage(log.screenshotUrl || null)}
                            className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            この判定時のスクリーンショットを見る
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Screenshot Preview Modal */}
      {previewLogImage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewLogImage(null)}
        >
          <div className="relative max-w-4xl max-h-[85vh] flex flex-col items-center">
            <img
              src={previewLogImage}
              alt="Screenshot Preview"
              className="max-w-full max-h-[80vh] object-contain rounded-lg border border-slate-700 shadow-2xl"
            />
            <button
              onClick={() => setPreviewLogImage(null)}
              className="mt-3 px-4 py-1.5 bg-slate-800 text-slate-200 text-xs rounded-lg hover:bg-slate-700 transition cursor-pointer"
            >
              閉じる (ESC)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
