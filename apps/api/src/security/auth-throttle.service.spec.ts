import { ConfigService } from '@nestjs/config';
import { AuthThrottleService } from './auth-throttle.service';

describe('AuthThrottleService', () => {
  it('persists global, IP and identifier counters before password work', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { attempts: 1, windowStartedAt: new Date() },
    ]);
    const service = new AuthThrottleService(
      { $queryRaw: queryRaw } as never,
      new ConfigService({ AUTH_THROTTLE_KEY: 'a-test-throttle-key-with-more-than-32-characters' }),
    );

    await service.consumeLogin('203.0.113.4', 'writer');

    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(queryRaw.mock.calls.map((call) => call[2])).toEqual([
      'login-ip',
      'login-identifier',
      'login-global',
    ]);
    expect(queryRaw.mock.calls[0][3]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(queryRaw.mock.calls)).not.toContain('203.0.113.4');
    expect(JSON.stringify(queryRaw.mock.calls)).not.toContain('writer');
  });

  it('checks the global database counter only after local buckets accept the request', async () => {
    const accepted = [{ attempts: 1, windowStartedAt: new Date() }];
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce([{ attempts: 201, windowStartedAt: new Date() }]);
    const service = new AuthThrottleService(
      { $queryRaw: queryRaw } as never,
      new ConfigService({ AUTH_THROTTLE_KEY: 'a-test-throttle-key-with-more-than-32-characters' }),
    );

    await expect(service.consumeLogin('203.0.113.4', 'writer')).rejects.toMatchObject({
      status: 429,
    });
    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(queryRaw.mock.calls.map((call) => call[2])).toEqual([
      'login-ip',
      'login-identifier',
      'login-global',
    ]);
  });

  it('does not consume the global bucket after the IP bucket rejects a login', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { attempts: 21, windowStartedAt: new Date() },
    ]);
    const service = new AuthThrottleService(
      { $queryRaw: queryRaw } as never,
      new ConfigService({ AUTH_THROTTLE_KEY: 'a-test-throttle-key-with-more-than-32-characters' }),
    );

    await expect(service.consumeLogin('203.0.113.4', 'writer')).rejects.toMatchObject({
      status: 429,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0][2]).toBe('login-ip');
  });

  it('does not consume the registration global bucket after a username bucket rejection', async () => {
    const accepted = [{ attempts: 1, windowStartedAt: new Date() }];
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce([{ attempts: 6, windowStartedAt: new Date() }]);
    const service = new AuthThrottleService(
      { $queryRaw: queryRaw } as never,
      new ConfigService({ AUTH_THROTTLE_KEY: 'a-test-throttle-key-with-more-than-32-characters' }),
    );

    await expect(service.consumeRegistration('203.0.113.4', 'writer')).rejects.toMatchObject({
      status: 429,
    });
    expect(queryRaw.mock.calls.map((call) => call[2])).toEqual([
      'register-ip',
      'register-username',
    ]);
  });

  it('requires a strong stable hash key in production', () => {
    expect(
      () =>
        new AuthThrottleService(
          {} as never,
          new ConfigService({ NODE_ENV: 'production', AUTH_THROTTLE_KEY: 'weak' }),
        ),
    ).toThrow('AUTH_THROTTLE_KEY');
    expect(
      () =>
        new AuthThrottleService(
          {} as never,
          new ConfigService({
            NODE_ENV: 'production',
            AUTH_THROTTLE_KEY: 'development-auth-throttle-key-change-me',
          }),
        ),
    ).toThrow('AUTH_THROTTLE_KEY');
  });
});
