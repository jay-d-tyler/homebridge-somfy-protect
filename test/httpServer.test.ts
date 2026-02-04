import { HttpApiServer } from '../src/httpServer.js';
import type { Logging } from 'homebridge';
import http from 'http';

describe('HttpApiServer', () => {
  let mockLog: jest.Mocked<Logging>;
  let mockDisarmCallback: jest.Mock;

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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('should not start server when port is 0', () => {
      const server = new HttpApiServer(mockLog, 0, undefined, mockDisarmCallback);
      server.start();

      expect(mockLog.info).toHaveBeenCalledWith('HTTP API disabled (port set to 0)');
    });

    it('should start server on specified port', (done) => {
      const server = new HttpApiServer(mockLog, 8581, undefined, mockDisarmCallback);
      server.start();

      // Wait for server to start
      setTimeout(() => {
        expect(mockLog.info).toHaveBeenCalledWith('HTTP API server listening on port 8581');
        expect(mockLog.info).toHaveBeenCalledWith('Available endpoint: POST /disarm');
        server.stop();
        done();
      }, 100);
    });

    it('should log warning when authentication is disabled', (done) => {
      const server = new HttpApiServer(mockLog, 8582, undefined, mockDisarmCallback);
      server.start();

      setTimeout(() => {
        expect(mockLog.warn).toHaveBeenCalledWith(
          'HTTP API authentication disabled - anyone on your network can trigger disarm',
        );
        server.stop();
        done();
      }, 100);
    });

    it('should log info when authentication is enabled', (done) => {
      const server = new HttpApiServer(mockLog, 8583, 'test-token', mockDisarmCallback);
      server.start();

      setTimeout(() => {
        expect(mockLog.info).toHaveBeenCalledWith('HTTP API authentication enabled');
        server.stop();
        done();
      }, 100);
    });
  });

  describe('POST /disarm endpoint', () => {
    it('should successfully disarm without authentication', (done) => {
      const server = new HttpApiServer(mockLog, 8584, undefined, mockDisarmCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8584,
          path: '/disarm',
          method: 'POST',
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(data)).toEqual({
              success: true,
              message: 'Disarm command sent',
            });
            expect(mockDisarmCallback).toHaveBeenCalled();
            expect(mockLog.info).toHaveBeenCalledWith('HTTP API: Disarm command received');
            expect(mockLog.info).toHaveBeenCalledWith('HTTP API: Disarm command successful');
            server.stop();
            done();
          });
        });

        req.on('error', done);
        req.end();
      }, 100);
    });

    it('should successfully disarm with valid token', (done) => {
      const server = new HttpApiServer(mockLog, 8585, 'valid-token', mockDisarmCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8585,
          path: '/disarm',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        };

        const req = http.request(options, (res) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            expect(res.statusCode).toBe(200);
            expect(mockDisarmCallback).toHaveBeenCalled();
            server.stop();
            done();
          });
        });

        req.on('error', done);
        req.end();
      }, 100);
    });

    it('should reject request with invalid token', (done) => {
      const server = new HttpApiServer(mockLog, 8586, 'valid-token', mockDisarmCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8586,
          path: '/disarm',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer invalid-token',
          },
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            expect(res.statusCode).toBe(401);
            expect(JSON.parse(data)).toEqual({ error: 'Unauthorized' });
            expect(mockDisarmCallback).not.toHaveBeenCalled();
            expect(mockLog.warn).toHaveBeenCalledWith('Unauthorized HTTP API request (invalid token)');
            server.stop();
            done();
          });
        });

        req.on('error', done);
        req.end();
      }, 100);
    });

    it('should reject request without token when token is required', (done) => {
      const server = new HttpApiServer(mockLog, 8587, 'required-token', mockDisarmCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8587,
          path: '/disarm',
          method: 'POST',
        };

        const req = http.request(options, (res) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            expect(res.statusCode).toBe(401);
            expect(mockDisarmCallback).not.toHaveBeenCalled();
            server.stop();
            done();
          });
        });

        req.on('error', done);
        req.end();
      }, 100);
    });

    it('should handle disarm callback errors', (done) => {
      const errorCallback = jest.fn().mockRejectedValue(new Error('Disarm failed'));
      const server = new HttpApiServer(mockLog, 8588, undefined, errorCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8588,
          path: '/disarm',
          method: 'POST',
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            expect(res.statusCode).toBe(500);
            expect(JSON.parse(data)).toEqual({ error: 'Failed to disarm alarm' });
            expect(mockLog.error).toHaveBeenCalledWith(
              'HTTP API: Failed to disarm:',
              expect.any(Error),
            );
            server.stop();
            done();
          });
        });

        req.on('error', done);
        req.end();
      }, 100);
    });

    it('should handle OPTIONS preflight requests', (done) => {
      const server = new HttpApiServer(mockLog, 8589, undefined, mockDisarmCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8589,
          path: '/disarm',
          method: 'OPTIONS',
        };

        const req = http.request(options, (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['access-control-allow-origin']).toBe('*');
          expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
          server.stop();
          done();
        });

        req.on('error', done);
        req.end();
      }, 100);
    });

    it('should return 404 for unknown endpoints', (done) => {
      const server = new HttpApiServer(mockLog, 8590, undefined, mockDisarmCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8590,
          path: '/unknown',
          method: 'POST',
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            expect(res.statusCode).toBe(404);
            expect(JSON.parse(data)).toEqual({ error: 'Not found' });
            expect(mockDisarmCallback).not.toHaveBeenCalled();
            server.stop();
            done();
          });
        });

        req.on('error', done);
        req.end();
      }, 100);
    });

    it('should return 404 for GET requests', (done) => {
      const server = new HttpApiServer(mockLog, 8591, undefined, mockDisarmCallback);
      server.start();

      setTimeout(() => {
        const options = {
          hostname: 'localhost',
          port: 8591,
          path: '/disarm',
          method: 'GET',
        };

        const req = http.request(options, (res) => {
          expect(res.statusCode).toBe(404);
          expect(mockDisarmCallback).not.toHaveBeenCalled();
          server.stop();
          done();
        });

        req.on('error', done);
        req.end();
      }, 100);
    });
  });

  describe('stop', () => {
    it('should stop the server', (done) => {
      const server = new HttpApiServer(mockLog, 8592, undefined, mockDisarmCallback);
      server.start();

      setTimeout(() => {
        server.stop();
        expect(mockLog.info).toHaveBeenCalledWith('HTTP API server stopped');
        done();
      }, 100);
    });

    it('should handle stop when server is not running', () => {
      const server = new HttpApiServer(mockLog, 8593, undefined, mockDisarmCallback);
      server.stop(); // Should not throw
      expect(mockLog.info).not.toHaveBeenCalledWith('HTTP API server stopped');
    });
  });
});
