import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private logger = new Logger(LoggingMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const reqTime = new Date().getTime();
    res.on('finish', () => {
      const statusCode = res.statusCode;
      const resTime = new Date().getTime();
      if (statusCode === 201 || statusCode === 200) {
        const responseTime = resTime - reqTime;
        this.logger.log(
          `${method} ${originalUrl} ${res.statusCode} ${responseTime}ms`,
        );
      }
    });
    next();
  }
}
