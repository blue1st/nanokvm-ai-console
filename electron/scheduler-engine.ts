import electron from 'electron';
import type { BrowserWindow } from 'electron';
import type { JobStore } from './job-store';
import type { ConfigStore } from './store';
import type { ScheduledJob, JobExecutionLog, MCPTool } from '../src/types';

interface WorkerManagerLike {
  send<T = any>(action: string, payload?: any): Promise<T>;
  stream(action: string, payload: any, onEvent: (event: any) => void): Promise<void>;
}

export class SchedulerEngine {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private getWindow: () => BrowserWindow | null;
  private store: JobStore;
  private configStore: ConfigStore;
  private workerMgr: WorkerManagerLike;

  constructor(options: {
    store: JobStore;
    configStore: ConfigStore;
    workerMgr: WorkerManagerLike;
    getWindow: () => BrowserWindow | null;
  }) {
    this.store = options.store;
    this.configStore = options.configStore;
    this.workerMgr = options.workerMgr;
    this.getWindow = options.getWindow;
  }

  public start(): void {
    if (this.timer) return;
    console.log('[Scheduler] Starting Scheduler Engine loop (5s interval)...');
    this.timer = setInterval(() => this.tick(), 5000);
    // Immediate check on start
    setTimeout(() => this.tick(), 1500);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Scheduler] Scheduler Engine stopped.');
    }
  }

  /**
   * Main scheduler tick checking for due jobs
   */
  private async tick(): Promise<void> {
    if (this.isProcessing) return;

    const now = Date.now();
    const jobs = this.store.getJobs();
    const dueJobs = jobs.filter((job) => {
      if (!job.enabled) return false;
      if (!job.nextRunAt) {
        // If enabled but no nextRunAt, calculate one
        this.recalculateNextRun(job);
        return false;
      }
      return job.nextRunAt <= now;
    });

    if (dueJobs.length === 0) return;

    this.isProcessing = true;
    try {
      for (const job of dueJobs) {
        await this.executeJob(job);
      }
    } catch (err) {
      console.error('[Scheduler] Error executing scheduled jobs:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Manually trigger a job immediately
   */
  public async runJobNow(jobId: string): Promise<JobExecutionLog | null> {
    const job = this.store.getJob(jobId);
    if (!job) return null;
    return this.executeJob(job, true);
  }

  /**
   * Recalculate next run time for a job
   */
  private recalculateNextRun(job: ScheduledJob): number | undefined {
    const now = Date.now();
    let nextRun: number | undefined;

    if (job.trigger.type === 'interval' && job.trigger.intervalMinutes) {
      nextRun = now + job.trigger.intervalMinutes * 60 * 1000;
    } else if (job.trigger.type === 'once' && job.trigger.runAt) {
      const scheduledTime = new Date(job.trigger.runAt).getTime();
      if (scheduledTime > now) {
        nextRun = scheduledTime;
      }
    }

    if (nextRun) {
      job.nextRunAt = nextRun;
      this.store.saveJob(job);
    }
    return nextRun;
  }

  /**
   * Execute a single scheduled or watchdog job
   */
  private async executeJob(job: ScheduledJob, isManual = false): Promise<JobExecutionLog> {
    const startTime = Date.now();
    console.log(`[Scheduler] Executing job: "${job.name}" (mode: ${job.mode}, manual: ${isManual})`);

    const log: JobExecutionLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      jobId: job.id,
      jobName: job.name,
      mode: job.mode,
      timestamp: startTime,
      durationMs: 0,
      success: false,
      summary: '',
    };

    try {
      if (job.mode === 'watchdog') {
        await this.executeWatchdogJob(job, log);
      } else {
        await this.executePromptJob(job, log);
      }
      log.success = true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Job "${job.name}" failed:`, err);
      log.success = false;
      log.error = errMsg;
      log.summary = `実行エラー: ${errMsg}`;
    } finally {
      log.durationMs = Date.now() - startTime;
      this.store.addLog(log);

      // Schedule next run
      let nextRun: number | undefined;
      if (job.trigger.type === 'interval' && job.trigger.intervalMinutes && job.enabled) {
        nextRun = Date.now() + job.trigger.intervalMinutes * 60 * 1000;
      } else if (job.trigger.type === 'once') {
        job.enabled = false; // Disable once completed
      }

      this.store.updateJobResult(
        job.id,
        {
          success: log.success,
          summary: log.summary,
          matched: log.matched,
          error: log.error,
        },
        nextRun
      );

      // Notify renderer
      this.notifyRenderer();
    }

    return log;
  }

  /**
   * Watchdog execution: capture screen -> evaluate condition -> notify/action if matched
   */
  private async executeWatchdogJob(job: ScheduledJob, log: JobExecutionLog): Promise<void> {
    const watchdog = job.watchdogConfig;
    if (!watchdog || !watchdog.condition) {
      throw new Error('Watchdog condition is not configured');
    }

    const config = this.configStore.getConfig();

    // 1. Capture screen using MCP tool
    console.log(`[Scheduler:Watchdog] Capturing screen for condition: "${watchdog.condition}"...`);
    const screenRes = await this.captureScreen();
    log.screenshotUrl = screenRes.imageUrl;

    // 2. Evaluate condition via LLM in network worker
    console.log(`[Scheduler:Watchdog] Evaluating visual condition via LLM...`);
    const evalResult = await this.workerMgr.send<{
      matched: boolean;
      confidence: number;
      reason: string;
    }>('watchdog:evaluate', {
      imageUrl: screenRes.imageUrl,
      condition: watchdog.condition,
      config,
    });

    log.matched = evalResult.matched;
    log.confidence = evalResult.confidence;
    log.reason = evalResult.reason;

    if (evalResult.matched) {
      log.summary = `🎯 条件検知 (${Math.round((evalResult.confidence || 0) * 100)}%): ${evalResult.reason}`;
      console.log(`[Scheduler:Watchdog] Condition MATCHED for "${job.name}"! Reason: ${evalResult.reason}`);

      // Handle onMatched:
      const onMatched = watchdog.onMatched;

      // A. Desktop Notification
      if (onMatched.notify !== false) {
        this.sendDesktopNotification(
          onMatched.notificationTitle || `🚨 条件検知: ${job.name}`,
          onMatched.notificationBody || evalResult.reason
        );
      }

      // B. Trigger follow-up action
      if (onMatched.actionType === 'mcp_tool' && onMatched.toolName) {
        console.log(`[Scheduler:Watchdog] Triggering follow-up tool: ${onMatched.toolName}`);
        try {
          const toolRes = await this.workerMgr.send('mcp:callTool', {
            name: onMatched.toolName,
            args: onMatched.toolArgs || {},
          });
          log.actionTaken = `MCPツール [${onMatched.toolName}] を自動実行しました: ${toolRes?.text || '完了'}`;
        } catch (actionErr) {
          log.actionTaken = `MCPツール [${onMatched.toolName}] 実行失敗: ${actionErr}`;
        }
      } else if (onMatched.actionType === 'prompt' && onMatched.followUpPrompt) {
        log.actionTaken = `フォローアッププロンプト送信: "${onMatched.followUpPrompt.slice(0, 50)}..."`;
        // Execute background follow-up prompt
        try {
          await this.executePromptJob(
            {
              ...job,
              promptConfig: { prompt: onMatched.followUpPrompt },
            },
            log
          );
        } catch (promptErr) {
          log.actionTaken += ` (エラー: ${promptErr})`;
        }
      }

      // C. Auto disable if configured
      if (onMatched.autoDisableAfterMatch) {
        job.enabled = false;
        this.store.saveJob(job);
        console.log(`[Scheduler:Watchdog] Job "${job.name}" automatically disabled after match.`);
      }
    } else {
      log.summary = `条件不一致 (${Math.round((evalResult.confidence || 0) * 100)}%): ${evalResult.reason}`;
      console.log(`[Scheduler:Watchdog] Condition not matched for "${job.name}". ${evalResult.reason}`);
    }
  }

  /**
   * Prompt execution: send prompt to LLM and let it autonomously handle
   */
  private async executePromptJob(job: ScheduledJob, log: JobExecutionLog): Promise<void> {
    const prompt = job.promptConfig?.prompt;
    if (!prompt) {
      throw new Error('Prompt is not configured');
    }

    const config = this.configStore.getConfig();
    let accumulatedContent = '';

    await this.workerMgr.stream(
      'chat:send',
      {
        history: [],
        content: prompt,
        config: {
          ...config,
          llama: {
            ...config.llama,
            systemPrompt: job.promptConfig?.systemPromptOverride || config.llama.systemPrompt,
          },
        },
      },
      (event) => {
        if (event.type === 'token' && event.token) {
          accumulatedContent += event.token;
        } else if (event.type === 'tool_call_complete' && event.toolCall?.result?.image) {
          log.screenshotUrl = event.toolCall.result.image;
        }
      }
    );

    log.summary = accumulatedContent.slice(0, 200).trim() || 'プロンプト実行完了';

    // Desktop notification on completion if requested
    this.sendDesktopNotification(`✅ 定期タスク完了: ${job.name}`, log.summary);
  }

  /**
   * Helper to capture screen via MCP
   */
  private async captureScreen(): Promise<{ imageUrl?: string }> {
    try {
      const tools = await this.workerMgr.send<MCPTool[]>('mcp:getTools');
      // Look for screen capture tool
      const screenTool = tools.find((t) =>
        ['get_screen', 'take_screenshot', 'screenshot', 'capture_screen'].includes(t.name.toLowerCase())
      ) || tools.find((t) => t.name.toLowerCase().includes('screen'));

      const toolNameToCall = screenTool ? screenTool.name : 'get_screen';
      const res = await this.workerMgr.send<{ image?: string; text?: string; isError?: boolean }>(
        'mcp:callTool',
        { name: toolNameToCall, args: {} }
      );

      if (res.image) {
        return { imageUrl: res.image };
      }
    } catch (e) {
      console.warn('[Scheduler] Screen capture via MCP tool failed:', e);
    }
    return {};
  }

  /**
   * Send OS desktop notification
   */
  private sendDesktopNotification(title: string, body: string): void {
    try {
      if (electron.Notification && electron.Notification.isSupported()) {
        const notif = new electron.Notification({
          title,
          body: body.length > 250 ? body.slice(0, 250) + '...' : body,
          silent: false,
        });
        notif.show();
      }
    } catch (err) {
      console.warn('[Scheduler] Could not display OS notification:', err);
    }
  }

  /**
   * Push update events to renderer window
   */
  private notifyRenderer(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('jobs:updated', this.store.getJobs());
      win.webContents.send('jobs:logsUpdated', this.store.getLogs());
    }
  }
}
