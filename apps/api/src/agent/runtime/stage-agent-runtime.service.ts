import { Injectable } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import type {
  StageAgentResult,
  StageAgentRunContext,
} from '../contracts/stage-agent.types';
import { RunToolRegistry } from '../tools/run-tool.registry';
import { AgentModelService } from './agent-model.service';

export class StageAgentExecutionError extends Error {
  constructor(
    message: string,
    readonly reason: StageAgentResult['finishReason'],
  ) {
    super(message);
  }
}

@Injectable()
export class StageAgentRuntimeService {
  constructor(private readonly model: AgentModelService) {}

  async run(input: {
    context: StageAgentRunContext;
    system: string;
    user: string;
    registry: RunToolRegistry;
    hasSubmitted: () => boolean;
  }): Promise<StageAgentResult> {
    this.assertContext(input.context, input.registry);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.context.timeoutMs);
    const messages: ModelMessage[] = [{ role: 'user', content: input.user }];
    const repeatedCalls = new Map<string, number>();
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      for (let step = 1; step <= input.context.maxSteps; step += 1) {
        let result;
        try {
          result = await this.model.executeStep({
            system: input.system,
            messages,
            tools: input.registry.toAiSdkTools(),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new StageAgentExecutionError('Agent stage timed out', 'timeout');
          }
          throw error;
        }

        promptTokens += result.usage.inputTokens;
        completionTokens += result.usage.outputTokens;
        messages.push(...result.messages);

        for (const call of result.toolCalls) {
          const signature = `${call.name}:${JSON.stringify(call.input)}`;
          const count = (repeatedCalls.get(signature) ?? 0) + 1;
          repeatedCalls.set(signature, count);
          if (count >= 3) {
            throw new StageAgentExecutionError(
              `Agent repeated the same tool call three times: ${call.name}`,
              'loop_detected',
            );
          }
        }

        const totalTokens = promptTokens + completionTokens;
        if (totalTokens > input.context.tokenBudget) {
          throw new StageAgentExecutionError('Agent token budget exhausted', 'token_limit');
        }
        if (input.hasSubmitted()) {
          return {
            finishReason: 'submitted',
            steps: step,
            toolCalls: input.registry.callCount,
            promptTokens,
            completionTokens,
          };
        }
        if (result.toolCalls.length === 0) {
          throw new StageAgentExecutionError(
            'Agent stopped without submitting a stage draft',
            'step_limit',
          );
        }
      }

      throw new StageAgentExecutionError('Agent reached its step limit', 'step_limit');
    } finally {
      clearTimeout(timer);
    }
  }

  private assertContext(context: StageAgentRunContext, registry: RunToolRegistry) {
    if (context.maxSteps < 1 || context.maxSteps > 10) {
      throw new Error('Agent maxSteps must be between 1 and 10');
    }
    if (context.tokenBudget < 256 || context.tokenBudget > 100_000) {
      throw new Error('Agent tokenBudget must be between 256 and 100000');
    }
    if (context.timeoutMs < 1_000 || context.timeoutMs > 300_000) {
      throw new Error('Agent timeoutMs must be between 1000 and 300000');
    }
    const registered = registry.names();
    if (registered.some((name) => !context.allowedTools.includes(name))) {
      throw new Error('Agent registry contains a tool outside the run allow-list');
    }
  }
}

