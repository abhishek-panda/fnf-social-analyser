import type { Task } from './Task';
import type { IIngestionService } from '../interfaces';

/** Wraps IIngestionService as a Task so AppScheduler can register it. */
export class FeedIngestionTask implements Task {
  readonly name: string;

  constructor(
    private readonly ingestionService: IIngestionService,
    readonly schedule: string,
    private readonly mediaType: 'recent_media' | 'top_media' = 'recent_media'
  ) {
    this.name = `FeedIngestion:${mediaType}`;
  }

  async run(): Promise<void> {
    const result = await this.ingestionService.runCycle(this.mediaType);
    console.log(
      `[FeedIngestionTask] ${this.mediaType} complete — total: ${result.total}, matched: ${result.matched}`
    );
  }
}
