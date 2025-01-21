import fg from 'fast-glob';
import { ValidatedOptions } from './options';
import { Pausable } from './pausableTask';
import cliProgress from 'cli-progress';
import logger from './logger';
import { join, sep } from "path";
import { displayPauseMenu } from "./menu";
import { existsSync, statSync } from "fs";
import FileInfo from "./fileInfo";
import Database from "better-sqlite3";
import { getFileByIno } from "./db";

const statusIcons = {
  ['in-progress']: '⏳', // Hourglass
  pause: '⏸️', // Pause
  stop: '🛑', // Stop
  done: '✅', // Check mark
};

class Scanner implements Pausable<FileInfo> {
  public state: 'in-progress' | 'pause' | 'stop' | 'done';
  public options: ValidatedOptions;
  public db: Database.Database;
  private progressBar: cliProgress.SingleBar;

  constructor(db: Database.Database, options: ValidatedOptions) {
    this.state = 'in-progress';
    this.options = options;
    this.db = db;
    this.progressBar = this.makeProgressBar();
  }

  pause(): void {
    this.requestStateChange('pause');
  }

  stop(): void {
    this.requestStateChange('stop');
  }

  async execute(rootDir: string): Promise<FileInfo[]> {
    const files = await this.getFileList(rootDir);
    if (files.length === 0) {
      logger.warn('No eligible files found');
      this.state = 'done';
      return [];
    }
    logger.debug(`Found ${files.length} files to process`);

    this.progressBar.start(files.length, 0, { status: statusIcons[this.state] });

    const processedFiles: FileInfo[] = [];

    for (let i = 0; i < files.length; i++) {
      if (this.state === 'done' || this.state === 'stop') {
        break;
      }
      if (this.state === 'pause') {
        logger.warn('Scanning paused');
        const action = await displayPauseMenu();
        if (action === 'stop') {
          logger.warn('Processing stopped');
          this.state = 'stop';
          break;
        } else if (process.stdin.isPaused()) {
          // this is just in case inquirer pauses stdin
          process.stdin.resume();
          logger.debug('Resuming stdin stream');
        }

        this.state = 'in-progress';
      }

      try {
        const fileInfo = this.readFileInfo(files[i]);
        const dbEntry = getFileByIno(this.db, fileInfo.inode);
        if (dbEntry) {
          if (dbEntry.processed) {
            this.progressBar.update(i + 1, { status: statusIcons[this.state] });
            continue;
          } else {
            // TODO: update the entry with the media_info from dbEntry
          }
        } else {
          this.probeFile(fileInfo);
          this.db.prepare('INSERT INTO files (ino, path, mtime, size) VALUES (?, ?, ?, ?)')
            .run(fileInfo.inode.toString(), fileInfo.fileName, fileInfo.mtime, fileInfo.size);
        }

        processedFiles.push(fileInfo);
      } catch (e) {
        if (this.options.careful) {
          this.progressBar.stop();
          throw e;
        }

        logger.error(`Error processing file: ${files[i]}. ${(e as Error).message}`);
      }

      this.progressBar.update(i + 1, { status: statusIcons[this.state] });
    }

    this.state = 'done';
    this.progressBar.update({ status: statusIcons[this.state] });
    this.progressBar.stop();

    return processedFiles;
  }

  private readFileInfo (file: string) {
    if (!existsSync(file)) {
      throw new Error(`File not found: ${file}`);
    }

    const stats = statSync(file);
    const entry = new FileInfo(file, stats.ino, stats.size, stats.mtimeMs);

    return entry;
  }

  private probeFile (fileInfo: FileInfo) {
    // TODO: probe the file and return the media_info
  }

  private async getFileList (rootDir: string) {
    const pattern = `**/*.mp4`;
    const files = await fg(pattern, {
      cwd: rootDir,
      onlyFiles: true,
      deep: this.options.deep * 2, // fg counts dir as part of depth
    });

    // the files are returned as relative paths with forward slashes
    const fullPaths = files.map(file => join(rootDir, file.split('/').join(sep)));

    return fullPaths;
  }

  private requestStateChange(state: 'pause' | 'stop'): void {
    if (this.state !== 'in-progress') {
      return;
    }
    this.state = state;
    this.progressBar.update({ status: statusIcons[state] });
  }

  private makeProgressBar(): cliProgress.SingleBar {
    return new cliProgress.SingleBar({
      format: '{status} |{bar}| {percentage}% | {value}/{total} files',
      hideCursor: true,
      clearOnComplete: false,
      fps: 10,
    }, cliProgress.Presets.shades_classic);
  }
}

export default Scanner;
