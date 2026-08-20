import { ConfigService } from '@nestjs/config';
import { AccessService } from './access.service';

const config = new ConfigService({ WEB_ORIGIN: 'https://screenplay.example' });

describe('AccessService', () => {
  it('reports the configured gate state without creating a visitor', () => {
    const identity = {
      accessRequired: true,
      readSignedToken: jest.fn().mockReturnValue('token'),
      isAuthorizedToken: jest.fn().mockReturnValue(true),
    };
    const service = new AccessService(identity as never, config);

    expect(service.session('ids_visitor=signed')).toEqual({ required: true, authorized: true });
  });

  it('accepts a valid code and resolves its stable visitor identity', async () => {
    const identity = {
      tokenForAccessCode: jest.fn().mockReturnValue('derived-token'),
      resolveVisitor: jest.fn().mockResolvedValue('visitor-1'),
    };
    const service = new AccessService(identity as never, config);

    await expect(service.authorize('valid-code', '127.0.0.1')).resolves.toBe('derived-token');
    expect(identity.resolveVisitor).toHaveBeenCalledWith('derived-token');
  });

  it('rate-limits repeated invalid access codes per IP', async () => {
    const identity = { tokenForAccessCode: jest.fn() };
    const service = new AccessService(identity as never, config);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.authorize('invalid', '203.0.113.5')).rejects.toMatchObject({ status: 401 });
    }
    await expect(service.authorize('invalid', '203.0.113.5')).rejects.toMatchObject({ status: 429 });
  });

  it('never locks a valid seat behind failures from the same shared NAT', async () => {
    const identity = {
      tokenForAccessCode: jest
        .fn()
        .mockImplementation((code: string) => (code === 'valid' ? 'derived-token' : undefined)),
      resolveVisitor: jest.fn().mockResolvedValue('visitor-1'),
    };
    const service = new AccessService(identity as never, config);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.authorize('invalid', '203.0.113.8')).rejects.toMatchObject({ status: 401 });
    }

    await expect(service.authorize('valid', '203.0.113.8')).resolves.toBe('derived-token');
  });

  it('requires JSON, a custom anti-CSRF header and the configured browser origin', () => {
    const service = new AccessService({} as never, config);

    expect(() => service.assertAuthorizeRequest({
      marker: 'authorize',
      contentType: 'application/json; charset=utf-8',
      origin: 'https://screenplay.example',
    })).not.toThrow();
    expect(() => service.assertAuthorizeRequest({
      contentType: 'application/x-www-form-urlencoded',
      origin: 'https://evil.example',
    })).toThrow('访问码请求校验失败');
    expect(() => service.assertAuthorizeRequest({
      marker: 'authorize',
      contentType: 'application/json',
      origin: 'https://evil.example',
    })).toThrow('访问码请求来源无效');
  });
});
