import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

const landingCss = readFileSync(resolve('src/components/LandingPage.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LandingPage', () => {
  it('opens the complete sample without requiring the API', () => {
    const onOpenSample = vi.fn();
    render(<LandingPage onStart={vi.fn()} onOpenSample={onOpenSample} onOpenTrends={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '先查看一份完成的剧本' }));
    expect(onOpenSample).toHaveBeenCalledOnce();
  });

  it('validates and submits an original story seed', () => {
    const onStart = vi.fn();
    render(<LandingPage onStart={onStart} onOpenSample={vi.fn()} onOpenTrends={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('一句话故事创意'), {
      target: { value: '一个失眠的维修工收到来自七年前的广播。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '继续设置创作项目' }));

    expect(onStart).toHaveBeenCalledWith('一个失眠的维修工收到来自七年前的广播。', 'original');
  });

  it('focuses the story field when the original seed is too short', () => {
    const onStart = vi.fn();
    render(<LandingPage onStart={onStart} onOpenSample={vi.fn()} onOpenTrends={vi.fn()} />);

    const input = screen.getByLabelText('一句话故事创意');
    fireEvent.change(input, { target: { value: '太短了' } });
    fireEvent.click(screen.getByRole('button', { name: '继续设置创作项目' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请至少写下 10 个字');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('requires enough adaptation material and a rights confirmation', () => {
    const onStart = vi.fn();
    render(<LandingPage onStart={onStart} onOpenSample={vi.fn()} onOpenTrends={vi.fn()} />);

    const adaptationMode = screen.getByRole('radio', { name: '网文改编' });
    fireEvent.click(adaptationMode);
    expect(adaptationMode).toBeChecked();

    const input = screen.getByLabelText('网文改编素材');
    expect(input).toHaveAttribute('maxlength', '10000');
    fireEvent.change(input, { target: { value: '素材'.repeat(20) } });
    fireEvent.click(screen.getByRole('button', { name: '继续设置创作项目' }));
    expect(screen.getByRole('alert')).toHaveTextContent('至少 200 个字');
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: '素材'.repeat(100) } });
    fireEvent.click(screen.getByRole('button', { name: '继续设置创作项目' }));

    const rights = screen.getByRole('checkbox', { name: /我拥有该素材的使用权/ });
    expect(screen.getByRole('alert')).toHaveTextContent('请先确认你拥有该素材的使用权');
    expect(rights).toHaveAttribute('aria-invalid', 'true');
    expect(rights).toHaveFocus();
    expect(input).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.click(rights);
    fireEvent.click(screen.getByRole('button', { name: '继续设置创作项目' }));
    expect(onStart).toHaveBeenCalledWith('素材'.repeat(100), 'adaptation');
  });

  it('opens the public trend desk from the primary navigation', () => {
    const onOpenTrends = vi.fn();
    render(<LandingPage onStart={vi.fn()} onOpenSample={vi.fn()} onOpenTrends={onOpenTrends} />);

    fireEvent.click(screen.getByRole('button', { name: '热点选题' }));
    expect(onOpenTrends).toHaveBeenCalledOnce();
  });

  it('uses an explicit sample action and has no inactive footer buttons', () => {
    render(<LandingPage onStart={vi.fn()} onOpenSample={vi.fn()} onOpenTrends={vi.fn()} />);

    const sample = screen.getByRole('article', { name: '《零点十七分》完整示例预览' });
    expect(within(sample).getByRole('button', { name: '打开完整示例' })).toBeInTheDocument();
    expect(within(screen.getByRole('contentinfo')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps scroll-reveal content available when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<LandingPage onStart={vi.fn()} onOpenSample={vi.fn()} onOpenTrends={vi.fn()} />);

    const heading = screen.getByRole('heading', { name: '先看一份真正完成的初稿。' });
    expect(heading).toBeVisible();
    expect(heading.closest('.scroll-reveal')).not.toHaveAttribute('data-revealed');
  });

  it('reveals an observed section once and disconnects its observer', async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      options: IntersectionObserverInit | undefined;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];

    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin: string;
      readonly thresholds: readonly number[];
      readonly observe = vi.fn();
      readonly disconnect = vi.fn();
      readonly unobserve = vi.fn();

      constructor(nextCallback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.rootMargin = options?.rootMargin ?? '0px';
        const threshold = options?.threshold ?? 0;
        this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
        observers.push({
          callback: nextCallback,
          options,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }

      takeRecords = () => [];
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    render(<LandingPage onStart={vi.fn()} onOpenSample={vi.fn()} onOpenTrends={vi.fn()} />);

    const heading = screen.getByRole('heading', { name: '先看一份真正完成的初稿。' });
    const reveal = heading.closest('.scroll-reveal');
    const observer = observers.find(({ observe }) => (
      observe.mock.calls.some(([target]) => target === reveal)
    ));

    expect(reveal).not.toHaveAttribute('data-revealed');
    expect(observer).toBeDefined();
    expect(observer?.observe).toHaveBeenCalledWith(reveal);
    expect(observer?.options).toEqual({ rootMargin: '0px 0px -8% 0px', threshold: 0.15 });

    act(() => observer?.callback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(reveal).not.toHaveAttribute('data-revealed');
    expect(observer?.disconnect).not.toHaveBeenCalled();

    act(() => observer?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(reveal).toHaveAttribute('data-revealed', 'true'));
    expect(observer?.disconnect).toHaveBeenCalledOnce();

    act(() => observer?.callback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(reveal).toHaveAttribute('data-revealed', 'true');
  });

  it('still observes sections when reduced motion is requested so CSS can crossfade them', () => {
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const observerConstructor = vi.fn();
    const observe = vi.fn();

    class MockIntersectionObserver {
      readonly observe = observe;
      readonly disconnect = vi.fn();

      constructor() {
        observerConstructor();
      }
    }

    vi.stubGlobal('matchMedia', matchMedia);
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    render(<LandingPage onStart={vi.fn()} onOpenSample={vi.fn()} onOpenTrends={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: '先看一份真正完成的初稿。' });
    const reveal = heading.closest('.scroll-reveal');
    expect(observerConstructor).toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith(reveal);
    expect(heading).toBeVisible();
    expect(reveal).not.toHaveAttribute('data-revealed');
  });

  it('keeps the quiet reveal motion contract in CSS', () => {
    const baseRule = landingCss.match(/\.scroll-reveal\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(baseRule).toContain('--reveal-delay: 0ms');
    expect(baseRule).not.toMatch(/opacity|visibility|display|transform/);
    expect(landingCss).toContain(
      'animation: reveal-up 420ms var(--reveal-delay) cubic-bezier(0, 0, 0.38, 0.9) both;',
    );
    expect(landingCss).toContain(
      'from { opacity: 0; transform: translate3d(0, 12px, 0); }',
    );
    expect(landingCss).toContain(
      'to { opacity: 1; transform: translate3d(0, 0, 0); }',
    );
    expect(landingCss).not.toContain('blur(3px)');
    expect(landingCss).not.toContain('@keyframes reveal-left');
    expect(landingCss).not.toContain('@keyframes reveal-right');
    expect(landingCss).toContain('@keyframes reveal-fade');
    expect(landingCss).toContain(
      'animation: reveal-fade 240ms var(--reveal-delay) ease-out both !important;',
    );
    expect(landingCss).toContain('stroke-dashoffset: 0 !important;');
  });
});
