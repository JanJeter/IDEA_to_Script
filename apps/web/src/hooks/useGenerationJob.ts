import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, api } from '../api';
import type { GenerationEvent, GenerationJob } from '../types';

type Options = {
  onSucceeded: (projectId: string) => void | Promise<void>;
  onFailed: (message: string) => void;
};

export function useGenerationJob({ onSucceeded, onFailed }: Options) {
  const [generating, setGenerating] = useState(false);
  const [events, setEvents] = useState<GenerationEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const sourceRef = useRef<EventSource | undefined>(undefined);
  const pollTimerRef = useRef<number | undefined>(undefined);
  const watcherTokenRef = useRef(0);
  const lastSequenceRef = useRef(0);
  const onSucceededRef = useRef(onSucceeded);
  const onFailedRef = useRef(onFailed);

  useEffect(() => {
    onSucceededRef.current = onSucceeded;
    onFailedRef.current = onFailed;
  }, [onFailed, onSucceeded]);

  const stopTransport = useCallback(() => {
    watcherTokenRef.current += 1;
    sourceRef.current?.close();
    sourceRef.current = undefined;
    if (pollTimerRef.current !== undefined) window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = undefined;
  }, []);

  const settle = useCallback(
    (status: 'SUCCEEDED' | 'FAILED', projectId: string, message?: string) => {
      stopTransport();
      setGenerating(false);
      if (status === 'SUCCEEDED') {
        void Promise.resolve(onSucceededRef.current(projectId)).catch(() =>
          onFailedRef.current('剧本已经完成，但页面刷新失败，请重新打开项目'),
        );
      }
      else onFailedRef.current(message ?? '生成失败，旧稿已安全保留，请稍后重试');
    },
    [stopTransport],
  );

  const startPolling = useCallback(
    function poll(jobId: string, projectId: string, token: number, failedAttempts = 0) {
      const delayMs = Math.min(30_000, 1_500 * 2 ** Math.min(failedAttempts, 5));
      pollTimerRef.current = window.setTimeout(() => {
        void api
          .getGenerationJob(jobId)
          .then((job) => {
            if (watcherTokenRef.current !== token) return;
            setProgress(job.progress);
            if (job.status === 'SUCCEEDED') {
              setEvents((current) => [
                ...current,
                {
                  type: 'job:succeeded',
                  stage: job.stage,
                  message: job.message,
                  progress: 100,
                  projectId,
                },
              ]);
              settle('SUCCEEDED', projectId);
              return;
            }
            if (job.status === 'FAILED') {
              settle('FAILED', projectId, job.error ?? job.message);
              return;
            }
            poll(jobId, projectId, token, 0);
          })
          .catch((reason: unknown) => {
            if (watcherTokenRef.current !== token) return;
            const status =
              reason && typeof reason === 'object' && 'status' in reason
                ? Number((reason as { status: unknown }).status)
                : undefined;
            if (status && status >= 400 && status < 500) {
              settle(
                'FAILED',
                projectId,
                status === 401
                  ? '登录状态已失效，请重新登录'
                  : '生成任务已不存在或无权访问',
              );
              return;
            }
            poll(jobId, projectId, token, failedAttempts + 1);
          });
      }, delayMs);
    },
    [settle],
  );

  const watch = useCallback(
    (job: Pick<GenerationJob, 'id' | 'projectId' | 'progress'>) => {
      stopTransport();
      const token = watcherTokenRef.current;
      lastSequenceRef.current = 0;
      setGenerating(true);
      setProgress(job.progress);

      const source = new EventSource(`${API_URL}/jobs/${job.id}/events`, {
        withCredentials: true,
      });
      sourceRef.current = source;
      source.onmessage = (message) => {
        if (watcherTokenRef.current !== token) return;
        const sequence = Number.parseInt(message.lastEventId, 10);
        if (Number.isFinite(sequence) && sequence <= lastSequenceRef.current) return;
        if (Number.isFinite(sequence)) lastSequenceRef.current = sequence;

        try {
          const event = JSON.parse(message.data) as GenerationEvent;
          setEvents((current) => [...current, event]);
          setProgress(event.progress);
          if (event.type === 'pipeline:complete' || event.type === 'job:succeeded') {
            settle('SUCCEEDED', job.projectId);
          }
          else if (event.type === 'error') settle('FAILED', job.projectId, event.message);
        } catch {
          source.close();
          sourceRef.current = undefined;
          startPolling(job.id, job.projectId, token);
        }
      };
      source.onerror = () => {
        if (watcherTokenRef.current !== token) return;
        source.close();
        sourceRef.current = undefined;
        startPolling(job.id, job.projectId, token);
      };
    },
    [settle, startPolling, stopTransport],
  );

  const prepare = useCallback(
    (projectId: string) => {
      stopTransport();
      setGenerating(true);
      setProgress(1);
      setEvents([
        {
          type: 'pipeline:start',
          message: '正在完成隐私安全验证…',
          progress: 1,
          projectId,
        },
      ]);
    },
    [stopTransport],
  );

  const failPreparation = useCallback(
    (message: string) => {
      stopTransport();
      setGenerating(false);
      onFailedRef.current(message);
    },
    [stopTransport],
  );

  const reset = useCallback(() => {
    stopTransport();
    setGenerating(false);
    setEvents([]);
    setProgress(0);
  }, [stopTransport]);

  const setIdleProgress = useCallback((value: number) => setProgress(value), []);

  useEffect(() => stopTransport, [stopTransport]);

  return {
    generating,
    events,
    progress,
    prepare,
    watch,
    failPreparation,
    reset,
    setIdleProgress,
  };
}
