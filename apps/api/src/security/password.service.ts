import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash, needsRehash, verify } from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

// A public, valid Argon2id hash keeps unknown-user login timing close to a real login.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$acgy3tvposcrPBsa0wvIIA$Z4iR69oZA0mxY7aVcmKH7lk+Rkc5sAei0kVRf6VCflg';

type PasswordWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

@Injectable()
export class PasswordService {
  private readonly maximumConcurrency: number;
  private readonly maximumQueue: number;
  private readonly queueWaitMs: number;
  private activeOperations = 0;
  private readonly waiters: PasswordWaiter[] = [];

  constructor(config: ConfigService) {
    this.maximumConcurrency = this.integerConfig(config, 'AUTH_PASSWORD_CONCURRENCY', 4, 1, 16);
    this.maximumQueue = this.integerConfig(config, 'AUTH_PASSWORD_QUEUE_MAX', 32, 0, 1_000);
    this.queueWaitMs = this.integerConfig(config, 'AUTH_PASSWORD_QUEUE_WAIT_MS', 10_000, 100, 60_000);
  }

  hash(password: string) {
    return this.run(() => hash(password, ARGON2_OPTIONS));
  }

  verify(passwordHash: string | undefined, password: string) {
    return this.run(async () => {
      try {
        return await verify(passwordHash ?? DUMMY_PASSWORD_HASH, password);
      } catch {
        return false;
      }
    });
  }

  needsRehash(passwordHash: string) {
    return needsRehash(passwordHash, ARGON2_OPTIONS);
  }

  private async run<T>(operation: () => Promise<T>) {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire() {
    if (this.activeOperations < this.maximumConcurrency) {
      this.activeOperations += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maximumQueue) {
      throw new ServiceUnavailableException('登录服务繁忙，请稍后重试');
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: PasswordWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new ServiceUnavailableException('登录服务繁忙，请稍后重试'));
        }, this.queueWaitMs),
      };
      this.waiters.push(waiter);
    });
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
      return;
    }
    this.activeOperations = Math.max(0, this.activeOperations - 1);
  }

  private integerConfig(
    config: ConfigService,
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const parsed = Number.parseInt(config.get<string>(key, String(fallback)), 10);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  }
}
