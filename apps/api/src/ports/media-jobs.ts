// Where the api sends the media jobs (M1.2): the worker makes the sizes and the edits. A port, so the tests can record the jobs
// instead of running pg-boss; the real one is adapters/media-queue.ts.
import type { MediaJob } from '@toascribe/shared'

export interface MediaJobPort {
  /** Queues the job once: a second job for the same file and kind while one waits is dropped (pg-boss singletonKey, `stately`). */
  send: (job: MediaJob) => Promise<void>
}
