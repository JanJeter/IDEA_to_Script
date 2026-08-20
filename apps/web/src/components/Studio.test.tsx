import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../types';
import { Studio } from './Studio';

vi.mock('./CharacterGraph', () => ({
  default: ({ relationships }: { relationships: unknown[] }) => (
    <div data-testid="character-graph">{relationships.length} 条关系</div>
  ),
}));

const project: Project = {
  id: 'project-1',
  title: '零点十七分',
  logline: '一名维修工收到来自过去的求救广播。',
  genre: '悬疑科幻',
  tone: '克制',
  language: 'zh-CN',
  targetMinutes: 8,
  status: 'DRAFT',
  currentStage: 'IDEA',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  characters: [],
  locations: [],
  beats: [],
  scenes: [],
  draft: null,
};

describe('Studio', () => {
  it('renders the story seed and generation entry point', () => {
    render(
      <Studio
        project={project}
        generating={false}
        progress={0}
        events={[]}
        onGenerate={() => undefined}
        onGenerateStage={async () => undefined}
        onConfirmStage={async () => undefined}
        onSaveStage={async () => undefined}
        onSaveScene={async () => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: '零点十七分' })).toBeInTheDocument();
    expect(screen.getByText('先生成故事内核')).toBeInTheDocument();
  });

  it('saves the reviewed stage before confirming the next generation', async () => {
    const onSaveStage = vi.fn().mockResolvedValue(undefined);
    const onConfirmStage = vi.fn().mockResolvedValue(undefined);
    render(
      <Studio
        project={{
          ...project,
          status: 'REVIEWING',
          currentStage: 'PREMISE',
          draft: {
            id: 'version-1',
            currentStage: 'PREMISE',
            confirmedStage: null,
            title: '零点十七分',
            premise: '旧故事前提',
            synopsis: '一段完整的故事梗概。',
            theme: '面对沉默。',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }}
        generating={false}
        progress={16}
        events={[]}
        onGenerate={() => undefined}
        onGenerateStage={async () => undefined}
        onConfirmStage={onConfirmStage}
        onSaveStage={onSaveStage}
        onSaveScene={async () => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('故事前提'), { target: { value: '修改后的故事前提' } });
    fireEvent.click(screen.getByRole('button', { name: '确认并生成人物' }));

    await waitFor(() => expect(onSaveStage).toHaveBeenCalledWith(
      'PREMISE',
      expect.objectContaining({ premise: '修改后的故事前提' }),
    ));
    expect(onConfirmStage).toHaveBeenCalledWith('PREMISE');
  });

  it('opens the generated relationship graph from the character stage', async () => {
    const { container } = render(
      <Studio
        project={{
          ...project,
          status: 'READY',
          currentStage: 'COMPLETE',
          characters: [
            { id: 'c1', name: '林夏', role: '主角', description: '导演', goal: '拍完', conflict: '旧友', arc: '和解', voice: '直接' },
            { id: 'c2', name: '周澄', role: '对手', description: '旧友', goal: '守住影院', conflict: '拆迁', arc: '放手', voice: '克制' },
          ],
          relationships: [
            { id: 'r1', sourceId: 'c1', targetId: 'c2', type: '旧友', description: '因影院重逢。', strength: 4, directed: false },
          ],
        }}
        generating={false}
        progress={100}
        events={[]}
        onGenerate={() => undefined}
        onGenerateStage={async () => undefined}
        onConfirmStage={async () => undefined}
        onSaveStage={async () => undefined}
        onSaveScene={async () => undefined}
      />,
    );

    fireEvent.click(within(container).getAllByRole('button', { name: /人物档案/ })[0]);
    fireEvent.click(within(container).getByRole('button', { name: '关系图谱' }));

    expect(await within(container).findByTestId('character-graph')).toHaveTextContent('1 条关系');
  });

  it('previews and preserves relationships while reviewing generated characters', async () => {
    const onSaveStage = vi.fn().mockResolvedValue(undefined);
    const relationship = {
      sourceIndex: 0,
      targetIndex: 1,
      type: '旧友',
      description: '因影院重逢。',
      strength: 4,
      directed: false,
    };
    const { container } = render(
      <Studio
        project={{
          ...project,
          status: 'REVIEWING',
          currentStage: 'CHARACTERS',
          draft: {
            id: 'version-2',
            currentStage: 'CHARACTERS',
            confirmedStage: 'PREMISE',
            characters: [
              { name: '林夏', role: '主角', description: '导演', goal: '拍完', conflict: '旧友', arc: '和解', voice: '直接' },
              { name: '周澄', role: '对手', description: '旧友', goal: '守住影院', conflict: '拆迁', arc: '放手', voice: '克制' },
            ],
            relationships: [relationship],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }}
        generating={false}
        progress={31}
        events={[]}
        onGenerate={() => undefined}
        onGenerateStage={async () => undefined}
        onConfirmStage={async () => undefined}
        onSaveStage={onSaveStage}
        onSaveScene={async () => undefined}
      />,
    );

    fireEvent.click(within(container).getByRole('button', { name: '关系图谱' }));
    expect(await within(container).findByTestId('character-graph')).toHaveTextContent('1 条关系');

    fireEvent.click(within(container).getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onSaveStage).toHaveBeenCalledWith(
      'CHARACTERS',
      expect.objectContaining({ relationships: [relationship] }),
    ));
  });
});
