import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';

describe('authentication DTOs', () => {
  it('accepts the shared username alphabet and preserves password whitespace', async () => {
    const input = plainToInstance(RegisterDto, {
      username: '  编剧.Ｗriter_01  ',
      password: '  password with meaningful spaces  ',
      passwordConfirmation: '  password with meaningful spaces  ',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input.username).toBe('编剧.Writer_01');
    expect(input.password).toBe('  password with meaningful spaces  ');
  });

  it('rejects non-ASCII letters, symbols outside the contract and short passwords', async () => {
    const input = plainToInstance(RegisterDto, {
      username: 'écrivain!',
      password: 'short',
      passwordConfirmation: 'short',
    });

    const errors = await validate(input);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'password',
      'passwordConfirmation',
      'username',
    ]);
  });

  it('allows a short login password so existing hashes can remain verifiable', async () => {
    const input = plainToInstance(LoginDto, { identifier: ' writer ', password: 'old' });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input.identifier).toBe('writer');
  });
});
