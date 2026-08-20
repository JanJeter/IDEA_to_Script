import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService(new ConfigService());

  it('hashes passwords with the configured Argon2id work factors', async () => {
    const passwordHash = await service.hash('一段足够长的 password value');

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    await expect(service.verify(passwordHash, '一段足够长的 password value')).resolves.toBe(true);
    await expect(service.verify(passwordHash, 'wrong value')).resolves.toBe(false);
    expect(service.needsRehash(passwordHash)).toBe(false);
  });

  it('performs a dummy verification for unknown users and safely rejects invalid hashes', async () => {
    await expect(service.verify(undefined, 'unknown password')).resolves.toBe(false);
    await expect(service.verify('not-an-argon-hash', 'unknown password')).resolves.toBe(false);
  });

  it('rejects excess instantaneous work instead of exhausting memory', async () => {
    const limited = new PasswordService(
      new ConfigService({
        AUTH_PASSWORD_CONCURRENCY: '1',
        AUTH_PASSWORD_QUEUE_MAX: '0',
      }),
    );
    const first = limited.hash('first sufficiently long password');

    await expect(limited.hash('second sufficiently long password')).rejects.toMatchObject({
      status: 503,
    });
    await expect(first).resolves.toMatch(/^\$argon2id\$/);
  });
});
