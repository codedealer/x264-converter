import { basename, extname } from "path";
import logger from "./logger";
import cliProgress from 'cli-progress';
import {
  ensureDirectoryExists,
  fixVideoStreamDimensions,
  getOutputFileName,
  preserveAttributes,
  stringToArgs,
  trimFileName
} from "./utils";
import { displayPauseMenu } from "./menu";
import { ValidatedOptions } from "./options";
import { FFmpegExecutor } from "./ffmpeg";
import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { existsSync } from "fs";
import { Pausable } from "./pausableTask";
import { updateVideoFile, VideoFile } from "./db";
import PausableTaskResult from "./pausableTaskResult";
import { StopWatch } from "stopwatch-node";
import humanizeDuration from 'humanize-duration';
import Database from "better-sqlite3";

const statusIcons = {
  ['in-progress']: '⌛', // Hourglass
  pause: 'Ⅱ', // Pause
  stop: '■', // Stop
  done: '✓', // Check mark
};

class Encoder implements Pausable<VideoFile> {
  public state: 'in-progress' | 'pause' | 'stop' | 'done';
  public timer: StopWatch;
  private progressBar: cliProgress.SingleBar;
  private ffmpegExecutor: FFmpegExecutor | null = null;

  constructor(public db: Database.Database, public options: ValidatedOptions) {
    this.state = 'in-progress';
    this.timer = new StopWatch();
    this.progressBar = this.makeProgressBar();
  }
  async execute (queue: VideoFile[]): Promise<PausableTaskResult<VideoFile>> {
    const result = new PausableTaskResult<VideoFile>(queue.length);

    if (queue.length === 0) {
      logger.warn('There are no suitable files to process');
      this.state = 'done';
      return result;
    }

    const total = queue.length * 100;

    logger.debug(`Start processing ${queue.length} files`);

    ensureDirectoryExists(this.options.dstDir);

    this.progressBar.start(total, 0, {
      filename: '',
      status: statusIcons[this.state],
      current: 1,
      queue: queue.length,
    });

    this.timer.start();

    for (let i = 0; i < queue.length; i++) {
      if (this.state === 'done' || this.state === 'stop') {
        this.timer.stop();
        break;
      }
      if (this.state === 'pause') {
        this.timer.stop();
        logger.warn('Processing paused');
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
      const file = this.prepareFileName(queue[i].path);

      this.progressBar.update(i * 100, {
        filename: `${file}`,
        status: statusIcons[this.state],
        current: i + 1,
      });

      try {
        await this.processFile(queue[i], i);
        result.success.push(queue[i]);
        // update the record in the database
        queue[i].processed = true;
        updateVideoFile(this.db, queue[i]);
      } catch (e) {
        result.failed.push({ item: queue[i].path, error: e as Error });
        if (this.options.careful) {
          this.progressBar.stop();
          throw e;
        }

        logger.debug(`Error processing file: ${file}. ${(e as Error).message}`);
      }
    }

    if (this.timer.isRunning()) {
      this.timer.stop();
    }
    if (this.state !== 'done' && this.state !== 'stop') {
      this.state = 'done';
    }
    this.progressBar.update({ status: statusIcons[this.state] });
    this.progressBar.stop();
    result.timeElapsed = {
      ms: this.timer.getTotalTime(),
      time: humanizeDuration(this.timer.getTotalTime()),
    }

    return result;
  }
  requestStateChange (state: 'pause' | 'stop'): void {
    if (this.state !== 'in-progress') {
      return;
    }

    this.state = state;
    this.progressBar.update({ status: statusIcons[state] });
  }
  pause (): void {
    this.requestStateChange('pause');
  }
  stop (): void {
    this.requestStateChange('stop');
    if (this.ffmpegExecutor) {
      this.ffmpegExecutor.stop();
    }
  }
  private async processFile (file: VideoFile, fileIndex: number) {
    this.ffmpegExecutor = new FFmpegExecutor(this.options.ffmpegPath);

    let stdErrData = '';
    this.ffmpegExecutor.on('stderr', (data) => {
      stdErrData += data.toString();
    });
    this.ffmpegExecutor.on('progress', (percent: number) => {
      if (percent > 0) {
        this.progressBar.update((fileIndex * 100) + percent);
      }
    });

    const args = stringToArgs(this.options.videoOptions.ffmpegCommand);

    if (file.media_info) {
      if (file.media_info.width % 2 !== 0 || file.media_info.height % 2 !== 0) {
        fixVideoStreamDimensions(args);
      }
    }

    // add video progress
    args.push('-progress', 'pipe:1');

    args.unshift('-i', file.path, '-y');
    const output = getOutputFileName(file.path, this.options)
    args.push(output.output);

    ensureDirectoryExists(output.finalName);

    /*logger.debug(`Calling ffmpeg with arguments:`);
    for (let i = 0; i < args.length; i++) {
      if (i == args.length - 1) {
        logger.debug(`  ${args[i]}`);
        break;
      }
      let str = args[i + 1].startsWith('-') ? args[i] : `${args[i]} ${args[++i]}`;
      logger.debug(`  ${str}`);
    }*/

    const errorLogFile = `${output.finalName}_error.log`;

    try {
      await this.ffmpegExecutor.execute(args);
    } catch(e) {
      this.writeErrorLog(errorLogFile, stdErrData);
      throw e;
    } finally {
      this.ffmpegExecutor.removeAllListeners();
    }

    if (logger.isDebugEnabled()) {
      this.writeErrorLog(errorLogFile, stdErrData);
    }

    this.finalizeFile(file, output.output, output.finalName);
    this.ffmpegExecutor = null;

    // finalize the progress bar just in case
    this.progressBar.update((fileIndex * 100) + 100);
  }
  private finalizeFile (file: VideoFile, output:string, finalName: string) {
    if (this.options.deleteOriginal) {
      logger.debug(`Deleting original file: ${file.path}`);
      unlinkSync(file.path);
    }
    if (output === finalName) {
      if (this.options.preserveAttributes && file.mtime) {
        preserveAttributes(finalName, { atime: file.mtime, mtime: file.mtime });
      }
      return;
    }
    if (existsSync(finalName)) {
      logger.debug(`Deleting existing file: ${finalName}`);
      unlinkSync(finalName);
    }
    logger.debug(`Renaming file: ${basename(output)} -> ${basename(finalName)}`);
    renameSync(output, finalName);
    if (this.options.preserveAttributes && file.mtime) {
      preserveAttributes(finalName, { atime: file.mtime, mtime: file.mtime });
    }
  }
  private writeErrorLog (file: string, data: string) {
    const stream = createWriteStream(file, { flags: 'w' });
    stream.write(data);
    stream.end();
    logger.info(`Error log written to: ${file}`);
  }
  private prepareFileName (file: string): string {
    const extension = extname(file);
    return trimFileName(basename(file).slice(0, -extension.length), 30);
  }
  private makeProgressBar () {
    const progressBar = new cliProgress.SingleBar({
      format: '{filename} |{bar}| {percentage}% | {current}/{queue} | {status} | ETA: {eta_formatted}',
      hideCursor: true,
      clearOnComplete: false,
      fps: 10,
    }, cliProgress.Presets.shades_classic);

    return progressBar;
  }
}

export default Encoder;
