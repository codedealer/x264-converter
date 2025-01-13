import { spawn } from 'child_process';
import { EventEmitter } from 'events';

class FFmpegExecutor extends EventEmitter {
  public command: string;
  constructor (path?: string) {
    super();
    this.command = path || 'ffmpeg';
  }
  async execute(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.command, args);

      ffmpeg.stdout.on('data', (data) => {
        this.emit('stdout', data.toString());
      });

      ffmpeg.stderr.on('data', (data) => {
        this.emit('stderr', data.toString());
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg process exited with code ${code}`));
        }
      });
    });
  }
}

export { FFmpegExecutor };
