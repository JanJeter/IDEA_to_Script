import { readFileSync, statSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PasswordService } from './password.service';

function normalizeUsername(value: string) {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function readPassword() {
  const passwordFile = process.env.AUTH_RESET_PASSWORD_FILE;
  if (!passwordFile) {
    throw new Error('AUTH_RESET_PASSWORD_FILE must point to a protected password file');
  }
  const file = statSync(passwordFile);
  if (!file.isFile() || file.size > 1_024) {
    throw new Error('AUTH_RESET_PASSWORD_FILE must be a small regular file');
  }
  if (process.platform !== 'win32' && (file.mode & 0o077) !== 0) {
    throw new Error('AUTH_RESET_PASSWORD_FILE must not be readable by group or other users');
  }
  return readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '');
}

export async function resetUserPassword(
  prisma: PrismaClient,
  passwords: PasswordService,
  username: string,
  password: string,
) {
  if (password.length < 15 || password.length > 128) {
    throw new Error('The new password must contain between 15 and 128 characters');
  }
  const user = await prisma.user.findUnique({
    where: { usernameNormalized: normalizeUsername(username) },
    select: { id: true, username: true },
  });
  if (!user) throw new Error('User not found');

  const now = new Date();
  const passwordHash = await passwords.hash(password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: now },
    }),
    prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
  return user.username;
}

async function main() {
  const username = process.argv[2]?.trim();
  if (!username) {
    throw new Error('Usage: npm run auth:reset-password -w @idea2screenplay/api -- <username>');
  }
  const prisma = new PrismaClient();
  try {
    await resetUserPassword(
      prisma,
      new PasswordService(new ConfigService()),
      username,
      readPassword(),
    );
    console.log('Password reset completed; all sessions were revoked.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Password reset failed');
    process.exitCode = 1;
  });
}
