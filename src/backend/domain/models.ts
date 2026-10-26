/**
 * Video platform types supported by the clipper.
 */
export type VideoPlatform = 'youtube' | 'generic';

/**
 * Status lifecycle of an active or finished clipping job.
 */
export type ClipJobState = 'processing' | 'completed' | 'failed';

/**
 * Inspected metadata for a video source.
 */
export interface VideoMetadata {
  id: string;
  url: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string;
  platform: VideoPlatform;
  youtubeVideoId?: string;
  directStreamUrl?: string;
}

/**
 * Client request payload for trimming a video section.
 */
export interface ClipRequest {
  url: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  title?: string;
}

/**
 * Represents the persistent or in-memory tracking state of a clip job.
 */
export interface ClipJobStatus {
  jobId: string;
  status: ClipJobState;
  progressPercent: number;
  statusMessage: string;
  outputFilePath?: string;
  fileName?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Dependency Inversion Interface for media analysis and clipping operations.
 */
export interface IMediaEngineAdapter {
  /**
   * Inspects video metadata without downloading the full media stream.
   */
  inspectVideo(url: string): Promise<VideoMetadata>;

  /**
   * Trims and downloads the specified section of the video.
   * Calls onProgress when download/processing updates occur.
   */
  downloadClip(
    request: ClipRequest,
    onProgress: (percent: number, message: string) => void
  ): Promise<{ outputFilePath: string; fileName: string }>;

  /**
   * Cleans up local preview media files.
   */
  cleanupPreviews?(): void;
}

/**
 * Dependency Inversion Interface for operating system file operations.
 */
export interface ISystemFileAdapter {
  /**
   * Opens the file's parent folder and reveals the file in macOS Finder or default OS explorer.
   */
  revealInFinder(filePath: string): Promise<void>;
}
