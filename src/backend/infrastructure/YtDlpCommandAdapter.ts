import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  IMediaEngineAdapter,
  VideoMetadata,
  ClipRequest,
  VideoPlatform
} from '../domain/models.js';
import {
  formatSecondsToTimestamp,
  extractYouTubeId
} from '../domain/schemas.js';

const execFileAsync = promisify(execFile);

/**
 * Concrete adapter that interacts with system yt-dlp, ffmpeg, and ffprobe CLI tools.
 */
export class YtDlpCommandAdapter implements IMediaEngineAdapter {
  private readonly ytDlpPath: string;
  private readonly ffmpegLocation: string;
  private readonly ffmpegBinary: string;
  private readonly ffprobeBinary: string;
  private readonly outputDirectory: string;
  private readonly previewDirectory: string;

  constructor(
    customYtDlpPath?: string,
    customFfmpegLocation?: string,
    customOutputDirectory?: string,
    customPreviewDirectory?: string
  ) {
    // Resolve yt-dlp binary
    if (customYtDlpPath) {
      this.ytDlpPath = customYtDlpPath;
    } else if (fs.existsSync('/opt/homebrew/bin/yt-dlp')) {
      this.ytDlpPath = '/opt/homebrew/bin/yt-dlp';
    } else {
      this.ytDlpPath = 'yt-dlp';
    }

    // Resolve ffmpeg binary location directory & executables
    if (customFfmpegLocation) {
      this.ffmpegLocation = customFfmpegLocation;
      this.ffmpegBinary = path.join(customFfmpegLocation, 'ffmpeg');
      this.ffprobeBinary = path.join(customFfmpegLocation, 'ffprobe');
    } else if (fs.existsSync('/opt/homebrew/bin/ffmpeg')) {
      this.ffmpegLocation = '/opt/homebrew/bin';
      this.ffmpegBinary = '/opt/homebrew/bin/ffmpeg';
      this.ffprobeBinary = fs.existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';
    } else {
      this.ffmpegLocation = '/usr/local/bin';
      this.ffmpegBinary = 'ffmpeg';
      this.ffprobeBinary = 'ffprobe';
    }

    // Default download folder (macOS Downloads)
    const defaultDownloads = path.join(os.homedir(), 'Downloads');
    this.outputDirectory = customOutputDirectory || defaultDownloads;

    if (!fs.existsSync(this.outputDirectory)) {
      fs.mkdirSync(this.outputDirectory, { recursive: true });
    }

    // Local preview cache directory for generic platforms (Instagram, TikTok, etc.)
    this.previewDirectory = customPreviewDirectory || path.join(os.tmpdir(), 'kesital-previews');
    if (!fs.existsSync(this.previewDirectory)) {
      fs.mkdirSync(this.previewDirectory, { recursive: true });
    }
  }

  /**
   * Generates a deterministic SHA-256 hash for a given URL.
   */
  private getUrlHash(url: string): string {
    return createHash('sha256').update(url.trim()).digest('hex').substring(0, 16);
  }

  /**
   * Probes precise duration in seconds using ffprobe.
   */
  private async probeDuration(filePath: string): Promise<number> {
    try {
      const probeArgs = [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath
      ];
      const { stdout } = await execFileAsync(this.ffprobeBinary, probeArgs);
      const parsed = parseFloat(stdout.trim());
      return !isNaN(parsed) && parsed > 0 ? parsed : 0;
    } catch (err) {
      console.warn('ffprobe süre analizi başarısız oldu:', err);
      return 0;
    }
  }

  /**
   * Inspects video properties using yt-dlp --dump-single-json.
   * For non-YouTube (generic) platforms like Instagram, downloads a local preview cache
   * to guarantee CORS-free HTML5 playback and accurate duration via ffprobe.
   */
  async inspectVideo(url: string): Promise<VideoMetadata> {
    const args = ['--dump-single-json', '--no-playlist', url];

    try {
      const { stdout } = await execFileAsync(this.ytDlpPath, args, {
        maxBuffer: 30 * 1024 * 1024 // 30 MB buffer for large video manifests
      });

      const parsed = JSON.parse(stdout);
      const parsedId = String(parsed.id || 'unknown');
      const title = String(parsed.title || 'Untitled Video');
      let durationSeconds = Number(parsed.duration || 0);
      const thumbnailUrl = String(parsed.thumbnail || '');

      const ytId = extractYouTubeId(url) || (parsed.extractor?.toLowerCase().includes('youtube') ? parsedId : undefined);
      const platform: VideoPlatform = ytId ? 'youtube' : 'generic';

      let directStreamUrl: string | undefined = undefined;

      if (platform === 'generic') {
        const hash = this.getUrlHash(url);
        const previewFileName = `preview_${hash}.mp4`;
        const previewFilePath = path.join(this.previewDirectory, previewFileName);

        // Download local preview if not already cached
        const isCached = fs.existsSync(previewFilePath) && fs.statSync(previewFilePath).size > 1024;
        if (!isCached) {
          const previewDownloadArgs = [
            '--ffmpeg-location',
            this.ffmpegLocation,
            '--no-playlist',
            '-f',
            'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
            '--merge-output-format',
            'mp4',
            '--postprocessor-args',
            'Merger+ffmpeg:-c:v copy -c:a aac -ar 44100 -ac 2',
            '-o',
            previewFilePath,
            url
          ];

          await execFileAsync(this.ytDlpPath, previewDownloadArgs, {
            maxBuffer: 30 * 1024 * 1024
          });
        }

        // If duration was not reported by yt-dlp (e.g. Instagram Reels), probe it with ffprobe
        if (durationSeconds <= 0 && fs.existsSync(previewFilePath)) {
          const probed = await this.probeDuration(previewFilePath);
          if (probed > 0) {
            durationSeconds = probed;
          }
        }

        // Expose via local proxy endpoint for CORS-free Range playback
        directStreamUrl = `/api/videos/preview/${previewFileName}`;
      } else {
        // YouTube: directStreamUrl fallback if provided
        if (typeof parsed.url === 'string' && parsed.url.startsWith('http')) {
          directStreamUrl = parsed.url;
        } else if (Array.isArray(parsed.formats)) {
          const playableFormat = parsed.formats.find(
            (f: { vcodec?: string; acodec?: string; ext?: string; url?: string }) =>
              f.ext === 'mp4' &&
              f.vcodec !== 'none' &&
              f.acodec !== 'none' &&
              f.url?.startsWith('http')
          );
          if (playableFormat?.url) {
            directStreamUrl = playableFormat.url;
          }
        }
      }

      return {
        id: parsedId,
        url,
        title,
        durationSeconds,
        thumbnailUrl,
        platform,
        youtubeVideoId: ytId || undefined,
        directStreamUrl
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Video bilgileri ayrıştırılamadı: ${errorMessage}`);
    }
  }

  /**
   * Downloads and trims the precise section.
   * If local preview file is already cached, uses ffmpeg directly for near-instant trimming.
   * Otherwise uses yt-dlp --download-sections and keyframe preservation.
   */
  async downloadClip(
    request: ClipRequest,
    onProgress: (percent: number, message: string) => void
  ): Promise<{ outputFilePath: string; fileName: string }> {
    const startFormatted = formatSecondsToTimestamp(request.startTimeSeconds);
    const endFormatted = formatSecondsToTimestamp(request.endTimeSeconds);

    // Sanitize title for file system
    const rawTitle = (request.title || 'video_clip').trim();
    const sanitizedTitle = rawTitle
      .replace(/[^\w\s\u00C0-\u017F.-]/gi, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 80) || 'video_clip';

    const cleanStart = startFormatted.replace(/:/g, '-');
    const cleanEnd = endFormatted.replace(/:/g, '-');

    let baseFileName = `${sanitizedTitle}_[${cleanStart}_to_${cleanEnd}]`;
    let fileName = `${baseFileName}.mp4`;
    let outputFilePath = path.join(this.outputDirectory, fileName);

    // Avoid overwriting existing files by appending timestamp if exists
    if (fs.existsSync(outputFilePath)) {
      const uniqueSuffix = Date.now().toString().slice(-6);
      baseFileName = `${baseFileName}_${uniqueSuffix}`;
      fileName = `${baseFileName}.mp4`;
      outputFilePath = path.join(this.outputDirectory, fileName);
    }

    // Fast-path: Check if local preview is already cached for this URL
    const hash = this.getUrlHash(request.url);
    const cachedPreviewPath = path.join(this.previewDirectory, `preview_${hash}.mp4`);

    if (fs.existsSync(cachedPreviewPath) && fs.statSync(cachedPreviewPath).size > 1024) {
      return this.cutFromLocalPreview(
        cachedPreviewPath,
        request.startTimeSeconds,
        request.endTimeSeconds,
        outputFilePath,
        fileName,
        onProgress
      );
    }

    // Standard path: yt-dlp --download-sections
    const args = [
      '--ffmpeg-location',
      this.ffmpegLocation,
      '--download-sections',
      `*${startFormatted}-${endFormatted}`,
      '--force-keyframes-at-cuts',
      '-f',
      'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '--newline',
      '-o',
      outputFilePath,
      request.url
    ];

    return new Promise<{ outputFilePath: string; fileName: string }>((resolve, reject) => {
      onProgress(5, 'Medya indirme ve kesme işlemi başlatılıyor...');

      const processHandle = spawn(this.ytDlpPath, args);

      const progressRegex = /\[download\]\s+(\d+(?:\.\d+)?)%/i;
      let lastPercent = 5;

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/);

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const match = trimmed.match(progressRegex);
          if (match && match[1]) {
            const parsedPercent = parseFloat(match[1]);
            const scaledPercent = Math.min(90, Math.max(lastPercent, Math.round(parsedPercent * 0.85 + 5)));
            lastPercent = scaledPercent;
            onProgress(scaledPercent, trimmed);
          } else if (trimmed.includes('[Merger]') || trimmed.includes('[Fixup]')) {
            onProgress(92, 'Video ve ses akışları MP4 kapsayıcısında birleştiriliyor...');
          } else if (trimmed.includes('[download] 100%')) {
            onProgress(95, 'Klip kesimi tamamlanıyor...');
          }
        }
      };

      processHandle.stdout.on('data', handleOutput);
      processHandle.stderr.on('data', handleOutput);

      processHandle.on('error', (spawnErr) => {
        reject(new Error(`yt-dlp süreci başlatılamadı: ${spawnErr.message}`));
      });

      processHandle.on('close', (exitCode) => {
        if (exitCode !== 0) {
          reject(new Error(`yt-dlp işlemi hata koduyla sonlandı: ${exitCode}`));
          return;
        }

        if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size === 0) {
          const possibleFiles = fs.readdirSync(this.outputDirectory);
          const matched = possibleFiles.find((f) => f.startsWith(baseFileName));
          if (matched) {
            const resolvedPath = path.join(this.outputDirectory, matched);
            onProgress(100, 'İşlem başarıyla tamamlandı.');
            resolve({ outputFilePath: resolvedPath, fileName: matched });
            return;
          }

          reject(new Error('Klip oluşturuldu ancak çıktı dosyası diskte doğrulanamadı.'));
          return;
        }

        onProgress(100, 'Klip başarıyla kaydedildi.');
        resolve({ outputFilePath, fileName });
      });
    });
  }

  /**
   * Fast cut directly from local cached preview file via ffmpeg.
   */
  private async cutFromLocalPreview(
    previewPath: string,
    startTime: number,
    endTime: number,
    outputPath: string,
    fileName: string,
    onProgress: (percent: number, message: string) => void
  ): Promise<{ outputFilePath: string; fileName: string }> {
    return new Promise<{ outputFilePath: string; fileName: string }>((resolve, reject) => {
      onProgress(15, 'Yerel önizleme önbelleğinden yüksek hızda kesiliyor...');

      const ffmpegArgs = [
        '-y',
        '-ss',
        String(startTime),
        '-to',
        String(endTime),
        '-i',
        previewPath,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        outputPath
      ];

      const child = spawn(this.ffmpegBinary, ffmpegArgs);

      child.stderr.on('data', (_data: Buffer) => {
        onProgress(60, 'Kareler hassas şekilde kodlanıyor...');
      });

      child.on('error', (err) => {
        reject(new Error(`ffmpeg kesme işlemi başlatılamadı: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
          reject(new Error(`ffmpeg işlemi hata ile sonlandı (kod: ${code})`));
          return;
        }

        onProgress(100, 'Klip başarıyla kaydedildi.');
        resolve({ outputFilePath: outputPath, fileName });
      });
    });
  }

  /**
   * Cleans up all cached preview media files.
   */
  cleanupPreviews(): void {
    if (fs.existsSync(this.previewDirectory)) {
      try {
        const files = fs.readdirSync(this.previewDirectory);
        for (const file of files) {
          const filePath = path.join(this.previewDirectory, file);
          fs.rmSync(filePath, { force: true, recursive: true });
        }
      } catch (err) {
        console.warn('Önizleme klasörü temizlenirken hata:', err);
      }
    }
  }
}
