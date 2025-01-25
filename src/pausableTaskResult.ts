class PausableTaskResult<T> {
  public success: T[] = [];
  public skipped: string[] = [];
  public failed: { item: string; error: Error }[] = [];
  public timeElapsed: { ms: number; time: string; } = { ms: 0, time: '0s' };

  constructor (public totalQueueLength: number) { }

  report(): string {
    const skipped = this.skipped.length;
    const failed = this.failed.length;
    const success = this.success.length;
    const totalProcessed = skipped + failed + success;
    let report = `Total: ${this.totalQueueLength}, Processed: ${totalProcessed}, Success: ${success}, Skipped: ${skipped}, Failed: ${failed}\nCompleted in ${this.timeElapsed.time}`;
    if (failed > 0) {
      const failedReport = this.failed.map(({ item, error }) => `Failed: ${item}, Reason: ${error.message}`).join('\n');
      return `${report}\n${failedReport}`;
    }
    return report;
  }
}

export default PausableTaskResult;
