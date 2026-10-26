import { z } from 'zod';

/**
 * Validation schema for inspecting a remote video resource.
 */
export const inspectVideoSchema = z.object({
  url: z
    .string({ required_error: 'Video URL alanı zorunludur.' })
    .url('Geçerli bir video URL adresi girilmelidir.')
    .trim()
});

export type InspectVideoInput = z.infer<typeof inspectVideoSchema>;

/**
 * Validation schema for initiating a clip download request.
 */
export const downloadClipSchema = z
  .object({
    url: z
      .string({ required_error: 'Video URL alanı zorunludur.' })
      .url('Geçerli bir video URL adresi girilmelidir.')
      .trim(),
    startTimeSeconds: z
      .number({ required_error: 'Başlangıç saniyesi zorunludur.' })
      .min(0, 'Başlangıç süresi 0 saniyeden küçük olamaz.'),
    endTimeSeconds: z
      .number({ required_error: 'Bitiş saniyesi zorunludur.' })
      .min(0, 'Bitiş süresi 0 saniyeden küçük olamaz.'),
    title: z.string().optional()
  })
  .refine((data) => data.endTimeSeconds > data.startTimeSeconds, {
    message: 'Bitiş süresi başlangıç süresinden kesinlikle büyük olmalıdır.',
    path: ['endTimeSeconds']
  });

export type DownloadClipInput = z.infer<typeof downloadClipSchema>;

/**
 * Validation schema for revealing a file in macOS Finder.
 */
export const revealFileSchema = z.object({
  filePath: z
    .string({ required_error: 'Dosya yolu alanı zorunludur.' })
    .min(1, 'Dosya yolu boş olamaz.')
    .trim()
});

export type RevealFileInput = z.infer<typeof revealFileSchema>;

/**
 * Formats a duration in seconds to yt-dlp / ffmpeg compatible HH:MM:SS.mmm format.
 * Examples:
 *   0 -> 00:00:00.000
 *   65.5 -> 00:01:05.500
 *   3661.123 -> 01:01:01.123
 */
export function formatSecondsToTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const totalMilliseconds = Math.round(safeSeconds * 1000);

  const hours = Math.floor(totalMilliseconds / 3600000);
  const remainingAfterHours = totalMilliseconds % 3600000;

  const minutes = Math.floor(remainingAfterHours / 60000);
  const remainingAfterMinutes = remainingAfterHours % 60000;

  const secs = Math.floor(remainingAfterMinutes / 1000);
  const millis = remainingAfterMinutes % 1000;

  const pad = (num: number, digits: number): string => num.toString().padStart(digits, '0');

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(millis, 3)}`;
}

/**
 * Extracts a 11-character YouTube video ID from various standard YouTube URL formats.
 * Supports:
 * - youtube.com/watch?v=...
 * - youtu.be/...
 * - youtube.com/embed/...
 * - youtube.com/shorts/...
 * - youtube.com/v/...
 */
export function extractYouTubeId(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtube(?:-nocookie)?\.com\/(?:watch\?.*?[&?]?v=|embed\/|shorts\/|v\/|e\/)([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?m\.youtube\.com\/watch\?.*?[&?]?v=([a-zA-Z0-9_-]{11})/i
  ];

  for (const regex of patterns) {
    const match = url.match(regex);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
