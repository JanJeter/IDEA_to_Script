export type AltchaChallenge = {
  parameters: {
    algorithm: string;
    nonce: string;
    salt: string;
    cost: number;
    keyLength: number;
    keyPrefix: string;
    keySignature?: string;
    expiresAt?: number;
    data?: Record<string, string | number | boolean | null>;
  };
  signature?: string;
};

export type AltchaSolution = {
  counter: number;
  derivedKey: string;
  time?: number;
};
