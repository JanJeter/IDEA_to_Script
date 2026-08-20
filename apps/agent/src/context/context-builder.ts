import { estimateTextTokens } from './token-estimator';
import { AgentExecutionError } from '../harness/errors';

interface ContextSection {
  name: string;
  content: string;
  required: boolean;
  priority: number;
}

export class AgentContextBuilder {
  private readonly sections: ContextSection[] = [];

  required(name: string, content: string, priority = 100) {
    this.sections.push({ name, content, required: true, priority });
    return this;
  }

  optional(name: string, content: string | undefined | null, priority = 0) {
    if (content?.trim()) this.sections.push({ name, content, required: false, priority });
    return this;
  }

  build(maxTokens: number) {
    const required = this.sections.filter((section) => section.required);
    const optional = this.sections
      .filter((section) => !section.required)
      .sort((left, right) => right.priority - left.priority);
    const selected = [...required];
    let tokens = estimateTextTokens(this.render(selected));
    if (tokens > maxTokens) {
      throw new AgentExecutionError(
        `Required Agent context needs ${tokens} tokens but budget is ${maxTokens}`,
        'context_limit',
      );
    }
    for (const section of optional) {
      const candidate = [...selected, section];
      const candidateTokens = estimateTextTokens(this.render(candidate));
      if (candidateTokens <= maxTokens) {
        selected.push(section);
        tokens = candidateTokens;
      }
    }
    return {
      text: this.render(selected),
      estimatedTokens: tokens,
      includedSections: selected.map((section) => section.name),
      omittedSections: this.sections
        .filter((section) => !selected.includes(section))
        .map((section) => section.name),
    };
  }

  private render(sections: ContextSection[]) {
    return sections
      .sort((left, right) => right.priority - left.priority)
      .map((section) => `<context name="${section.name}">\n${section.content}\n</context>`)
      .join('\n\n');
  }
}
