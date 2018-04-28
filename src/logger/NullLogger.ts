import { Logger } from 'src/logger/Logger';

/**
 * Logger implementation that consumes input and produces no output.
 */
export class NullLogger implements Logger {
  public debug() {
    /* noop */
  }

  public info() {
    /* noop */
  }

  public warn() {
    /* noop */
  }

  public error() {
    /* noop */
  }
}
