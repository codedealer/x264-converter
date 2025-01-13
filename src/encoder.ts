import { basename } from "path";
import logger from "./logger";
import cliProgress from 'cli-progress';
import { trimFileName } from "./utils";
import { displayPauseMenu } from "./menu";

const statusIcons = {
  ['in-progress']: '⏳', // Hourglass
  pause: '⏸️', // Pause
  stop: '🛑', // Stop
  done: '✅', // Check mark
};

class Encoder {
  public state: 'in-progress' | 'pause' | 'stop' | 'done';
  private progressBar: cliProgress.SingleBar;

  constructor() {
    this.state = 'in-progress';
    this.progressBar = this.makeProgressBar();
  }
  async processQueue (queue: string[]): Promise<void> {
    if (queue.length === 0) {
      logger.warn('There are no suitable files to process');
      this.state = 'done';
      return;
    }

    const total = queue.length;

    logger.debug(`Start processing ${total} files`);

    this.progressBar.start(total, 0, { filename: '', status: statusIcons[this.state] });
    for (let i = 0; i < total; i++) {
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

      this.progressBar.update(i, {
        filename: `${file}`,
        status: statusIcons[this.state],
      });

      // Simulate processing (replace with actual ffmpeg call)
      await new Promise(res => setTimeout(res, 5000));

      this.progressBar.increment();
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
  private prepareFileName (file: string): string {
    return trimFileName(basename(file));
  }
  private makeProgressBar () {
    const progressBar = new cliProgress.SingleBar({
      format: '{filename} Progress |{bar}| {percentage}% | {value}/{total} | {status}',
      hideCursor: true,
      clearOnComplete: true,
    }, cliProgress.Presets.shades_classic);

    return progressBar;
  }
}

export default Encoder;
