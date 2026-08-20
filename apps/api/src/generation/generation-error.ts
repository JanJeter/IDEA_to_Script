export type NonRetryableGenerationFailureKind =
  | 'invalid_output'
  | 'result_persistence'
  | 'agent_run';

/**
 * Marks a generation failure that must not be returned to pg-boss for an
 * automatic retry. The provider may already have charged for a successful
 * response, so another job attempt would risk duplicate cost.
 */
export class NonRetryableGenerationError extends Error {
  readonly retryable = false;

  constructor(
    message: string,
    readonly kind: NonRetryableGenerationFailureKind,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableGenerationError';
  }
}
