import fg from 'fast-glob';
import { ValidatedOptions } from './options';
import { Pausable } from './pausableTask';
import cliProgress from 'cli-progress';
import logger from './logger';
import { basename, dirname, extname, join, sep } from "path";
import { displayPauseMenu } from "./menu";
import { existsSync, statSync } from "fs";
import FileInfo, { MediaInfo } from "./fileInfo";
import Database from "better-sqlite3";
import { getVideoFileByIno, insertVideoFile, updateVideoFile, VideoFile } from "./db";
import { FFmpegExecutor } from "./ffmpeg";
import { stringToArgs } from "./utils";
import { isMatch } from "micromatch";
import PausableTaskResult from "./pausableTaskResult";
import { StopWatch } from "stopwatch-node";
import humanizeDuration from 'humanize-duration';

const statusIcons = {
  ['in-progress']: '>', // Hourglass
  pause: 'II', // Pause
  stop: '[]', // Stop
  done: 'O', // Check mark
};

class Scanner implements Pausable<VideoFile> {
  public state: 'in-progress' | 'pause' | 'stop' | 'done';
  public options: ValidatedOptions;
  public db: Database.Database;
  public timer: StopWatch;
  private progressBar: cliProgress.SingleBar;

  constructor(db: Database.Database, options: ValidatedOptions) {
    this.state = 'in-progress';
    this.options = options;
    this.db = db;
    this.timer = new StopWatch();
    this.progressBar = this.makeProgressBar();
  }

  pause(): void {
    this.requestStateChange('pause');
  }

  stop(): void {
    this.requestStateChange('stop');
  }

  async execute(rootDir: string): Promise<PausableTaskResult<VideoFile>> {
    const files = await this.getFileList(rootDir);
    const result = new PausableTaskResult<VideoFile>(files.length);
    if (files.length === 0) {
      logger.warn('No eligible files found');
      this.state = 'done';
      return result;
    }
    logger.debug(`Found ${files.length} files to process`);

    this.progressBar.start(files.length, 0, { status: statusIcons[this.state] });

    this.timer.start();

    for (let i = 0; i < files.length; i++) {
      if (this.state === 'done' || this.state === 'stop') {
        this.timer.stop();
        break;
      }
      if (this.state === 'pause') {
        this.timer.stop();
        logger.warn('Scanning paused');
        const action = await displayPauseMenu();
        if (action === 'stop') {
          logger.warn('Processing stopped');
          this.state = 'stop';
          break;
        } else if (process.stdin.isPaused()) {
          // this is just in case inquirer pauses stdin
          process.stdin.resume();
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          logger.debug('Resuming stdin stream');
        }

        this.state = 'in-progress';
        this.timer.start();
      }

      try {
        const videoFile = await this.scanFile(files[i]);

        if (videoFile) {
          result.success.push(videoFile);
        } else {
          result.skipped.push(files[i]);
        }
      } catch (e) {
        result.failed.push({ item: files[i], error: e as Error });

        if (this.options.careful) {
          this.progressBar.stop();
          throw e;
        }

        logger.debug(`Error processing file: ${files[i]}. ${(e as Error).message}`);
      }

      this.progressBar.update(i + 1, { status: statusIcons[this.state] });
    }

    if (this.timer.isRunning()) {
      this.timer.stop();
    }
    this.state = 'done';
    this.progressBar.update({ status: statusIcons[this.state] });
    this.progressBar.stop();
    result.timeElapsed = {
      ms: this.timer.getTotalTime(),
      time: humanizeDuration(this.timer.getTotalTime()),
    }

    return result;
  }

  /**
   * Scan a single file
   * Returns VideoFile if the file needs to be processed, null otherwise
   * @param file
   * @private
   */
  private async scanFile (file: string): Promise<VideoFile | null> {
    const fileInfo = this.readFileInfo(file);

    if (this.options.filterBy?.extension) {
      const extension = extname(fileInfo.fileName).slice(1);
      if (!isMatch(extension, this.options.filterBy.extension)) {
        return null;
      }
    }

    let videoFile = getVideoFileByIno(this.db, fileInfo.inode);
    let needsProbe = false;
    let needsCreate = false;
    let needsUpdate = false;
    if (videoFile) {
      if (videoFile.processed) {
        return null;
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

    if (!this.options.skipProbe && needsProbe) {
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

    if (
      videoFile.media_info &&
      this.options.filterBy?.codec &&
      !isMatch(videoFile.media_info.codec, this.options.filterBy.codec)) {
      return null;
    }

    return videoFile;
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
      format: '{status} |{bar}| {percentage}% | {value}/{total} files | ETA: {eta_formatted}',
      hideCursor: true,
      clearOnComplete: false,
      fps: 10,
    }, cliProgress.Presets.shades_classic);
  }
}

export default Scanner;
