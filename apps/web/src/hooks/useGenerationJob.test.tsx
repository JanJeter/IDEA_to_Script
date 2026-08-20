import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { GenerationJob } from '../types';
import { useGenerationJob } from './useGenerationJob';

vi.mock('../api', () => ({
  API_URL: '/api',
  api: { getGenerationJob: vi.fn() },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
}

const job: GenerationJob = {
  id: 'job-1',
  projectId: 'project-1',
  versionId: 'version-1',
  stage: 'CHARACTERS',
  status: 'RUNNING',
  progress: 20,
  currentStage: 'CHARACTERS',
  message: '塑造人物',
  error: null,
  attempt: 1,
  resultVersionId: null,
  queuedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  updatedAt: new Date().toISOString(),
};

describe('useGenerationJob', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('closes the SSE connection when the observing component unmounts', () => {
    const { result, unmount } = renderHook(() =>
      useGenerationJob({ onSucceeded: vi.fn(), onFailed: vi.fn() }),
    );

    act(() => result.current.watch(job));
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/jobs/job-1/events');

    unmount();
    expect(source.close).toHaveBeenCalled();
  });

  it('falls back to job polling when SSE disconnects', async () => {
    vi.useFakeTimers();
    const onSucceeded = vi.fn();
    vi.mocked(api.getGenerationJob).mockResolvedValue({
      ...job,
      status: 'SUCCEEDED',
      progress: 100,
      message: '剧本初稿完成，可以逐场修改',
      resultVersionId: 'version-1',
      completedAt: new Date().toISOString(),
    });
    const { result } = renderHook(() =>
      useGenerationJob({ onSucceeded, onFailed: vi.fn() }),
    );

    act(() => result.current.watch(job));
    act(() => FakeEventSource.instances[0].onerror?.(new Event('error')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await Promise.resolve();
    });

    expect(onSucceeded).toHaveBeenCalledWith('project-1');
    expect(api.getGenerationJob).toHaveBeenCalledWith('job-1');
  });

  it('stops polling immediately for a terminal 4xx response', async () => {
    vi.useFakeTimers();
    const onFailed = vi.fn();
    vi.mocked(api.getGenerationJob).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const { result } = renderHook(() =>
      useGenerationJob({ onSucceeded: vi.fn(), onFailed }),
    );

    act(() => result.current.watch(job));
    act(() => FakeEventSource.instances[0].onerror?.(new Event('error')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(api.getGenerationJob).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith('生成任务已不存在或无权访问');
  });
});
