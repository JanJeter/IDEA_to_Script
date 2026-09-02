import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentRuntime,
  FileAgentSkillLoader,
  OpenAICompatibleAgentModel,
  PremiseAgent,
} from '@idea2screenplay/agent';
import { resolveGenerationMode } from '../generation/generation-mode';
import { AgentTraceService } from './agent-trace.service';
import { PREMISE_AGENT_EXECUTOR } from './agent.tokens';
import { PremiseAgentService } from './premise-agent.service';

@Module({
  providers: [
    AgentTraceService,
    {
      provide: PREMISE_AGENT_EXECUTOR,
      inject: [ConfigService, AgentTraceService],
      useFactory: (config: ConfigService, trace: AgentTraceService) => {
        const configuredThinkingMode = config
          .get<string>('LLM_THINKING_MODE', '')
          .trim()
          .toLowerCase();
        const thinkingMode = configuredThinkingMode === 'enabled'
          || configuredThinkingMode === 'disabled'
          ? configuredThinkingMode
          : undefined;
        const model = new OpenAICompatibleAgentModel({
          apiKey: config.get<string>('LLM_API_KEY'),
          baseUrl: config.get<string>('LLM_BASE_URL', 'https://api.openai.com/v1'),
          model: config.get<string>('LLM_MODEL', 'gpt-4.1-mini'),
          enabled: resolveGenerationMode(config) === 'llm',
          thinkingMode,
        });
        return new PremiseAgent(
          model,
          new AgentRuntime(model, { trace }),
          new FileAgentSkillLoader(),
        );
      },
    },
    PremiseAgentService,
  ],
  exports: [PremiseAgentService],
})
export class AgentModule {}
