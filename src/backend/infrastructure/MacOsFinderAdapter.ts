import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import { ISystemFileAdapter } from '../domain/models.js';

const execFileAsync = promisify(execFile);

/**
 * Concrete adapter for macOS Finder file revelation.
 */
export class MacOsFinderAdapter implements ISystemFileAdapter {
  /**
   * Opens the file in macOS Finder, selecting and highlighting it.
   */
  async revealInFinder(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Hedef dosya diskte bulunamadı: ${filePath}`);
    }

    const platform = os.platform();

    if (platform === 'darwin') {
      // macOS specific command: open -R <path>
      await execFileAsync('open', ['-R', filePath]);
    } else if (platform === 'win32') {
      // Windows explorer fallback
      await execFileAsync('explorer.exe', [`/select,${filePath}`]);
    } else {
      // Linux xdg-open fallback to directory
      const dirname = fs.statSync(filePath).isDirectory() ? filePath : filePath.substring(0, filePath.lastIndexOf('/'));
      await execFileAsync('xdg-open', [dirname]);
    }
  }
}
