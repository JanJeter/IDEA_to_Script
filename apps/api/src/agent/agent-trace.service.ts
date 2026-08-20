import { Injectable, Logger } from '@nestjs/common';
import {
  redactTraceValue,
  type AgentTraceEvent,
  type AgentTraceSink,
} from '@idea2screenplay/agent';

@Injectable()
export class AgentTraceService implements AgentTraceSink {
  private readonly logger = new Logger('AgentRuntime');

  record(event: AgentTraceEvent) {
    // Events contain metadata only: prompts, source text, credentials, tool
    // inputs and tool outputs never cross this production trace boundary.
    const safeEvent = JSON.stringify(redactTraceValue(event));
    if (event.type === 'provider_retry') {
      this.logger.warn(safeEvent);
      return;
    }
    this.logger.debug(safeEvent);
  }
}
