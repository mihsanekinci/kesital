import { describe, it, expect } from 'vitest';
import {
  formatSecondsToTimestamp,
  extractYouTubeId,
  inspectVideoSchema,
  downloadClipSchema,
  revealFileSchema
} from '../../src/backend/domain/schemas.js';

describe('Domain Schemas and Utility Functions', () => {
  describe('formatSecondsToTimestamp', () => {
    it('should format 0 seconds to 00:00:00.000', () => {
      expect(formatSecondsToTimestamp(0)).toBe('00:00:00.000');
    });

    it('should format fractional seconds accurately', () => {
      expect(formatSecondsToTimestamp(65.5)).toBe('00:01:05.500');
      expect(formatSecondsToTimestamp(72.123)).toBe('00:01:12.123');
    });

    it('should format hours correctly', () => {
      expect(formatSecondsToTimestamp(3661.05)).toBe('01:01:01.050');
      expect(formatSecondsToTimestamp(7322.999)).toBe('02:02:02.999');
    });

    it('should handle negative or NaN inputs safely', () => {
      expect(formatSecondsToTimestamp(-10)).toBe('00:00:00.000');
      expect(formatSecondsToTimestamp(NaN)).toBe('00:00:00.000');
    });
  });

  describe('extractYouTubeId', () => {
    it('should extract video ID from standard watch URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(extractYouTubeId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from short youtu.be URL', () => {
      const url = 'https://youtu.be/dQw4w9WgXcQ';
      expect(extractYouTubeId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from shorts URL', () => {
      const url = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
      expect(extractYouTubeId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from embed URL', () => {
      const url = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
      expect(extractYouTubeId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from URL with additional query parameters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s&feature=shared';
      expect(extractYouTubeId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should return null for non-YouTube URLs', () => {
      expect(extractYouTubeId('https://example.com/video.mp4')).toBeNull();
      expect(extractYouTubeId('https://vimeo.com/123456789')).toBeNull();
      expect(extractYouTubeId('')).toBeNull();
    });
  });

  describe('Zod Validation Schemas', () => {
    it('should validate valid inspectVideo input', () => {
      const result = inspectVideoSchema.safeParse({ url: 'https://www.youtube.com/watch?v=abc12345678' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid URL in inspectVideo', () => {
      const result = inspectVideoSchema.safeParse({ url: 'not-a-valid-url' });
      expect(result.success).toBe(false);
    });

    it('should validate valid downloadClip input', () => {
      const result = downloadClipSchema.safeParse({
        url: 'https://www.youtube.com/watch?v=abc12345678',
        startTimeSeconds: 10,
        endTimeSeconds: 30,
        title: 'Harika Kesit'
      });
      expect(result.success).toBe(true);
    });

    it('should reject downloadClip when endTime <= startTime', () => {
      const result = downloadClipSchema.safeParse({
        url: 'https://www.youtube.com/watch?v=abc12345678',
        startTimeSeconds: 30,
        endTimeSeconds: 20
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Bitiş süresi başlangıç süresinden');
      }
    });

    it('should reject negative seconds in downloadClip', () => {
      const result = downloadClipSchema.safeParse({
        url: 'https://www.youtube.com/watch?v=abc12345678',
        startTimeSeconds: -5,
        endTimeSeconds: 20
      });
      expect(result.success).toBe(false);
    });

    it('should validate revealFile input', () => {
      expect(revealFileSchema.safeParse({ filePath: '/tmp/downloads/clip.mp4' }).success).toBe(true);
      expect(revealFileSchema.safeParse({ filePath: '' }).success).toBe(false);
    });
  });
});
