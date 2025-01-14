import { basename, extname } from "path";
import logger from "./logger";
import cliProgress from 'cli-progress';
import { fixVideoStreamDimensions, getOutputFileName, stringToArgs, trimFileName } from "./utils";
import { displayPauseMenu } from "./menu";
import { ValidatedOptions } from "./options";
import { FFmpegExecutor } from "./ffmpeg";
import { createWriteStream, renameSync } from "node:fs";

const statusIcons = {
  ['in-progress']: '⏳', // Hourglass
  pause: '⏸️', // Pause
  stop: '🛑', // Stop
  done: '✅', // Check mark
};

class Encoder {
  public state: 'in-progress' | 'pause' | 'stop' | 'done';
  public options: ValidatedOptions;
  private progressBar: cliProgress.SingleBar;

  constructor(options: ValidatedOptions) {
    this.state = 'in-progress';
    this.options = options;
    this.progressBar = this.makeProgressBar();
  }
  async processQueue (queue: string[]): Promise<void> {
    if (queue.length === 0) {
      logger.warn('There are no suitable files to process');
      this.state = 'done';
      return;
    }

    const total = queue.length * 100;

    logger.debug(`Start processing ${queue.length} files`);

    this.progressBar.start(total, 0, {
      filename: '',
      status: statusIcons[this.state],
      current: 1,
      queue: queue.length,
    });
    for (let i = 0; i < queue.length; i++) {
      if (this.state === 'done' || this.state === 'stop') {
        break;
      }
      if (this.state === 'pause') {
        logger.warn('Processing paused');
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
      const file = this.prepareFileName(queue[i]);

      this.progressBar.update(i * 100, {
        filename: `${file}`,
        status: statusIcons[this.state],
        current: i + 1,
      });

      await this.processFile(queue[i], i);
    }

    this.progressBar.stop();
    if (this.state !== 'done' && this.state !== 'stop') {
      this.state = 'done';
    }
  }
  requestStateChange (state: 'pause' | 'stop'): void {
    if (this.state !== 'in-progress') {
      return;
    }

    this.state = state;
    this.progressBar.update({ status: statusIcons[state] });
  }
  private async processFile (file: string, fileIndex: number) {
    const ffmpegExecutor = new FFmpegExecutor(this.options.ffmpegPath);

    let stdErrData = '';
    ffmpegExecutor.on('stderr', (data) => {
      stdErrData += data.toString();
    });
    ffmpegExecutor.on('progress', (percent: number) => {
      if (percent > 0) {
        this.progressBar.update((fileIndex * 100) + percent);
      }
    });

    const args = stringToArgs(this.options.videoOptions.ffmpegCommand);

    fixVideoStreamDimensions(args);
    // add video progress
    args.push('-progress', 'pipe:1');

    args.unshift('-i', file, '-y');
    const output = getOutputFileName(file, this.options)
    args.push(output.output);

    logger.debug(`Calling ffmpeg with arguments:`);
    for (let i = 0; i < args.length; i++) {
      if (i == args.length - 1) {
        logger.debug(`  ${args[i]}`);
        break;
      }
      let str = args[i + 1].startsWith('-') ? args[i] : `${args[i]} ${args[++i]}`;
      logger.debug(`  ${str}`);
    }

    const errorLogFile = `${output.finalName}_error.log`;

    try {
      await ffmpegExecutor.execute(args);
    } catch(e) {
      this.writeErrorLog(errorLogFile, stdErrData);
      throw e;
    } finally {
      ffmpegExecutor.removeAllListeners();
    }

    if (logger.isDebugEnabled()) {
      this.writeErrorLog(errorLogFile, stdErrData);
    }

    if (output.output !== output.finalName) {
      // rename the file
      logger.debug(`Renaming file: ${output.output} -> ${output.finalName}`);
      renameSync(output.output, output.finalName);
    }

    // finalize the progress bar just in case
    this.progressBar.update((fileIndex * 100) + 100);
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
      format: '{filename} |{bar}| {percentage}% | {current}/{queue} | {status}',
      hideCursor: true,
      clearOnComplete: true,
      fps: 10,
    }, cliProgress.Presets.shades_classic);

    return progressBar;
  }
}

export default Encoder;
