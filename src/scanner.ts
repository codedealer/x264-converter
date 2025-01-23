import fg from 'fast-glob';
import { ValidatedOptions } from './options';
import { Pausable } from './pausableTask';
import cliProgress from 'cli-progress';
import logger from './logger';
import { basename, dirname, join, sep } from "path";
import { displayPauseMenu } from "./menu";
import { existsSync, statSync } from "fs";
import FileInfo, { MediaInfo } from "./fileInfo";
import Database from "better-sqlite3";
import { getVideoFileByIno, insertVideoFile, updateVideoFile, VideoFile } from "./db";
import { FFmpegExecutor } from "./ffmpeg";
import { stringToArgs } from "./utils";

const statusIcons = {
  ['in-progress']: '⏳', // Hourglass
  pause: '⏸️', // Pause
  stop: '🛑', // Stop
  done: '✅', // Check mark
};

class Scanner implements Pausable<VideoFile> {
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

  async execute(rootDir: string): Promise<VideoFile[]> {
    const files = await this.getFileList(rootDir);
    if (files.length === 0) {
      logger.warn('No eligible files found');
      this.state = 'done';
      return [];
    }
    logger.debug(`Found ${files.length} files to process`);

    this.progressBar.start(files.length, 0, { status: statusIcons[this.state] });

    const processedFiles: VideoFile[] = [];

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
        let videoFile = getVideoFileByIno(this.db, fileInfo.inode);
        let needsProbe = false;
        let needsCreate = false;
        let needsUpdate = false;
        if (videoFile) {
          if (videoFile.processed) {
            this.progressBar.update(i + 1, { status: statusIcons[this.state] });
            continue;
          } else if (!videoFile.media_info) {
            needsProbe = true;
          }
          if (videoFile.path !== fileInfo.fileName) {
            videoFile.path = fileInfo.fileName;
            needsUpdate = true;
          }
        } else {
          needsProbe = true;
          needsCreate = true;
          videoFile = {
            ino: fileInfo.inode,
            path: fileInfo.fileName,
            processed: false,
            mtime: fileInfo.mtime,
            size: fileInfo.size,
            media_info: null,
          }
        }

        if (!this.options.force && needsProbe) {
          const mediaInfo = await this.probeFile(fileInfo);
          if (mediaInfo) {
            videoFile.media_info = mediaInfo;
            needsUpdate = true;
          }
        }

        if (needsCreate) {
          insertVideoFile(this.db, videoFile);
        } else if (needsUpdate) {
          updateVideoFile(this.db, videoFile);
        }

        processedFiles.push(videoFile);
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

  private async probeFile (fileInfo: FileInfo) {
    let ffprobePath: string;
    if (this.options.ffmpegPath) {
      ffprobePath = join(dirname(this.options.ffmpegPath), basename(this.options.ffmpegPath).replace('ffmpeg', 'ffprobe'));
    } else {
      ffprobePath = 'ffprobe';
    }

    const ffprobeExecutor = new FFmpegExecutor(ffprobePath);
    const args = stringToArgs('-v error -show_streams -select_streams v:0 -show_entries stream=width,height,codec_name -of json');
    args.push(fileInfo.fileName);

    let stdErrData = '';
    ffprobeExecutor.on('stderr', (data) => {
      stdErrData += data.toString();
    });
    let stdoutData = '';
    ffprobeExecutor.on('stdout', (data) => {
      stdoutData += data.toString();
    });

    try {
      await ffprobeExecutor.execute(args);
    } catch (e) {
      logger.error(`Error probing file: ${fileInfo.fileName}. ${(e as Error).message}`);
      logger.error(`FFprobe stderr: ${stdErrData}`);
      return;
    } finally {
      ffprobeExecutor.removeAllListeners();
    }

    try {
      const mediaInfo = JSON.parse(stdoutData);
      if (!mediaInfo || !mediaInfo.streams || mediaInfo.streams.length === 0) {
        throw new Error('No streams found in the file');
      }
      const videoStream = mediaInfo.streams[0];
      if (!videoStream.codec_name || !videoStream.width || !videoStream.height) {
        throw new Error('Missing required fields in the stream info');
      }
      const result: MediaInfo = {
        codec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
      };

      return result;
    } catch (e) {
      logger.error(`Error parsing FFprobe output for file: ${fileInfo.fileName}. ${(e as Error).message}`);
      return;
    }
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
