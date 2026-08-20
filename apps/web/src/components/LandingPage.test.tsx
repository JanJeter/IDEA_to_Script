import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentProps } from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectInput } from '../types';
import { LandingPage } from './LandingPage';

const landingCss = readFileSync(resolve('src/components/LandingPage.css'), 'utf8');

function renderLanding(overrides: Partial<ComponentProps<typeof LandingPage>> = {}) {
  const onCreate = vi.fn(async (input: CreateProjectInput) => {
    void input;
  });
  const onOpenSample = vi.fn();
  const onOpenTrends = vi.fn();
  const props: ComponentProps<typeof LandingPage> = {
    onCreate,
    onOpenSample,
    onOpenTrends,
    ...overrides,
  };

  return { ...render(<LandingPage {...props} />), onCreate, onOpenSample, onOpenTrends };
}

function enterOriginalSeed() {
  fireEvent.change(screen.getByLabelText('一句话故事创意'), {
    target: { value: '一个失眠的维修工收到来自七年前的广播。' },
  });
  fireEvent.click(screen.getByRole('button', { name: '继续填写项目设置' }));
}

function fillProjectSetup() {
  fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '零点十七分' } });
  fireEvent.change(screen.getByLabelText('类型'), { target: { value: '现实悬疑' } });
  fireEvent.change(screen.getByLabelText('气质与语调'), { target: { value: '克制、紧张' } });
}

type RecordedObserver = {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function stubIntersectionObservers() {
  const observers: RecordedObserver[] = [];

  class MockIntersectionObserver {
    readonly root = null;
    readonly rootMargin: string;
    readonly thresholds: readonly number[];
    readonly observe = vi.fn();
    readonly disconnect = vi.fn();
    readonly unobserve = vi.fn();

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = options?.rootMargin ?? '0px';
      const threshold = options?.threshold ?? 0;
      this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
      observers.push({
        callback,
        options,
        observe: this.observe,
        unobserve: this.unobserve,
        disconnect: this.disconnect,
      });
    }

    takeRecords = () => [];
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  return observers;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LandingPage', () => {
  it('opens the complete sample without requiring project creation', () => {
    const { onOpenSample, onCreate } = renderLanding();

    fireEvent.click(screen.getByRole('button', { name: '先查看一份完成的剧本' }));
    expect(onOpenSample).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('expands project settings in place and focuses the project title', async () => {
    const { onCreate } = renderLanding();
    const continueButton = screen.getByRole('button', { name: '继续填写项目设置' });
    expect(continueButton).toHaveAttribute('aria-expanded', 'false');

    enterOriginalSeed();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '补充项目设置' })).toBeInTheDocument();
    expect(continueButton).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByLabelText('项目名称')).toHaveFocus());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('submits a complete original project through the shared form handler', async () => {
    const { onCreate } = renderLanding();
    enterOriginalSeed();
    fillProjectSetup();

    fireEvent.submit(screen.getByRole('heading', { name: '补充项目设置' }).closest('form')!);

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith({
      mode: 'ORIGINAL',
      title: '零点十七分',
      logline: '一个失眠的维修工收到来自七年前的广播。',
      sourceText: undefined,
      genre: '现实悬疑',
      tone: '克制、紧张',
      targetMinutes: 8,
      language: 'zh-CN',
    });
  });

  it('focuses the story field when the original seed is too short', () => {
    const { onCreate } = renderLanding();
    const input = screen.getByLabelText('一句话故事创意');

    fireEvent.change(input, { target: { value: '太短了' } });
    fireEvent.click(screen.getByRole('button', { name: '继续填写项目设置' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请至少写下 10 个字');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('focuses and describes the first missing project field', async () => {
    const { onCreate } = renderLanding();
    enterOriginalSeed();

    fireEvent.click(screen.getByRole('button', { name: '创建故事档案' }));

    const title = screen.getByLabelText('项目名称');
    expect(await screen.findByRole('alert')).toHaveTextContent('请给故事起一个项目名称');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAttribute('aria-describedby', 'project-setup-error');
    expect(title).toHaveFocus();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('requires adaptation material rights and includes the source in its payload', async () => {
    const { onCreate } = renderLanding();
    fireEvent.click(screen.getByRole('radio', { name: '网文改编' }));

    const input = screen.getByLabelText('网文改编素材');
    fireEvent.change(input, { target: { value: '素材'.repeat(20) } });
    fireEvent.click(screen.getByRole('button', { name: '继续填写项目设置' }));
    expect(screen.getByRole('alert')).toHaveTextContent('至少 200 个字');

    const source = '素材'.repeat(100);
    fireEvent.change(input, { target: { value: source } });
    fireEvent.click(screen.getByRole('button', { name: '继续填写项目设置' }));

    const rights = screen.getByRole('checkbox', { name: /我拥有该素材的使用权/ });
    expect(screen.getByRole('alert')).toHaveTextContent('请先确认你拥有该素材的使用权');
    expect(rights).toHaveFocus();

    fireEvent.click(rights);
    fireEvent.click(screen.getByRole('button', { name: '继续填写项目设置' }));
    fillProjectSetup();
    fireEvent.click(screen.getByRole('button', { name: '创建故事档案' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'ADAPTATION',
      logline: source,
      sourceText: source,
    })));
  });

  it('preserves the draft when returning to edit the seed', async () => {
    renderLanding();
    enterOriginalSeed();
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '临时片名' } });

    fireEvent.click(screen.getByRole('button', { name: '返回修改创意' }));

    const seed = screen.getByLabelText('一句话故事创意');
    expect(screen.queryByRole('heading', { name: '补充项目设置' })).not.toBeInTheDocument();
    expect(seed).toHaveValue('一个失眠的维修工收到来自七年前的广播。');
    await waitFor(() => expect(seed).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: '继续填写项目设置' }));
    expect(screen.getByLabelText('项目名称')).toHaveValue('临时片名');
  });

  it('keeps setup values visible when project creation fails', async () => {
    const onCreate = vi.fn(async () => {
      throw new Error('服务暂时不可用');
    });
    renderLanding({ onCreate });
    enterOriginalSeed();
    fillProjectSetup();

    fireEvent.click(screen.getByRole('button', { name: '创建故事档案' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用');
    expect(screen.getByLabelText('项目名称')).toHaveValue('零点十七分');
  });

  it('exposes the busy state and prevents another submission', () => {
    const { onCreate } = renderLanding({ busy: true });
    const form = screen.getByLabelText('一句话故事创意').closest('form')!;

    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: '继续填写项目设置' })).toBeDisabled();
    fireEvent.submit(form);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('keeps the public trend and sample actions explicit', () => {
    const { onOpenTrends } = renderLanding();
    fireEvent.click(screen.getByRole('button', { name: '热点选题' }));
    expect(onOpenTrends).toHaveBeenCalledOnce();

    const sample = screen.getByRole('article', { name: '《零点十七分》完整示例预览' });
    expect(within(sample).getByRole('button', { name: '打开完整示例' })).toBeInTheDocument();
    expect(within(screen.getByRole('contentinfo')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps every process stage visible when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderLanding();

    const stages = screen.getAllByRole('article').filter((element) => element.classList.contains('process-step'));
    expect(stages).toHaveLength(6);
    for (const stage of stages) {
      expect(stage).not.toHaveAttribute('data-active');
      expect(stage.querySelector('.process-step-copy')).toBeVisible();
      expect(stage.querySelector('.process-step-artifact')).toBeVisible();
      expect(stage.querySelector('[data-reveal="true"]')).not.toBeInTheDocument();
    }
  });

  it('mounts both reveal targets and alternates the process layout', () => {
    renderLanding();

    const stages = screen.getAllByRole('article').filter((element) => element.classList.contains('process-step'));
    expect(stages.map((stage) => stage.classList.contains('process-step--reverse')))
      .toEqual([false, true, false, true, false, true]);
    for (const stage of stages) {
      expect(Array.from(stage.children).filter((child) => child.classList.contains('process-step-copy'))).toHaveLength(1);
      expect(Array.from(stage.children).filter((child) => child.classList.contains('process-step-artifact'))).toHaveLength(1);
    }
  });

  it('reveals each process side before it enters the physical viewport', async () => {
    const observers = stubIntersectionObservers();
    renderLanding();

    const stage = screen.getByRole('heading', { name: '先把故事说清楚' }).closest('.process-step')!;
    const copy = stage.querySelector('.process-step-copy')!;
    const artifact = stage.querySelector('.process-step-artifact')!;
    const observer = observers.find(({ observe }) => observe.mock.calls.some(([target]) => target === copy));
    expect(observer?.options).toEqual({ rootMargin: '0px 0px 10% 0px', threshold: 0.08 });
    expect(observer?.observe).toHaveBeenCalledWith(copy);
    expect(observer?.observe).toHaveBeenCalledWith(artifact);
    expect(stage).not.toHaveAttribute('data-active');

    act(() => observer?.callback(
      [{ isIntersecting: false, target: copy } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(observer?.disconnect).not.toHaveBeenCalled();

    act(() => observer?.callback(
      [{
        isIntersecting: true,
        target: copy,
        boundingClientRect: { top: window.innerHeight + 40 },
      } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(stage).toHaveAttribute('data-active', 'true'));
    expect(copy).toHaveAttribute('data-reveal', 'true');
    expect(artifact).not.toHaveAttribute('data-reveal');
    expect(observer?.unobserve).toHaveBeenCalledWith(copy);
    expect(observer?.disconnect).not.toHaveBeenCalled();

    act(() => observer?.callback(
      [{
        isIntersecting: true,
        target: artifact,
        boundingClientRect: { top: window.innerHeight + 30 },
      } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(artifact).toHaveAttribute('data-reveal', 'true'));
    expect(observer?.unobserve).toHaveBeenCalledWith(artifact);
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });

  it('does not restart an entrance when the observer reports already-visible content', async () => {
    const observers = stubIntersectionObservers();
    renderLanding();

    const stage = screen.getByRole('heading', { name: '先把故事说清楚' }).closest('.process-step')!;
    const copy = stage.querySelector('.process-step-copy')!;
    const observer = observers.find(({ observe }) => observe.mock.calls.some(([target]) => target === copy));

    act(() => observer?.callback(
      [{
        isIntersecting: true,
        target: copy,
        boundingClientRect: { top: window.innerHeight - 20 },
      } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));

    await waitFor(() => expect(stage).toHaveAttribute('data-active', 'true'));
    expect(copy).not.toHaveAttribute('data-reveal');
    expect(observer?.unobserve).toHaveBeenCalledWith(copy);
  });

  it('keeps the typography and motion contract in CSS', () => {
    const artifactBaseRule = landingCss.match(/\.process-step-artifact\s*\{([^}]*)\}/)?.[1] ?? '';
    const copyBaseRule = landingCss.match(/\.process-step-copy\s*\{([^}]*)\}/)?.[1] ?? '';
    const mobileMotionCss = landingCss.slice(
      landingCss.indexOf('@media (max-width: 760px)'),
      landingCss.indexOf('@media (max-width: 420px)'),
    );
    const reducedMotionCss = landingCss.slice(landingCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

    expect(landingCss).toContain('"PingFang SC"');
    expect(landingCss).not.toContain('"Noto Sans SC Variable"');
    expect(landingCss).not.toContain('.scroll-reveal');
    expect(artifactBaseRule).not.toMatch(/opacity|visibility|display|transform/);
    expect(copyBaseRule).not.toMatch(/opacity|visibility|display|transform/);
    expect(landingCss).toContain('@keyframes hero-enter');
    expect(landingCss).toMatch(/\.process-step:not\(\.process-step--reverse\) \.process-step-copy\[data-reveal="true"\]\s*{[^}]*process-copy-arrive-left/);
    expect(landingCss).toMatch(/\.process-step:not\(\.process-step--reverse\) \.process-step-artifact\[data-reveal="true"\]\s*{[^}]*process-artifact-arrive-right/);
    expect(landingCss).toMatch(/\.process-step\.process-step--reverse \.process-step-copy\[data-reveal="true"\]\s*{[^}]*process-copy-arrive-right/);
    expect(landingCss).toMatch(/\.process-step\.process-step--reverse \.process-step-artifact\[data-reveal="true"\]\s*{[^}]*process-artifact-arrive-left/);
    expect(landingCss).toMatch(/@keyframes process-copy-arrive-left\s*{[\s\S]*?from\s*{[^}]*opacity:\s*0;[^}]*translate3d\(-\d+px/);
    expect(landingCss).toMatch(/@keyframes process-copy-arrive-right\s*{[\s\S]*?from\s*{[^}]*opacity:\s*0;[^}]*translate3d\(\d+px/);
    expect(landingCss).toMatch(/@keyframes process-artifact-arrive-right\s*{[\s\S]*?from\s*{[^}]*opacity:\s*0;[^}]*translate3d\(\d+px/);
    expect(landingCss).toMatch(/@keyframes process-artifact-arrive-left\s*{[\s\S]*?from\s*{[^}]*opacity:\s*0;[^}]*translate3d\(-\d+px/);
    expect(mobileMotionCss).toMatch(/\.process-step:not\(\.process-step--reverse\) \.process-step-copy\[data-reveal="true"\],[\s\S]*?process-copy-arrive-mobile/);
    expect(mobileMotionCss).toMatch(/\.process-step:not\(\.process-step--reverse\) \.process-step-artifact\[data-reveal="true"\],[\s\S]*?process-artifact-arrive-mobile/);
    expect(landingCss).toContain('min-height: clamp(620px, 78svh, 760px);');
    expect(reducedMotionCss).toMatch(/\.process-step-copy,\s*\.process-step-artifact,[\s\S]*?{[^}]*opacity:\s*1;[^}]*transform:\s*none;[^}]*animation:\s*none !important;/);
    expect(landingCss).not.toMatch(/(?:repeating-)?linear-gradient/);
  });
});
