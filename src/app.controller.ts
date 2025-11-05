import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('service-worker.js')
  getServiceWorker(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`// no-op service worker served by API to satisfy browser request\nself.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', () => self.clients.claim());`);
  }
}
