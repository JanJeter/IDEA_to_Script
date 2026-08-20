import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentSkill {
  name: string;
  version: string;
  description: string;
  instructions: string;
}

export interface AgentSkillPort {
  load(name: string): AgentSkill;
}

export class FileAgentSkillLoader implements AgentSkillPort {
  private readonly cache = new Map<string, AgentSkill>();

  constructor(private readonly skillRoot = __dirname) {}

  load(name: string): AgentSkill {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid skill name: ${name}`);
    const cached = this.cache.get(name);
    if (cached) return cached;
    const skill = this.parse(name, readFileSync(join(this.skillRoot, name, 'SKILL.md'), 'utf8'));
    this.cache.set(name, skill);
    return skill;
  }

  private parse(name: string, raw: string): AgentSkill {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`Skill ${name} is missing frontmatter`);
    const metadata = Object.fromEntries(
      match[1]
        .split(/\r?\n/)
        .map((line) => line.split(/:(.*)/s).slice(0, 2).map((part) => part.trim()))
        .filter(([key, value]) => key && value),
    );
    if (!metadata.version || !metadata.description) {
      throw new Error(`Skill ${name} requires version and description`);
    }
    return {
      name,
      version: metadata.version,
      description: metadata.description,
      instructions: match[2].trim(),
    };
  }
}
