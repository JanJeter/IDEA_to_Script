// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { CharacterDraft, CharacterRelationshipDraft } from '../types';
import {
  buildCharacterGraphData,
  pointAlongRelationship,
} from './CharacterGraph.data';

function character(name: string): CharacterDraft {
  return {
    name,
    role: '主角',
    description: `${name}的人物简介`,
    goal: '完成目标',
    conflict: '面对阻力',
    arc: '获得成长',
    voice: '克制',
  };
}

function relationship(
  sourceIndex: number,
  targetIndex: number,
  type: string,
): CharacterRelationshipDraft {
  return {
    sourceIndex,
    targetIndex,
    type,
    description: `${type}的关系说明`,
    strength: 3,
    directed: true,
  };
}

describe('buildCharacterGraphData', () => {
  it('keeps a lone relationship straight', () => {
    const data = buildCharacterGraphData(
      [character('阿岚'), character('程野')],
      [relationship(0, 1, '盟友')],
    );

    expect(data.links).toHaveLength(1);
    expect(data.links[0].curvature).toBe(0);
    expect(data.nodes.map((node) => node.degree)).toEqual([1, 1]);
  });

  it('fans same-direction parallel relationships out symmetrically', () => {
    const data = buildCharacterGraphData(
      [character('阿岚'), character('程野')],
      [
        relationship(0, 1, '盟友'),
        relationship(0, 1, '竞争'),
        relationship(0, 1, '亏欠'),
      ],
    );

    expect(data.links.map((link) => link.curvature)).toEqual([-0.28, 0, 0.28]);
  });

  it('keeps opposite-direction links on different geometric curves', () => {
    const data = buildCharacterGraphData(
      [character('阿岚'), character('程野')],
      [relationship(0, 1, '追随'), relationship(1, 0, '防备')],
    );
    const [forward, reverse] = data.links;

    // Both API values share a sign because force-graph interprets curvature
    // relative to each link's own source -> target direction.
    expect(forward.curvature).toBeCloseTo(-0.14);
    expect(reverse.curvature).toBeCloseTo(-0.14);

    const forwardLabel = pointAlongRelationship(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      forward.curvature,
    );
    const reverseLabel = pointAlongRelationship(
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      reverse.curvature,
    );
    expect(forwardLabel.y).toBeGreaterThan(0);
    expect(reverseLabel.y).toBeLessThan(0);
  });

  it('drops invalid endpoints before grouping parallel relationships', () => {
    const data = buildCharacterGraphData(
      [character('阿岚'), character('程野')],
      [
        relationship(0, 1, '盟友'),
        relationship(0, 4, '不存在'),
        relationship(1, 1, '自我关系'),
      ],
    );

    expect(data.links).toHaveLength(1);
    expect(data.links[0]).toMatchObject({ type: '盟友', curvature: 0 });
  });
});

describe('pointAlongRelationship', () => {
  it('uses the matching quadratic Bezier midpoint for curved labels', () => {
    const point = pointAlongRelationship(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      0.28,
    );
    expect(point.x).toBeCloseTo(50);
    expect(point.y).toBeCloseTo(-14);
  });

  it('uses ordinary interpolation for straight links', () => {
    expect(pointAlongRelationship(
      { x: 10, y: 20 },
      { x: 30, y: 60 },
      0,
      0.25,
    )).toEqual({ x: 15, y: 30 });
  });
});
