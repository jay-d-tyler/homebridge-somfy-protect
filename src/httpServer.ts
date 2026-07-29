import type { Logging } from 'homebridge';
import crypto from 'crypto';
import http from 'http';

/**
 * HTTP API Server for automation integrations
 * Provides REST endpoints for controlling the alarm system
 */
export class HttpApiServer {
  private server?: http.Server;

  constructor(
    private readonly log: Logging,
    private readonly port: number,
    private readonly token: string | undefined,
    private readonly disarmCallback: () => Promise<void>,
    private readonly armAwayCallback: () => Promise<void>,
    private readonly armNightCallback: () => Promise<void>,
    private readonly host = '127.0.0.1',
  ) {}

  /**
   * Start the HTTP server
   */
  start(): void {
    if (this.server) {
      this.log.warn('HTTP API server is already running');
      return;
    }

    if (this.port === 0) {
      this.log.info('HTTP API disabled (port set to 0)');
      return;
    }

    if (!this.token?.trim()) {
      this.log.error('HTTP API not started: httpToken is required when httpPort is enabled');
      return;
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.server.on('error', (error) => {
      this.log.error('HTTP API server error:', error);
    });

    this.server.listen(this.port, this.host, () => {
      this.log.info(`HTTP API server listening on ${this.host}:${this.port}`);
      this.log.info('Available endpoint: POST /disarm');
      this.log.info('Available endpoint: POST /arm/away');
      this.log.info('Available endpoint: POST /arm/night');
      this.log.info('HTTP API authentication enabled');
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const operation = req.method === 'POST'
      ? this.getOperation(req.url)
      : undefined;
    if (!operation) {
      this.sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !this.tokenMatches(authHeader)) {
      this.log.warn('Unauthorized HTTP API request (invalid token)');
      this.sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    this.log.info(`HTTP API: ${operation.label} command received`);
    try {
      await operation.callback();
      this.log.info(`HTTP API: ${operation.label} command successful`);
      this.sendJson(res, 200, {
        success: true,
        message: `${operation.label} command sent`,
      });
    } catch (error) {
      this.log.error(`HTTP API: Failed to ${operation.description}:`, error);
      this.sendJson(res, 500, {
        error: `Failed to ${operation.description} alarm`,
      });
    }
  }

  private getOperation(url: string | undefined): {
    label: string;
    description: string;
    callback: () => Promise<void>;
  } | undefined {
    switch (url) {
    case '/disarm':
      return {
        label: 'Disarm',
        description: 'disarm',
        callback: this.disarmCallback,
      };
    case '/arm/away':
      return {
        label: 'Away arm',
        description: 'arm away',
        callback: this.armAwayCallback,
      };
    case '/arm/night':
      return {
        label: 'Night arm',
        description: 'arm night',
        callback: this.armNightCallback,
      };
    default:
      return undefined;
    }
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    body: Record<string, unknown>,
  ): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  /**
   * Constant-time comparison of the Authorization header against the
   * configured token, so response timing can't be used to guess it
   */
  private tokenMatches(authHeader: string): boolean {
    const expected = Buffer.from(`Bearer ${this.token}`);
    const received = Buffer.from(authHeader);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this.server) {
      const server = this.server;
      this.server = undefined;
      server.close();
      this.log.info('HTTP API server stopped');
    }
  }
}
