import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import { ZodError } from 'zod';
import { YtDlpCommandAdapter } from './infrastructure/YtDlpCommandAdapter.js';
import { MacOsFinderAdapter } from './infrastructure/MacOsFinderAdapter.js';
import { VideoClipService } from './services/VideoClipService.js';
import { ClipController } from './controllers/ClipController.js';

export interface AppOptions {
  service?: VideoClipService;
  publicPath?: string;
  onActivity?: () => void;
}

/**
 * Creates and configures the Express application with layered dependencies.
 */
export function createApp(options?: AppOptions): Express {
  const app: Express = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Track API activity if callback provided
  if (options?.onActivity) {
    app.use('/api', (_req: Request, _res: Response, next: NextFunction) => {
      options.onActivity?.();
      next();
    });
  }

  // Static files from public/ directory
  const publicDir = options?.publicPath || path.join(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Dependency Resolution (DI)
  const service =
    options?.service ||
    new VideoClipService(
      new YtDlpCommandAdapter(),
      new MacOsFinderAdapter()
    );

  app.locals.service = service;
  const controller = new ClipController(service);

  // API Routes
  app.post('/api/videos/inspect', controller.inspectVideo);
  app.get('/api/videos/preview/:fileName', controller.servePreviewFile);
  app.post('/api/clips/download', controller.startClipDownload);
  app.get('/api/clips/jobs/:jobId', controller.getJobStatus);
  app.get('/api/clips/progress/:jobId', controller.streamJobProgress);
  app.post('/api/system/reveal', controller.revealInFinder);
  app.post('/api/system/heartbeat', controller.heartbeat);
  app.post('/api/system/shutdown', controller.shutdown);

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  // Centralized Error Handling Middleware
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const messages = err.errors.map((e) => e.message);
      res.status(400).json({
        error: 'Geçersiz istek parametreleri.',
        details: messages
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Bilinmeyen bir sunucu hatası oluştu.';
    res.status(500).json({
      error: message
    });
  });

  return app;
}

export const app = createApp();
