import KeypressListener from "./keypressListener";
import logger from "./logger";
import PausableTaskResult from "./pausableTaskResult";
import { StopWatch } from "stopwatch-node";

export interface Pausable<T> {
  timer: StopWatch;
  pause(): void;
  stop(): void;
  execute(...args: unknown[]): Promise<PausableTaskResult<T>>;
}

class PausableTask<T = void> {
  private pausable: Pausable<T>;

  constructor(pausable: Pausable<T>) {
    this.pausable = pausable;
  }

  async runTask(...args: unknown[]): Promise<PausableTaskResult<T>> {
    if (process.stdin.isPaused()) {
      process.stdin.resume();
      logger.debug('Resuming stdin stream');
    }

    const listener = new KeypressListener();
    listener.on('p', () => this.pausable.pause());
    listener.on('q', () => this.pausable.stop());
    logger.info('Press "p" to pause, "q" to stop');

    try {
      return await this.pausable.execute(...args);
    } finally {
      listener.removeAllListeners();
      if (this.pausable.timer.isRunning()) {
        this.pausable.timer.stop();
      }
    }
  }
}

export { PausableTask };
