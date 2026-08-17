import type { DialogueLine } from './generation.types';

type FountainProject = {
  title: string;
  genre: string;
  scenes: Array<{
    heading: string;
    action: string;
    dialogue: unknown;
  }>;
};

export function toFountain(project: FountainProject) {
  const output = [
    `Title: ${project.title}`,
    'Credit: Written with Idea2Screenplay',
    `Notes: ${project.genre}`,
    '',
  ];

  for (const scene of project.scenes) {
    output.push(scene.heading.toUpperCase(), '', scene.action, '');
    const lines = Array.isArray(scene.dialogue) ? (scene.dialogue as DialogueLine[]) : [];
    for (const line of lines) {
      output.push(line.character.toUpperCase());
      if (line.parenthetical) output.push(`(${line.parenthetical})`);
      output.push(line.text, '');
    }
  }
  return output.join('\n').trim();
}
