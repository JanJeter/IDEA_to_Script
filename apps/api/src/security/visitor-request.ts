import type { Request } from 'express';

export type VisitorRequest = Request & {
  visitorId: string;
  userId: string;
  username: string;
  clientIp: string;
};
