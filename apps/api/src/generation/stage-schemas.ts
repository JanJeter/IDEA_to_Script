import { z } from 'zod';
import { UnprocessableEntityException } from '@nestjs/common';

const text = (max: number) => z.string().trim().min(1).max(max);
const character = z.object({
  name: text(120), role: text(120), age: z.string().trim().max(40).optional(),
  description: text(2_000), goal: text(1_000), conflict: text(1_000), arc: text(1_000), voice: text(1_000),
}).strict();
const relationship = z.object({
  sourceIndex: z.number().int().nonnegative(), targetIndex: z.number().int().nonnegative(),
  type: text(120), description: text(1_000), strength: z.number().int().min(1).max(5), directed: z.boolean(),
}).strict();
const location = z.object({ name: text(160), description: text(2_000), atmosphere: text(1_000), recurringElements: text(1_000) }).strict();
const beat = z.object({ act: z.number().int().min(1).max(3), sequence: z.number().int().positive(), title: text(160), summary: text(2_000), emotionalShift: text(500) }).strict();
const scene = z.object({ sceneNumber: z.number().int().positive(), beatSequence: z.number().int().positive(), heading: text(240), location: text(160), timeOfDay: text(80), summary: text(2_000), estimatedSeconds: z.number().int().min(15).max(3600) }).strict();
const dialogue = z.object({ character: text(120), parenthetical: z.string().trim().max(300).optional(), text: text(2_000) }).strict();
const writtenScene = z.object({ sceneNumber: z.number().int().positive(), action: text(4_000), dialogue: z.array(dialogue).min(1).max(50) }).strict();

export const stageSchemas = {
  PREMISE: z.object({ title: text(120), premise: text(2_000), synopsis: text(8_000), theme: text(1_000) }).strict(),
  CHARACTERS: z.object({ characters: z.array(character).min(2).max(20), relationships: z.array(relationship).min(2).max(100) }).strict(),
  LOCATIONS: z.object({ locations: z.array(location).min(1).max(50) }).strict(),
  BEATS: z.object({ beats: z.array(beat).min(1).max(100) }).strict(),
  SCENES: z.object({ scenes: z.array(scene).min(1).max(200) }).strict(),
  SCRIPT: z.object({ writtenScenes: z.array(writtenScene).min(1).max(200), scriptText: text(500_000) }).strict(),
} as const;

export function parseStagePayload(stage: keyof typeof stageSchemas, value: unknown) {
  const result = stageSchemas[stage].safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new UnprocessableEntityException(`阶段 ${stage} 数据契约无效：${issue.path.join('.')} ${issue.message}`);
  }
  return result.data;
}
