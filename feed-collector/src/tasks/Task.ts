/** Contract for any schedulable unit of work. */
export interface Task {
  /** Human-readable name used in log output */
  readonly name: string;
  /** Cron expression controlling when this task runs (e.g. '0 0 * * *') */
  readonly schedule: string;
  /** The work to execute on each scheduled tick */
  run(): Promise<void>;
}
