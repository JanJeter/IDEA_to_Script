import type { ModelMessage } from 'ai';
import type {
  AgentModelPort,
  AgentRunContext,
  AgentRunResult,
  AgentTraceSink,
} from '../contracts/agent.types';
import { compactOldToolResults } from '../context/message-compactor';
import { estimateMessageTokens } from '../context/token-estimator';
import { AgentBudgetManager } from '../harness/budget-manager';
import { AgentExecutionError } from '../harness/errors';
import { AgentLoopDetector } from '../harness/loop-detector';
import { abortableDelay, AgentRetryPolicy } from '../harness/retry-policy';
import { noopAgentTraceSink } from '../contracts/agent.types';
import type { AgentToolRegistry } from '../tools/tool-registry';

export interface AgentRuntimeOptions {
  retryPolicy?: AgentRetryPolicy;
  trace?: AgentTraceSink;
}

export class AgentRuntime {
  private readonly retryPolicy: AgentRetryPolicy;
  private readonly trace: AgentTraceSink;

  constructor(
    private readonly model: AgentModelPort,
    options: AgentRuntimeOptions = {},
  ) {
    this.retryPolicy = options.retryPolicy ?? new AgentRetryPolicy();
    this.trace = options.trace ?? noopAgentTraceSink;
  }

  async run(input: {
    context: AgentRunContext;
    system: string;
    user: string;
    registry: AgentToolRegistry;
    hasSubmitted: () => boolean;
    signal?: AbortSignal;
  }): Promise<AgentRunResult> {
    this.assertContext(input.context, input.registry);
    const startedAt = Date.now();
    const budget = new AgentBudgetManager(input.context.budget);
    const loopDetector = new AgentLoopDetector();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Agent run timed out'));
    }, input.context.budget.maxElapsedMs);
    const forwardAbort = () => controller.abort(input.signal?.reason ?? new Error('Agent run cancelled'));
    input.signal?.addEventListener('abort', forwardAbort, { once: true });
    let messages: ModelMessage[] = [{ role: 'user', content: input.user }];
    let completedSteps = 0;

    await this.trace.record({
      type: 'run_started',
      runId: input.context.runId,
      projectId: input.context.projectId,
      stage: input.context.stage,
      model: this.model.modelId,
      skill: `${input.context.skillName}@${input.context.skillVersion}`,
      timestamp: new Date().toISOString(),
    });

    try {
      for (let step = 1; step <= input.context.budget.maxSteps; step += 1) {
        messages = this.fitMessages(input.system, messages, input.registry, budget);
        const result = await this.executeWithRetry({
          context: input.context,
          system: input.system,
          messages,
          registry: input.registry,
          controller,
          budget,
          step,
        });
        completedSteps = step;
        budget.recordStep(result.usage, result.durationMs);
        messages.push(...result.messages);

        for (const call of result.toolCalls) {
          const detection = loopDetector.record(call);
          if (detection.stuck) {
            throw new AgentExecutionError(
              `Agent tool loop detected: ${detection.reason}`,
              'loop_detected',
            );
          }
        }

        await this.trace.record({
          type: 'step_completed',
          runId: input.context.runId,
          step,
          providerCalls: budget.snapshot.providerCalls,
          toolCalls: input.registry.callCount,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: result.durationMs,
          timestamp: new Date().toISOString(),
        });

        if (input.hasSubmitted()) {
          const completed = this.result('submitted', step, input.registry.callCount, budget);
          await this.finishTrace(input.context.runId, completed, startedAt);
          return completed;
        }
        budget.assertContext(result.usage.inputTokens);
        budget.assertCanContinue();
        if (result.toolCalls.length === 0) {
          throw new AgentExecutionError(
            'Agent stopped without submitting a stage draft',
            'step_limit',
          );
        }
      }
      throw new AgentExecutionError('Agent reached its step limit', 'step_limit');
    } catch (error) {
      const normalized = this.normalizeError(error, controller.signal.aborted, timedOut);
      const failed = this.result(normalized.reason, completedSteps, input.registry.callCount, budget);
      await this.finishTrace(input.context.runId, failed, startedAt);
      throw normalized;
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private async executeWithRetry(input: {
    context: AgentRunContext;
    system: string;
    messages: ModelMessage[];
    registry: AgentToolRegistry;
    controller: AbortController;
    budget: AgentBudgetManager;
    step: number;
  }) {
    const maxAttempts = input.context.budget.maxProviderAttemptsPerStep;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      input.budget.beginProviderCall(attempt > 1);
      const mutatingCallsBefore = input.registry.mutatingCallCount;
      try {
        return await this.model.executeStep({
          system: input.system,
          messages: input.messages,
          tools: input.registry.toAiSdkTools(),
          maxOutputTokens: input.context.budget.maxOutputTokensPerStep,
          signal: input.controller.signal,
        });
      } catch (error) {
        if (error instanceof AgentExecutionError) throw error;
        if (input.controller.signal.aborted) throw error;
        if (input.registry.mutatingCallCount > mutatingCallsBefore) {
          throw new AgentExecutionError(
            'Agent model stream failed after a mutating tool call; the outcome will not be replayed',
            'provider_error',
            error,
          );
        }
        const decision = this.retryPolicy.classify(error);
        if (!decision.retry) {
          throw new AgentExecutionError('Agent model request failed', 'provider_error', error);
        }
        if (attempt >= maxAttempts) {
          throw new AgentExecutionError(
            'Agent provider retry budget exhausted',
            'retry_budget_exhausted',
            error,
          );
        }
        const delayMs = this.retryPolicy.delayMs(attempt);
        await this.trace.record({
          type: 'provider_retry',
          runId: input.context.runId,
          step: input.step,
          attempt,
          reason: decision.reason ?? 'unknown',
          delayMs,
          timestamp: new Date().toISOString(),
        });
        await abortableDelay(delayMs, input.controller.signal);
      }
    }
    throw new AgentExecutionError('Agent provider retry budget exhausted', 'retry_budget_exhausted');
  }

  private fitMessages(
    system: string,
    messages: ModelMessage[],
    registry: AgentToolRegistry,
    budget: AgentBudgetManager,
  ) {
    let prepared = messages;
    let estimate = estimateMessageTokens(system, prepared, registry.schemaTokenEstimate);
    if (estimate > budget.limits.maxContextTokens * 0.8) {
      prepared = compactOldToolResults(messages);
      estimate = estimateMessageTokens(system, prepared, registry.schemaTokenEstimate);
    }
    budget.assertContext(estimate);
    return prepared;
  }

  private assertContext(context: AgentRunContext, registry: AgentToolRegistry) {
    if (context.projectId !== context.capabilities.projectId) {
      throw new Error('Agent project capability does not match the run context');
    }
    if (context.versionId !== context.capabilities.versionId) {
      throw new Error('Agent version capability does not match the run context');
    }
    if (context.stage !== context.capabilities.stage) {
      throw new Error('Agent stage capability does not match the run context');
    }
    const allowed = new Set(context.capabilities.allowedTools);
    if (registry.names().some((name) => !allowed.has(name))) {
      throw new Error('Agent registry contains a tool outside the run capability');
    }
    if (
      registry.hasMutatingTools
      && !context.capabilities.writableStages.includes(context.stage)
    ) {
      throw new Error('Agent run has mutating tools without a matching stage write capability');
    }
  }

  private normalizeError(error: unknown, aborted: boolean, timedOut: boolean) {
    if (error instanceof AgentExecutionError) return error;
    if (aborted) {
      return new AgentExecutionError(
        timedOut ? 'Agent stage timed out' : 'Agent stage cancelled',
        timedOut ? 'timeout' : 'cancelled',
        error,
      );
    }
    return new AgentExecutionError('Agent execution failed', 'provider_error', error);
  }

  private result(
    finishReason: AgentRunResult['finishReason'],
    steps: number,
    toolCalls: number,
    budget: AgentBudgetManager,
  ): AgentRunResult {
    return { finishReason, steps, toolCalls, ...budget.snapshot };
  }

  private finishTrace(runId: string, result: AgentRunResult, startedAt: number) {
    return this.trace.record({
      type: 'run_finished',
      runId,
      reason: result.finishReason,
      steps: result.steps,
      providerCalls: result.providerCalls,
      toolCalls: result.toolCalls,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  }
}
