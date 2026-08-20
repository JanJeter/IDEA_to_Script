import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError } from 'rxjs';

@Injectable()
export class AuthNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse();
    response.setHeader('Cache-Control', 'no-store');
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
          const payload = error.getResponse();
          const retryAfterSeconds =
            typeof payload === 'object' && payload !== null && 'retryAfterSeconds' in payload
              ? Number(payload.retryAfterSeconds)
              : Number.NaN;
          if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
            response.setHeader('Retry-After', String(retryAfterSeconds));
          }
        }
        return throwError(() => error);
      }),
    );
  }
}
