/**
 * Options for configuring the retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Delay between retries in milliseconds */
  delayMs?: number;
  /** Whether to use exponential backoff for delays (doubles delay each retry) */
  useExponentialBackoff?: boolean;
  /** Function to call on each retry attempt */
  onRetry?: (error: any, attempt: number) => void;
}

/**
 * Executes an async function and retries it up to N times until it succeeds
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Promise with the result of the function
 * @throws The last error encountered if all retry attempts fail
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, useExponentialBackoff = false, onRetry } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        if (onRetry) {
          onRetry(error, attempt);
        }

        const currentDelay = useExponentialBackoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;

        await new Promise((resolve) => setTimeout(resolve, currentDelay));
      }
    }
  }

  throw lastError;
}
