import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Project } from '@prisma/client';
import {
  premiseAgentToolNames,
  StaticProjectMemoryPort,
  type AgentBudget,
  type PremiseAgent,
} from '@idea2screenplay/agent';
import { PREMISE_AGENT_EXECUTOR } from './agent.tokens';

@Injectable()
export class PremiseAgentService {
  constructor(
    private readonly config: ConfigService,
    @Inject(PREMISE_AGENT_EXECUTOR) private readonly agent: PremiseAgent,
  ) {}

  get enabled() {
    if (this.config.get<string>('GENERATION_RUNTIME', 'legacy').toLowerCase() !== 'agent') {
      return false;
    }
    const stages = this.config
      .get<string>('AGENT_ENABLED_STAGES', 'PREMISE')
      .split(',')
      .map((stage) => stage.trim().toUpperCase());
    return stages.includes('PREMISE') && this.agent.available;
  }

  generate(input: {
    project: Project;
    runId: string;
    jobId: string;
    versionId: string;
  }) {
    const memory = new StaticProjectMemoryPort({
      projectId: input.project.id,
      versionId: input.versionId,
      seed: {
        mode: input.project.mode,
        title: input.project.title,
        logline: input.project.logline,
        sourceText: input.project.sourceText,
        genre: input.project.genre,
        tone: input.project.tone,
        language: input.project.language,
        targetMinutes: input.project.targetMinutes,
      },
      canonical: {
        revision: input.versionId,
        confirmedStage: null,
        premise: input.project.premise && input.project.synopsis && input.project.theme
          ? {
              title: input.project.title,
              premise: input.project.premise,
              synopsis: input.project.synopsis,
              theme: input.project.theme,
            }
          : null,
      },
    });
    return this.agent.generate({
      runId: input.runId,
      jobId: input.jobId,
      projectId: input.project.id,
      versionId: input.versionId,
      memory,
      capabilities: {
        projectId: input.project.id,
        versionId: input.versionId,
        stage: 'PREMISE',
        allowedTools: premiseAgentToolNames,
        readableStages: [],
        writableStages: ['PREMISE'],
      },
      budget: this.budget(),
    });
  }

  private budget(): AgentBudget {
    const maxSteps = this.integerConfig('AGENT_PREMISE_MAX_STEPS', 4, 1, 8);
    const legacyTokenBudget = this.integerConfig(
      'AGENT_PREMISE_TOKEN_BUDGET',
      16_000,
      2_048,
      200_000,
    );
    const maxContextTokens = this.integerConfig(
      'AGENT_PREMISE_CONTEXT_TOKEN_BUDGET',
      legacyTokenBudget,
      2_048,
      200_000,
    );
    const maxProviderAttemptsPerStep = this.integerConfig(
      'AGENT_PROVIDER_ATTEMPTS_PER_STEP',
      2,
      1,
      4,
    );
    return {
      maxSteps,
      maxContextTokens,
      maxCumulativeTokens: this.integerConfig(
        'AGENT_PREMISE_CUMULATIVE_TOKEN_BUDGET',
        Math.max(48_000, maxContextTokens * maxSteps),
        maxContextTokens,
        500_000,
      ),
      maxOutputTokensPerStep: this.integerConfig(
        'LLM_MAX_OUTPUT_TOKENS',
        4_096,
        256,
        16_384,
      ),
      maxProviderAttemptsPerStep,
      maxTotalProviderCalls: this.integerConfig(
        'AGENT_MAX_PROVIDER_CALLS',
        maxSteps * maxProviderAttemptsPerStep,
        1,
        30,
      ),
      maxToolCalls: this.integerConfig('AGENT_MAX_TOOL_CALLS', 12, 1, 50),
      maxElapsedMs: this.integerConfig('AGENT_TIMEOUT_MS', 90_000, 1_000, 300_000),
    };
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}
