import { HttpException, HttpStatus } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuthNoStoreInterceptor } from './auth-no-store.interceptor';

describe('AuthNoStoreInterceptor', () => {
  it('sets Cache-Control before the controller runs, including failing requests', () => {
    const setHeader = jest.fn();
    const next = { handle: jest.fn(() => of(null)) };

    new AuthNoStoreInterceptor().intercept(
      {
        switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
      } as never,
      next,
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next.handle).toHaveBeenCalled();
  });

  it('adds a standard Retry-After header to throttled auth responses', async () => {
    const setHeader = jest.fn();
    const error = new HttpException(
      { message: '尝试次数过多，请稍后再试', retryAfterSeconds: 45 },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    const result = new AuthNoStoreInterceptor().intercept(
      {
        switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
      } as never,
      { handle: () => throwError(() => error) },
    );

    await expect(firstValueFrom(result)).rejects.toBe(error);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '45');
  });
});
