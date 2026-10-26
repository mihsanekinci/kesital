import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  IMediaEngineAdapter,
  ISystemFileAdapter,
  VideoMetadata,
  ClipRequest,
  ClipJobStatus
} from '../domain/models.js';

/**
 * Core business service orchestrating video inspection, clipping jobs, and system interactions.
 */
export class VideoClipService {
  private readonly jobs: Map<string, ClipJobStatus> = new Map();
  private readonly jobEvents: EventEmitter = new EventEmitter();

  constructor(
    private readonly mediaEngine: IMediaEngineAdapter,
    private readonly fileAdapter: ISystemFileAdapter
  ) {
    this.jobEvents.setMaxListeners(100);
  }

  /**
   * Inspects video resource metadata via the media engine adapter.
   */
  async inspectVideo(url: string): Promise<VideoMetadata> {
    return this.mediaEngine.inspectVideo(url);
  }

  /**
   * Initiates an asynchronous clip trimming and download process.
   * Immediately returns the initialized job status and processes the download in background.
   */
  startClipDownload(request: ClipRequest): ClipJobStatus {
    const jobId = randomUUID();
    const nowIso = new Date().toISOString();

    const initialJob: ClipJobStatus = {
      jobId,
      status: 'processing',
      progressPercent: 0,
      statusMessage: 'Klip kesme kuyruğuna alındı...',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.jobs.set(jobId, initialJob);

    // Launch background task
    (async () => {
      try {
        const result = await this.mediaEngine.downloadClip(
          request,
          (percent: number, message: string) => {
            this.updateJob(jobId, {
              progressPercent: percent,
              statusMessage: message
            });
          }
        );

        this.updateJob(jobId, {
          status: 'completed',
          progressPercent: 100,
          statusMessage: 'Klip başarıyla kaydedildi.',
          outputFilePath: result.outputFilePath,
          fileName: result.fileName
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.updateJob(jobId, {
          status: 'failed',
          statusMessage: 'Klip oluşturulamadı.',
          error: errorMessage
        });
      }
    })();

    return initialJob;
  }

  /**
   * Retrieves the current tracking state of a clip job.
   */
  getJobStatus(jobId: string): ClipJobStatus | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Subscribes a listener callback to real-time status updates of a specific job.
   * Returns an unsubscribe function.
   */
  subscribeToJob(jobId: string, listener: (job: ClipJobStatus) => void): () => void {
    const eventName = `job:${jobId}`;
    this.jobEvents.on(eventName, listener);

    return () => {
      this.jobEvents.off(eventName, listener);
    };
  }

  /**
   * Requests the operating system to reveal the downloaded file in Finder / Explorer.
   */
  async revealInFinder(filePath: string): Promise<void> {
    await this.fileAdapter.revealInFinder(filePath);
  }

  /**
   * Checks if there are any jobs currently in 'processing' status.
   */
  hasActiveJobs(): boolean {
    return Array.from(this.jobs.values()).some((j) => j.status === 'processing');
  }

  /**
   * Cleans up temporary preview files from disk.
   */
  cleanupPreviews(): void {
    if (typeof this.mediaEngine.cleanupPreviews === 'function') {
      this.mediaEngine.cleanupPreviews();
      return;
    }

    const previewDir = path.join(os.tmpdir(), 'kesital-previews');
    if (fs.existsSync(previewDir)) {
      try {
        const files = fs.readdirSync(previewDir);
        for (const file of files) {
          fs.rmSync(path.join(previewDir, file), { force: true, recursive: true });
        }
      } catch (err) {
        console.warn('Önizleme temizleme hatası:', err);
      }
    }
  }

  /**
   * Internal helper to update job state and emit update events.
   */
  private updateJob(jobId: string, updates: Partial<ClipJobStatus>): void {
    const current = this.jobs.get(jobId);
    if (!current) return;

    const updated: ClipJobStatus = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.jobs.set(jobId, updated);
    this.jobEvents.emit(`job:${jobId}`, updated);
  }
}
