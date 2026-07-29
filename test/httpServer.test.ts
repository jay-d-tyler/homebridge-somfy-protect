import { HttpApiServer } from '../src/httpServer.js';
import type { Logging } from 'homebridge';
import http from 'http';

interface HttpResult {
  statusCode: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> | undefined;
}

const waitForListening = () => new Promise(resolve => setTimeout(resolve, 20));
let nextPort = 30000 + (process.pid % 20000);

describe('HttpApiServer', () => {
  let mockLog: jest.Mocked<Logging>;
  let mockDisarmCallback: jest.Mock;
  let mockArmAwayCallback: jest.Mock;
  let mockArmNightCallback: jest.Mock;

  beforeEach(() => {
    mockLog = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      success: jest.fn(),
    } as unknown as jest.Mocked<Logging>;

    mockDisarmCallback = jest.fn().mockResolvedValue(undefined);
    mockArmAwayCallback = jest.fn().mockResolvedValue(undefined);
    mockArmNightCallback = jest.fn().mockResolvedValue(undefined);
  });

  const createServer = (
    port: number,
    token: string | undefined = 'valid-token',
  ) => new HttpApiServer(
    mockLog,
    port,
    token,
    mockDisarmCallback,
    mockArmAwayCallback,
    mockArmNightCallback,
  );

  const request = (
    port: number,
    path: string,
    method = 'POST',
    token: string | undefined = 'valid-token',
  ): Promise<HttpResult> => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: data ? JSON.parse(data) as Record<string, unknown> : undefined,
      }));
    });
    req.on('error', reject);
    req.end();
  });

  describe('start', () => {
    it('should not start server when port is 0', () => {
      const server = createServer(0, undefined);
      server.start();

      expect(mockLog.info).toHaveBeenCalledWith('HTTP API disabled (port set to 0)');
    });

    it('should log all available endpoints', async () => {
      const port = nextPort++;
      const server = createServer(port);
      server.start();
      await waitForListening();

      expect(mockLog.info).toHaveBeenCalledWith(
        `HTTP API server listening on 127.0.0.1:${port}`,
      );
      expect(mockLog.info).toHaveBeenCalledWith('Available endpoint: POST /disarm');
      expect(mockLog.info).toHaveBeenCalledWith('Available endpoint: POST /arm/away');
      expect(mockLog.info).toHaveBeenCalledWith('Available endpoint: POST /arm/night');
      expect(mockLog.info).toHaveBeenCalledWith('HTTP API authentication enabled');
      server.stop();
    });

    it('should refuse to start when authentication is missing', () => {
      const server = createServer(nextPort++, '');
      server.start();

      expect(mockLog.error).toHaveBeenCalledWith(
        'HTTP API not started: httpToken is required when httpPort is enabled',
      );
    });

    it('should refuse to start twice', async () => {
      const server = createServer(nextPort++);
      server.start();
      server.start();
      await waitForListening();

      expect(mockLog.warn).toHaveBeenCalledWith('HTTP API server is already running');
      server.stop();
    });
  });

  describe('alarm endpoints', () => {
    it.each([
      ['/disarm', 'Disarm command sent', 'disarm'],
      ['/arm/away', 'Away arm command sent', 'away'],
      ['/arm/night', 'Night arm command sent', 'night'],
    ])('should handle POST %s with the correct callback', async (
      path,
      message,
      selectedCallback,
    ) => {
      const port = nextPort++;
      const server = createServer(port);
      server.start();
      await waitForListening();

      const result = await request(port, path);

      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.body).toEqual({ success: true, message });
      expect(mockDisarmCallback).toHaveBeenCalledTimes(selectedCallback === 'disarm' ? 1 : 0);
      expect(mockArmAwayCallback).toHaveBeenCalledTimes(selectedCallback === 'away' ? 1 : 0);
      expect(mockArmNightCallback).toHaveBeenCalledTimes(selectedCallback === 'night' ? 1 : 0);
      server.stop();
    });

    it.each(['/disarm', '/arm/away', '/arm/night'])(
      'should enforce authentication on %s',
      async (path) => {
        const port = nextPort++;
        const server = createServer(port);
        server.start();
        await waitForListening();

        const missing = await request(port, path, 'POST', '');
        const invalid = await request(port, path, 'POST', 'invalid-token');

        expect(missing.statusCode).toBe(401);
        expect(missing.body).toEqual({ error: 'Unauthorized' });
        expect(invalid.statusCode).toBe(401);
        expect(mockDisarmCallback).not.toHaveBeenCalled();
        expect(mockArmAwayCallback).not.toHaveBeenCalled();
        expect(mockArmNightCallback).not.toHaveBeenCalled();
        server.stop();
      },
    );

    it.each([
      ['/disarm', 'Failed to disarm alarm', 'disarm'],
      ['/arm/away', 'Failed to arm away alarm', 'away'],
      ['/arm/night', 'Failed to arm night alarm', 'night'],
    ])('should return JSON 500 when %s fails', async (
      path,
      errorMessage,
      failingCallback,
    ) => {
      const callback = failingCallback === 'disarm'
        ? mockDisarmCallback
        : failingCallback === 'away'
          ? mockArmAwayCallback
          : mockArmNightCallback;
      callback.mockRejectedValueOnce(new Error('Somfy failed'));
      const port = nextPort++;
      const server = createServer(port);
      server.start();
      await waitForListening();

      const result = await request(port, path);

      expect(result.statusCode).toBe(500);
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.body).toEqual({ error: errorMessage });
      server.stop();
    });

    it('should answer OPTIONS without triggering an alarm action', async () => {
      const port = nextPort++;
      const server = createServer(port);
      server.start();
      await waitForListening();

      const result = await request(port, '/arm/away', 'OPTIONS', '');

      expect(result.statusCode).toBe(200);
      expect(result.headers['access-control-allow-origin']).toBe('*');
      expect(result.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
      expect(mockDisarmCallback).not.toHaveBeenCalled();
      expect(mockArmAwayCallback).not.toHaveBeenCalled();
      expect(mockArmNightCallback).not.toHaveBeenCalled();
      server.stop();
    });

    it('should return 404 for unknown endpoints', async () => {
      const port = nextPort++;
      const server = createServer(port);
      server.start();
      await waitForListening();

      const result = await request(port, '/unknown', 'POST', '');

      expect(result.statusCode).toBe(404);
      expect(result.body).toEqual({ error: 'Not found' });
      server.stop();
    });

    it('should return 404 for unsupported methods', async () => {
      const port = nextPort++;
      const server = createServer(port);
      server.start();
      await waitForListening();

      const result = await request(port, '/disarm', 'GET', '');

      expect(result.statusCode).toBe(404);
      server.stop();
    });
  });

  describe('stop', () => {
    it('should stop the server', async () => {
      const server = createServer(nextPort++);
      server.start();
      await waitForListening();

      server.stop();

      expect(mockLog.info).toHaveBeenCalledWith('HTTP API server stopped');
    });

    it('should handle stop when server is not running', () => {
      const server = createServer(nextPort++, undefined);
      server.stop();

      expect(mockLog.info).not.toHaveBeenCalledWith('HTTP API server stopped');
    });
  });
});
