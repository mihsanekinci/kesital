import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import {
  IMediaEngineAdapter,
  ISystemFileAdapter,
  VideoMetadata,
  ClipRequest
} from '../../src/backend/domain/models.js';
import { VideoClipService } from '../../src/backend/services/VideoClipService.js';
import { createApp } from '../../src/backend/app.js';

describe('VideoClipService & Express HTTP API Tests', () => {
  const sampleMetadata: VideoMetadata = {
    id: 'dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Test Video',
    durationSeconds: 212,
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    platform: 'youtube',
    youtubeVideoId: 'dQw4w9WgXcQ'
  };

  const createMockMediaEngine = (overrides?: Partial<IMediaEngineAdapter>): IMediaEngineAdapter => ({
    inspectVideo: vi.fn().mockResolvedValue(sampleMetadata),
    downloadClip: vi.fn().mockImplementation(
      async (_req: ClipRequest, onProgress: (p: number, m: string) => void) => {
        onProgress(50, 'Yarılandı...');
        return {
          outputFilePath: '/tmp/downloads/test_clip.mp4',
          fileName: 'test_clip.mp4'
        };
      }
    ),
    ...overrides
  });

  const createMockFileAdapter = (overrides?: Partial<ISystemFileAdapter>): ISystemFileAdapter => ({
    revealInFinder: vi.fn().mockResolvedValue(undefined),
    ...overrides
  });

  describe('VideoClipService Unit Tests', () => {
    it('should inspect video via media engine adapter', async () => {
      const mockEngine = createMockMediaEngine();
      const mockFile = createMockFileAdapter();
      const service = new VideoClipService(mockEngine, mockFile);

      const result = await service.inspectVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(mockEngine.inspectVideo).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toEqual(sampleMetadata);
    });

    it('should process clip download asynchronously and update job status', async () => {
      const mockEngine = createMockMediaEngine();
      const mockFile = createMockFileAdapter();
      const service = new VideoClipService(mockEngine, mockFile);

      const job = service.startClipDownload({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        startTimeSeconds: 10,
        endTimeSeconds: 30
      });

      expect(job.jobId).toBeDefined();
      expect(job.status).toBe('processing');

      // Wait a short tick for the async download task to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updatedJob = service.getJobStatus(job.jobId);
      expect(updatedJob).toBeDefined();
      expect(updatedJob?.status).toBe('completed');
      expect(updatedJob?.progressPercent).toBe(100);
      expect(updatedJob?.outputFilePath).toBe('/tmp/downloads/test_clip.mp4');
      expect(updatedJob?.fileName).toBe('test_clip.mp4');
    });

    it('should set job status to failed when downloadClip throws an error', async () => {
      const failingEngine = createMockMediaEngine({
        downloadClip: vi.fn().mockRejectedValue(new Error('Ağ bağlantısı koptu'))
      });
      const mockFile = createMockFileAdapter();
      const service = new VideoClipService(failingEngine, mockFile);

      const job = service.startClipDownload({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        startTimeSeconds: 10,
        endTimeSeconds: 30
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const updatedJob = service.getJobStatus(job.jobId);
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.error).toBe('Ağ bağlantısı koptu');
    });

    it('should delegate revealInFinder to file adapter', async () => {
      const mockEngine = createMockMediaEngine();
      const mockFile = createMockFileAdapter();
      const service = new VideoClipService(mockEngine, mockFile);

      await service.revealInFinder('/tmp/downloads/clip.mp4');
      expect(mockFile.revealInFinder).toHaveBeenCalledWith('/tmp/downloads/clip.mp4');
    });

    it('should report active jobs correctly via hasActiveJobs', async () => {
      const mockEngine = createMockMediaEngine({
        downloadClip: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { outputFilePath: '/path', fileName: 'f' };
        })
      });
      const mockFile = createMockFileAdapter();
      const service = new VideoClipService(mockEngine, mockFile);

      expect(service.hasActiveJobs()).toBe(false);

      service.startClipDownload({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        startTimeSeconds: 0,
        endTimeSeconds: 5
      });

      expect(service.hasActiveJobs()).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(service.hasActiveJobs()).toBe(false);
    });

    it('should invoke mediaEngine cleanupPreviews if present', () => {
      const mockCleanup = vi.fn();
      const mockEngine = createMockMediaEngine({
        cleanupPreviews: mockCleanup
      });
      const mockFile = createMockFileAdapter();
      const service = new VideoClipService(mockEngine, mockFile);

      service.cleanupPreviews();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe('HTTP API Endpoints Integration Tests', () => {
    const mockEngine = createMockMediaEngine();
    const mockFile = createMockFileAdapter();
    const service = new VideoClipService(mockEngine, mockFile);
    const app = createApp({ service });

    it('GET /api/health returns ok status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('POST /api/videos/inspect succeeds with valid url', async () => {
      const res = await request(app)
        .post('/api/videos/inspect')
        .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('dQw4w9WgXcQ');
      expect(res.body.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(res.body.platform).toBe('youtube');
    });

    it('POST /api/videos/inspect fails with 400 for invalid url', async () => {
      const res = await request(app)
        .post('/api/videos/inspect')
        .send({ url: 'not-a-valid-url' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Geçersiz istek parametreleri.');
    });

    it('GET /api/videos/preview/:fileName returns 404 for non-existent preview', async () => {
      const res = await request(app).get('/api/videos/preview/non_existent.mp4');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('bulunamadı');
    });

    it('POST /api/clips/download returns 202 and starts clip job', async () => {
      const res = await request(app)
        .post('/api/clips/download')
        .send({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          startTimeSeconds: 5,
          endTimeSeconds: 25,
          title: 'Harika Kesit'
        });

      expect(res.status).toBe(202);
      expect(res.body.jobId).toBeDefined();
      expect(res.body.status).toBe('processing');

      // Check job status by ID
      const statusRes = await request(app).get(`/api/clips/jobs/${res.body.jobId}`);
      expect(statusRes.status).toBe(200);
    });

    it('POST /api/clips/download returns 400 for invalid interval', async () => {
      const res = await request(app)
        .post('/api/clips/download')
        .send({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          startTimeSeconds: 30,
          endTimeSeconds: 10
        });

      expect(res.status).toBe(400);
      expect(res.body.details).toBeDefined();
    });

    it('GET /api/clips/jobs/:jobId returns 404 for unknown job', async () => {
      const res = await request(app).get('/api/clips/jobs/non-existing-job-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('bulunamadı');
    });

    it('GET /api/clips/progress/:jobId returns SSE event stream', async () => {
      const postRes = await request(app)
        .post('/api/clips/download')
        .send({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          startTimeSeconds: 0,
          endTimeSeconds: 10
        });

      const jobId = postRes.body.jobId;

      const sseRes = await request(app)
        .get(`/api/clips/progress/${jobId}`)
        .expect('Content-Type', /text\/event-stream/);

      expect(sseRes.text).toContain(`data:`);
      expect(sseRes.text).toContain(jobId);
    });

    it('POST /api/system/reveal calls file revelation adapter', async () => {
      const res = await request(app)
        .post('/api/system/reveal')
        .send({ filePath: '/tmp/downloads/sample.mp4' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFile.revealInFinder).toHaveBeenCalledWith('/tmp/downloads/sample.mp4');
    });

    it('POST /api/system/reveal returns 400 for empty filePath', async () => {
      const res = await request(app)
        .post('/api/system/reveal')
        .send({ filePath: '' });

      expect(res.status).toBe(400);
    });

    it('POST /api/system/heartbeat returns alive status and timestamp', async () => {
      const res = await request(app).post('/api/system/heartbeat');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
      expect(typeof res.body.timestamp).toBe('number');
    });

    it('POST /api/system/shutdown returns success and cleanup message', async () => {
      // In test mode NODE_ENV === 'test', so process.exit is not triggered
      const res = await request(app).post('/api/system/shutdown');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('kapatılıyor');
    });
  });
});
