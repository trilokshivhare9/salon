import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ResponseEnvelope<T>> {
    return next.handle().pipe(
      map((res) => {
        // If response already has custom structure (e.g. meta for pagination or data envelope)
        if (res && typeof res === 'object' && ('data' in res || 'success' in res)) {
          return {
            success: res.success !== undefined ? res.success : true,
            data: res.data !== undefined ? res.data : res,
            message: res.message,
            meta: res.meta,
          };
        }
        return {
          success: true,
          data: res,
        };
      }),
    );
  }
}
