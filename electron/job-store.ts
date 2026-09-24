import fs from 'node:fs';
import path from 'node:path';
import electronPkg from 'electron';
import type { ScheduledJob, JobExecutionLog } from '../src/types';

const app = typeof electronPkg === 'object' && electronPkg !== null
  ? (electronPkg.app || (electronPkg as unknown as { default?: { app?: typeof electronPkg.app } }).default?.app)
  : undefined;

const MAX_LOGS = 50;

export class JobStore {
  private jobsPath: string;
  private logsPath: string;
  private jobs: ScheduledJob[] = [];
  private logs: JobExecutionLog[] = [];

  constructor() {
    const userDataPath = app?.getPath ? app.getPath('userData') : process.cwd();
    this.jobsPath = path.join(userDataPath, 'jobs.json');
    this.logsPath = path.join(userDataPath, 'job_logs.json');
    this.jobs = this.loadJobs();
    this.logs = this.loadLogs();
  }

  public getJobs(): ScheduledJob[] {
    return [...this.jobs];
  }

  public getJob(id: string): ScheduledJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  public saveJob(job: ScheduledJob): ScheduledJob[] {
    const index = this.jobs.findIndex((j) => j.id === job.id);
    if (index >= 0) {
      this.jobs[index] = { ...this.jobs[index], ...job };
    } else {
      this.jobs.push(job);
    }
    this.persistJobs();
    return this.getJobs();
  }

  public deleteJob(id: string): ScheduledJob[] {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.persistJobs();
    return this.getJobs();
  }

  public toggleJob(id: string, enabled?: boolean): ScheduledJob | null {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return null;
    job.enabled = enabled !== undefined ? enabled : !job.enabled;
    if (job.enabled && job.trigger.type === 'interval' && job.trigger.intervalMinutes) {
      job.nextRunAt = Date.now() + job.trigger.intervalMinutes * 60 * 1000;
    }
    this.persistJobs();
    return { ...job };
  }

  public updateJobResult(
    id: string,
    result: { success: boolean; summary: string; matched?: boolean; error?: string },
    nextRunAt?: number
  ): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.lastRunAt = Date.now();
    job.lastResult = {
      timestamp: Date.now(),
      ...result,
    };
    if (nextRunAt !== undefined) {
      job.nextRunAt = nextRunAt;
    }
    this.persistJobs();
  }

  public getLogs(): JobExecutionLog[] {
    return [...this.logs];
  }

  public addLog(log: JobExecutionLog): void {
    this.logs.unshift(log);
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(0, MAX_LOGS);
    }
    this.persistLogs();
  }

  public clearLogs(): void {
    this.logs = [];
    this.persistLogs();
  }

  private persistJobs(): void {
    try {
      fs.mkdirSync(path.dirname(this.jobsPath), { recursive: true });
      fs.writeFileSync(this.jobsPath, JSON.stringify(this.jobs, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save jobs:', err);
    }
  }

  private persistLogs(): void {
    try {
      fs.mkdirSync(path.dirname(this.logsPath), { recursive: true });
      fs.writeFileSync(this.logsPath, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save job logs:', err);
    }
  }

  private loadJobs(): ScheduledJob[] {
    try {
      if (fs.existsSync(this.jobsPath)) {
        const raw = fs.readFileSync(this.jobsPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('Failed to load jobs file:', err);
    }
    return [];
  }

  private loadLogs(): JobExecutionLog[] {
    try {
      if (fs.existsSync(this.logsPath)) {
        const raw = fs.readFileSync(this.logsPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('Failed to load job logs file:', err);
    }
    return [];
  }
}
