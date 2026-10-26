import { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { VideoClipService } from '../services/VideoClipService.js';
import {
  inspectVideoSchema,
  downloadClipSchema,
  revealFileSchema
} from '../domain/schemas.js';

export class ClipController {
  constructor(private readonly clipService: VideoClipService) {}

  /**
   * POST /api/videos/inspect
   * Analyzes the video URL and returns metadata for preview rendering.
   */
  inspectVideo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = inspectVideoSchema.parse(req.body);
      const metadata = await this.clipService.inspectVideo(parsedBody.url);
      res.status(200).json(metadata);
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/clips/download
   * Triggers an asynchronous clip trimming and download job.
   */
  startClipDownload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = downloadClipSchema.parse(req.body);
      const initialJob = this.clipService.startClipDownload(parsedBody);
      res.status(202).json(initialJob);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/clips/jobs/:jobId
   * Returns current snapshot of job status.
   */
  getJobStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = String(req.params.jobId);
      const job = this.clipService.getJobStatus(jobId);

      if (!job) {
        res.status(404).json({
          error: 'Belirtilen iş kimliğine (jobId) ait işlem bulunamadı.'
        });
        return;
      }

      res.status(200).json(job);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/clips/progress/:jobId
   * Streams job status updates using Server-Sent Events (SSE).
   */
  streamJobProgress = async (req: Request, res: Response): Promise<void> => {
    const jobId = String(req.params.jobId);
    const initialJob = this.clipService.getJobStatus(jobId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (!initialJob) {
      res.write(`data: ${JSON.stringify({ error: 'İşlem bulunamadı.' })}\n\n`);
      res.end();
      return;
    }

    // Send initial snapshot
    res.write(`data: ${JSON.stringify(initialJob)}\n\n`);

    if (initialJob.status === 'completed' || initialJob.status === 'failed') {
      res.end();
      return;
    }

    // Subscribe to event updates from service
    const unsubscribe = this.clipService.subscribeToJob(jobId, (updatedJob) => {
      res.write(`data: ${JSON.stringify(updatedJob)}\n\n`);
      if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
        cleanup();
        res.end();
      }
    });

    // Fallback polling interval every 400ms to guarantee smooth UI progression
    const intervalTimer = setInterval(() => {
      const current = this.clipService.getJobStatus(jobId);
      if (current) {
        res.write(`data: ${JSON.stringify(current)}\n\n`);
        if (current.status === 'completed' || current.status === 'failed') {
          cleanup();
          res.end();
        }
      } else {
        cleanup();
        res.end();
      }
    }, 400);

    const cleanup = () => {
      unsubscribe();
      clearInterval(intervalTimer);
    };

    req.on('close', cleanup);
  };

  /**
   * POST /api/system/reveal
   * Asks macOS Finder to reveal the file.
   */
  revealInFinder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = revealFileSchema.parse(req.body);
      await this.clipService.revealInFinder(parsedBody.filePath);
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/videos/preview/:fileName
   * Serves local cached preview video with HTTP 206 Partial Content (Byte-Range) support.
   */
  servePreviewFile = async (req: Request, res: Response): Promise<void> => {
    const rawFileName = String(req.params.fileName || '');
    const safeFileName = path.basename(rawFileName);
    const previewDir = path.join(os.tmpdir(), 'kesital-previews');
    const fullPath = path.join(previewDir, safeFileName);

    if (!safeFileName.endsWith('.mp4') || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Önizleme video dosyası bulunamadı.' });
      return;
    }

    res.sendFile(fullPath, {
      acceptRanges: true,
      headers: {
        'Content-Type': 'video/mp4',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      }
    });
  };

  /**
   * POST /api/system/heartbeat
   * Updates last active heartbeat from client.
   */
  heartbeat = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      status: 'alive',
      timestamp: Date.now()
    });
  };

  /**
   * POST /api/system/shutdown
   * Safely shuts down the server and cleans up preview cache.
   */
  shutdown = async (_req: Request, res: Response): Promise<void> => {
    this.clipService.cleanupPreviews();

    res.status(200).json({
      success: true,
      message: 'Sunucu kapatılıyor...'
    });

    if (process.env.NODE_ENV !== 'test') {
      setTimeout(() => {
        process.exit(0);
      }, 300);
    }
  };
}
