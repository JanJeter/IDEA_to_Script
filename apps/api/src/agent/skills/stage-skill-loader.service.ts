import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';

export interface StageSkill {
  name: string;
  version: string;
  description: string;
  instructions: string;
}

@Injectable()
export class StageSkillLoaderService {
  private readonly cache = new Map<string, StageSkill>();

  load(name: string): StageSkill {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid skill name: ${name}`);
    const cached = this.cache.get(name);
    if (cached) return cached;

    const raw = readFileSync(join(__dirname, name, 'SKILL.md'), 'utf8');
    const skill = this.parse(name, raw);
    this.cache.set(name, skill);
    return skill;
  }

  private parse(name: string, raw: string): StageSkill {
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
