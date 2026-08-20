import { resetUserPassword } from './reset-user-password.cli';

describe('resetUserPassword', () => {
  it('replaces the password hash and revokes every active session atomically', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', username: 'Writer' }),
        update: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      authSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn().mockImplementation((operations) => Promise.all(operations)),
    };
    const passwords = { hash: jest.fn().mockResolvedValue('new-password-hash') };

    await expect(
      resetUserPassword(
        prisma as never,
        passwords as never,
        ' Ｗriter ',
        'a sufficiently long password',
      ),
    ).resolves.toBe('Writer');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { usernameNormalized: 'writer' },
      select: { id: true, username: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-password-hash', passwordChangedAt: expect.any(Date) },
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects unsafe password lengths before doing database or hash work', async () => {
    const prisma = { user: { findUnique: jest.fn() } };
    const passwords = { hash: jest.fn() };

    await expect(
      resetUserPassword(prisma as never, passwords as never, 'writer', 'too short'),
    ).rejects.toThrow('between 15 and 128');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
  });
});
