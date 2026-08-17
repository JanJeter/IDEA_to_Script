import type { GraphData } from 'react-force-graph-2d';
import type {
  CharacterDraft,
  CharacterRelationship,
  CharacterRelationshipDraft,
} from '../types';

export type GraphCharacter = CharacterDraft & { id?: string };
export type RelationshipInput = CharacterRelationship | CharacterRelationshipDraft;

export type CharacterNode = {
  id: string;
  index: number;
  name: string;
  role: string;
  description: string;
  goal: string;
  conflict: string;
  arc: string;
  voice: string;
  color: string;
  degree: number;
};

export type RelationshipLink = {
  id: string;
  source: string;
  target: string;
  type: string;
  description: string;
  strength: number;
  directed: boolean;
  curvature: number;
};

export type CharacterGraphData = GraphData<CharacterNode, RelationshipLink>;

export type GraphPoint = {
  x: number;
  y: number;
};

const PARALLEL_CURVATURE_STEP = 0.28;

function roleColor(role: string, index: number) {
  const normalized = role.toLowerCase();
  if (normalized.includes('protagonist') || normalized.includes('主角')) return '#d96451';
  if (normalized.includes('antagon') || normalized.includes('对抗') || normalized.includes('反派')) return '#7f8b9a';
  if (normalized.includes('catalyst') || normalized.includes('催化')) return '#d5ad62';
  return ['#6f9c84', '#8e80a4', '#5d91a0', '#b27a69'][index % 4];
}

function isDraftRelationship(
  relationship: RelationshipInput,
): relationship is CharacterRelationshipDraft {
  return 'sourceIndex' in relationship && 'targetIndex' in relationship;
}

function canonicalPair(source: string, target: string) {
  return source <= target
    ? ([source, target] as const)
    : ([target, source] as const);
}

function assignParallelCurvatures(links: RelationshipLink[]) {
  const groups = new Map<string, RelationshipLink[]>();

  links.forEach((link) => {
    const pair = canonicalPair(link.source, link.target);
    const key = JSON.stringify(pair);
    const group = groups.get(key);
    if (group) group.push(link);
    else groups.set(key, [link]);
  });

  groups.forEach((group) => {
    if (group.length === 1) return;

    const [canonicalSource] = canonicalPair(group[0].source, group[0].target);
    group.forEach((link, index) => {
      // Curvature is interpreted relative to source -> target. Flip the API value
      // for reverse links so every offset remains stable in canonical pair space.
      const canonicalOffset = (index - (group.length - 1) / 2) * PARALLEL_CURVATURE_STEP;
      const direction = link.source === canonicalSource ? 1 : -1;
      link.curvature = canonicalOffset === 0 ? 0 : canonicalOffset * direction;
    });
  });
}

export function buildCharacterGraphData(
  characters: GraphCharacter[],
  relationships: RelationshipInput[],
): CharacterGraphData {
  const ids = characters.map((character, index) => character.id ?? `draft-character-${index}`);
  const knownIds = new Set(ids);
  const links: RelationshipLink[] = [];

  relationships.forEach((relationship, index) => {
    const source = isDraftRelationship(relationship)
      ? ids[relationship.sourceIndex]
      : relationship.sourceId;
    const target = isDraftRelationship(relationship)
      ? ids[relationship.targetIndex]
      : relationship.targetId;
    if (!source || !target || source === target || !knownIds.has(source) || !knownIds.has(target)) return;
    links.push({
      id: 'id' in relationship ? relationship.id : `${source}-${target}-${index}`,
      source,
      target,
      type: String(relationship.type ?? ''),
      description: String(relationship.description ?? ''),
      strength: Math.min(5, Math.max(1, Number(relationship.strength) || 1)),
      directed: Boolean(relationship.directed),
      curvature: 0,
    });
  });

  assignParallelCurvatures(links);

  const degree = new Map<string, number>();
  links.forEach((link) => {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  });

  const nodes: CharacterNode[] = characters.map((character, index) => ({
    id: ids[index],
    index,
    name: String(character.name ?? ''),
    role: String(character.role ?? ''),
    description: String(character.description ?? ''),
    goal: String(character.goal ?? ''),
    conflict: String(character.conflict ?? ''),
    arc: String(character.arc ?? ''),
    voice: String(character.voice ?? ''),
    color: roleColor(String(character.role ?? ''), index),
    degree: degree.get(ids[index]) ?? 0,
  }));

  return { nodes, links };
}

export function pointAlongRelationship(
  source: GraphPoint,
  target: GraphPoint,
  curvature: number,
  progress = 0.5,
): GraphPoint {
  const t = Math.min(1, Math.max(0, progress));
  const x = source.x + (target.x - source.x) * t;
  const y = source.y + (target.y - source.y) * t;
  if (!curvature) return { x, y };

  // Mirrors force-graph's quadratic control-point calculation exactly.
  const control = {
    x: (source.x + target.x) / 2 + (target.y - source.y) * curvature,
    y: (source.y + target.y) / 2 - (target.x - source.x) * curvature,
  };
  const inverse = 1 - t;
  return {
    x: inverse * inverse * source.x + 2 * inverse * t * control.x + t * t * target.x,
    y: inverse * inverse * source.y + 2 * inverse * t * control.y + t * t * target.y,
  };
}
