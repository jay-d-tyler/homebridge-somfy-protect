import type { Logging } from 'homebridge';
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
  ) {}

  /**
   * Start the HTTP server
   */
  start(): void {
    if (this.port === 0) {
      this.log.info('HTTP API disabled (port set to 0)');
      return;
    }

    this.server = http.createServer((req, res) => {
      // Set CORS headers for browser-based automation tools
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Handle disarm endpoint
      if (req.method === 'POST' && req.url === '/disarm') {
        // Check token if configured
        if (this.token) {
          const authHeader = req.headers.authorization;
          if (!authHeader || authHeader !== `Bearer ${this.token}`) {
            this.log.warn('Unauthorized HTTP API request (invalid token)');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
        }

        this.log.info('HTTP API: Disarm command received');

        // Trigger disarm
        this.disarmCallback()
          .then(() => {
            this.log.info('HTTP API: Disarm command successful');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Disarm command sent' }));
          })
          .catch((error) => {
            this.log.error('HTTP API: Failed to disarm:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to disarm alarm' }));
          });
      } else {
        // Unknown endpoint
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.on('error', (error) => {
      this.log.error('HTTP API server error:', error);
    });

    this.server.listen(this.port, () => {
      this.log.info(`HTTP API server listening on port ${this.port}`);
      this.log.info('Available endpoint: POST /disarm');
      if (this.token) {
        this.log.info('HTTP API authentication enabled');
      } else {
        this.log.warn('HTTP API authentication disabled - anyone on your network can trigger disarm');
      }
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.log.info('HTTP API server stopped');
    }
  }
}
