import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
    private logger = new Logger(HttpExceptionFilter.name);

    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();
        const statusCode = exception.getStatus();
        this.logger.error(`${request.method} ${request.originalUrl} ${statusCode} error: ${exception.message}`);
        const responseBody = exception.getResponse();
        response.status(statusCode).json({ error: true, responseBody});
        
    }

    private getResponseBody(exception: HttpException) {
        const response = exception.getResponse() as { message: string | string[]; code: string };
        return {
            statusCode: exception.getStatus(),
            message: response.message,
            error: response.code,
        };
    }

    private getErrorDetails(exception: HttpException) {
        const response = exception.getResponse() as { message: string | string[]; };
        return response.message;
    }

    private logException(exception: HttpException) {
        this.logger.error(exception.message, exception.stack);
    }
}