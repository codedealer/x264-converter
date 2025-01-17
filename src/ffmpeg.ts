import { ChildProcess, spawn, StdioOptions } from 'child_process';
import { EventEmitter } from 'events';

class FFmpegExecutor extends EventEmitter {
  public command: string;
  private ffmpegProcess: ChildProcess | null = null;
  constructor (path?: string) {
    super();
    this.command = path || 'ffmpeg';
  }
  async execute(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdio: StdioOptions = ['ignore', 'pipe', 'pipe'];
      this.ffmpegProcess = spawn(this.command, args, { stdio });
      let duration = 0;

      this.ffmpegProcess.stdout!.on('data', (data) => {
        this.emit('stdout', data.toString());
        this.parseProgress(data.toString(), duration);
      });

      this.ffmpegProcess.stderr!.on('data', (data) => {
        this.emit('stderr', data.toString());
        if (data.toString().includes('Duration:')) {
          const match = data.toString().match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
          if (match) {
            duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
          }
        }
      });

      this.ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else if (code === null) {
          // process was killed
          resolve();
        } else {
          reject(new Error(`ffmpeg process exited with code ${code}`));
        }
      });
    });
  }
  stop(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGINT');
    }
  }
  private parseProgress(data: string, duration: number): void {
    const lines = data.split('\n');
    let percent = 0;
    if (duration < 1) {
      return;
    }
    for (const line of lines) {
      const [key, value] = line.split('=');
      if (key && value && (key.trim() === 'out_time_ms')) {
        const fOutTime = parseFloat(value);
        if (isNaN(fOutTime)) {
          return;
        }
        const outTime = fOutTime / 1000000;
        percent = Math.ceil((outTime / duration) * 100);
        break;
      }
    }
    this.emit('progress', percent);
  }
}

export { FFmpegExecutor };
