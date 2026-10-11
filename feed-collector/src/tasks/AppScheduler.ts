import cron from 'node-cron';
import type { Task } from './Task';

/**
 * Registers and starts scheduled tasks.
 *
 * Validates each task's cron expression, wraps each run() in error handling
 * so one failing task never prevents others from running.
 *
 * @example
 *   appScheduler.register([feedIngestionTask, tokenRefreshTask]);
 */
export class AppScheduler {
  private readonly tasks: Task[] = [];

  /**
   * Register one or more tasks. Can be called multiple times before start().
   * Throws immediately if any cron expression is invalid — fail fast at startup.
   */
  register(tasks: Task[]): this {
    for (const task of tasks) {
      if (!cron.validate(task.schedule)) {
        throw new Error(
          `[AppScheduler] Invalid cron schedule for task "${task.name}": "${task.schedule}"`
        );
      }
      this.tasks.push(task);
    }
    return this;
  }

  /**
   * Start all registered tasks.
   * Each task runs independently — one failure does not affect others.
   */
  start(): void {
    if (this.tasks.length === 0) {
      console.warn('[AppScheduler] No tasks registered — nothing to schedule');
      return;
    }

    for (const task of this.tasks) {
      console.log(`[AppScheduler] Scheduling "${task.name}": ${task.schedule}`);

      cron.schedule(task.schedule, async () => {
        console.log(`[AppScheduler] Running "${task.name}"...`);
        try {
          await task.run();
        } catch (err) {
          console.error(
            `[AppScheduler] Task "${task.name}" failed:`,
            err instanceof Error ? err.message : err
          );
        }
      });
    }

    console.log(`[AppScheduler] ${this.tasks.length} task(s) scheduled`);
  }
}
