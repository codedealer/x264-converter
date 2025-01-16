import readline from 'readline';

class KeypressListener {
  private callbacks: { [key: string]: () => void } = {};

  constructor() {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.on('keypress', this.handleKeypress);
  }

  private handleKeypress = (_: string, key: readline.Key) => {
    if (key.sequence && this.callbacks[key.sequence]) {
      this.callbacks[key.sequence]();
    }
  };

  on(key: string, callback: () => void) {
    this.callbacks[key] = callback;
  }

  removeAllListeners() {
    this.callbacks = {};
    process.stdin.removeListener('keypress', this.handleKeypress);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  [Symbol.dispose]() {
    this.removeAllListeners();
  }
}

export default KeypressListener;
