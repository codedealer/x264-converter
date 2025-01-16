import KeypressListener from "./keypressListener";
import logger from "./logger";

export interface Pausable {
  pause(): void;
  stop(): void;
  execute(...args: unknown[]): Promise<void>;
}

class PausableTask {
  private pausable: Pausable;

  constructor(pausable: Pausable) {
    this.pausable = pausable;
  }

  async runTask(...args: unknown[]): Promise<void> {
    if (process.stdin.isPaused()) {
      process.stdin.resume();
      logger.debug('Resuming stdin stream');
    }

    const listener = new KeypressListener();
    listener.on('p', () => this.pausable.pause());
    listener.on('q', () => this.pausable.stop());
    logger.info('Press "p" to pause, "q" to stop');

    try {
      await this.pausable.execute(...args);
    } finally {
      listener.removeAllListeners();
    }
  }
}

export { PausableTask };
