import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextStore {
  correlationId?: string;
  clientId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getRequestClientId(): string | undefined {
  return requestContext.getStore()?.clientId;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction) {
    const existingCorrelationId = req.headers['x-correlation-id'] as string;
    const correlationId = existingCorrelationId || `req-${uuidv4()}`;
    const clientId = (req.headers['x-client-id'] || req.query.clientId) as string;

    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    if (clientId) {
      res.setHeader('X-Client-ID', clientId);
    }

    requestContext.run({ correlationId, clientId }, () => {
      next();
    });
  }
}
