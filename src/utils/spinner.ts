import chalk from 'chalk';
import spinners from 'cli-spinners';

const frames = spinners.dots.frames;

/**
 * Ref-counted terminal spinner.
 *
 * Multiple concurrent callers (e.g. two parallel Engineer nodes) share a
 * single animated line.  The animation stops only when every caller has
 * called stop().
 */
export class Spinner {
  private static refCount = 0;
  private static intervalId: NodeJS.Timeout | null = null;
  private static frameIdx = 0;
  private static text = '';

  static start(text: string): void {
    if (!process.stdout.isTTY) return;

    // Update the label to the latest caller's message.
    Spinner.text = text;
    Spinner.refCount++;

    if (Spinner.intervalId) return; // already animating

    Spinner.frameIdx = 0;
    Spinner.intervalId = setInterval(() => {
      const frame = chalk.hex('#A855F7')(frames[Spinner.frameIdx++ % frames.length]);
      process.stdout.write(`\r${frame} ${chalk.dim(Spinner.text)}`);
    }, 80);
  }

  static stop(): void {
    if (!process.stdout.isTTY) return;

    Spinner.refCount = Math.max(0, Spinner.refCount - 1);
    if (Spinner.refCount > 0) return; // other callers still in flight

    if (Spinner.intervalId) {
      clearInterval(Spinner.intervalId);
      Spinner.intervalId = null;
    }
    process.stdout.write('\r\x1b[K'); // erase the spinner line
  }

  /** Convenience: run fn() while the spinner is active. */
  static async wrap<T>(text: string, fn: () => Promise<T>): Promise<T> {
    Spinner.start(text);
    try {
      return await fn();
    } finally {
      Spinner.stop();
    }
  }
}
