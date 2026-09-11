import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorLogService } from '../../modules/error-logs/error-log.service';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Optional() private errorLogService?: ErrorLogService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exceptionResponse;
        error = (exceptionResponse as any).error || exception.name;
      } else {
        message = exceptionResponse;
        error = exception.name;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
      message = process.env.NODE_ENV === 'development' ? exception.message : 'An unexpected error occurred.';
    }

    // Format readable message string if it's an array (e.g. from class-validator)
    const formattedMessage = Array.isArray(message) ? message.join(', ') : message;

    // Fail-safe automatic recording for unexpected application/system errors (HTTP status >= 500 or non-HttpExceptions)
    const isUnexpectedError = status >= 500 || !(exception instanceof HttpException);
    if (isUnexpectedError && this.errorLogService) {
      Promise.resolve()
        .then(() => this.errorLogService?.logError({ error: exception, request }))
        .catch((logErr) => {
          this.logger.error(`Failed to record error log in filter: ${logErr.message}`);
        });
    }

    response.status(status).json({
      statusCode: status,
      error,
      message: formattedMessage,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
