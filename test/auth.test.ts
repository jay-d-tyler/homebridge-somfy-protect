import { SomfyProtectAuth } from '../src/auth.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import type { Logging } from 'homebridge';

// Mock dependencies
jest.mock('axios');
jest.mock('fs');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('SomfyProtectAuth', () => {
  let auth: SomfyProtectAuth;
  let mockLogger: jest.Mocked<Logging>;
  const storagePath = '/test/storage';
  const username = 'test@example.com';
  const password = 'test-password';
  const serializeStoredToken = (token: object, storedUsername = username) => JSON.stringify({
    version: 1,
    username: storedUsername,
    token,
  });

  beforeEach(() => {
    // Reset implementations too — mockReturnValue(...) set in one test must not
    // leak into the next (clearAllMocks only clears call data)
    jest.resetAllMocks();

    // The auto-mock replaces isAxiosError with a stub returning undefined;
    // restore its real behavior so error-handling paths are exercised
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (payload: unknown) => !!(payload && typeof payload === 'object' && 'isAxiosError' in payload),
    );

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      success: jest.fn(),
    } as unknown as jest.Mocked<Logging>;

    // Mock axios.create to return a mock instance
    const mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);
  });

  describe('constructor', () => {
    it('should initialize with correct parameters', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
          headers: expect.objectContaining({
            'User-Agent': 'Homebridge-Somfy-Protect',
          }),
        }),
      );
    });

    it('should attempt to load cached token', () => {
      expect(mockedFs.existsSync).toHaveBeenCalled();
    });
  });

  describe('getAccessToken', () => {
    it('should request new token when no token exists', async () => {
      const mockToken = {
        access_token: 'test-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'test-refresh-token',
      };

      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: mockToken });

      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.writeFileSync = jest.fn();

      const token = await auth.getAccessToken();

      expect(token).toBe('test-access-token');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '',
        expect.stringContaining('grant_type=password'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Successfully authenticated with Somfy Protect',
      );
    });

    it('should use cached token if not expired', async () => {
      const cachedToken = {
        access_token: 'cached-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'cached-refresh',
        issuedAt: Date.now(),
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(serializeStoredToken(cachedToken));

      // Create new instance to trigger token loading
      auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);

      const token = await auth.getAccessToken();

      expect(token).toBe('cached-token');
      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should refresh token if expired', async () => {
      const expiredToken = {
        access_token: 'expired-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'refresh-token',
        issuedAt: Date.now() - 7200000, // 2 hours ago
      };

      const newToken = {
        access_token: 'refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'new-refresh-token',
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(serializeStoredToken(expiredToken));

      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: newToken });

      // Create new instance to trigger token loading
      auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);

      const token = await auth.getAccessToken();

      expect(token).toBe('refreshed-token');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '',
        expect.stringContaining('grant_type=refresh_token'),
      );
    });

    it('should handle authentication errors', async () => {
      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: {
          status: 401,
          data: { error_description: 'Invalid credentials' },
        },
        isAxiosError: true,
      });

      mockedFs.existsSync.mockReturnValue(false);

      await expect(auth.getAccessToken()).rejects.toThrow('Authentication failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Authentication failed:',
        'Invalid credentials',
      );
    });

    it('should request new token if refresh fails', async () => {
      const expiredToken = {
        access_token: 'expired-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'invalid-refresh',
        issuedAt: Date.now() - 7200000,
      };

      const newToken = {
        access_token: 'new-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'new-refresh',
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(serializeStoredToken(expiredToken));

      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post
        .mockRejectedValueOnce({ // Refresh fails
          response: { status: 400 },
          isAxiosError: true,
        })
        .mockResolvedValueOnce({ data: newToken }); // New token succeeds

      auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);

      const token = await auth.getAccessToken();

      expect(token).toBe('new-token');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Token refresh failed, requesting new token',
      );
    });

    it('should ignore a valid cached token belonging to a different account', async () => {
      const cachedToken = {
        access_token: 'other-account-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'other-account-refresh',
        issuedAt: Date.now(),
      };
      const newToken = {
        access_token: 'correct-account-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'correct-account-refresh',
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(serializeStoredToken(cachedToken, 'other@example.com'));
      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: newToken });

      auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);

      await expect(auth.getAccessToken()).resolves.toBe('correct-account-token');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '',
        expect.stringContaining('grant_type=password'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Ignoring cached authentication token for a different account',
      );
    });

    it('should ignore legacy unscoped token files', async () => {
      const legacyToken = {
        access_token: 'legacy-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'legacy-refresh',
        issuedAt: Date.now(),
      };
      const newToken = {
        access_token: 'new-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'new-refresh',
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(legacyToken));
      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: newToken });

      auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);

      await expect(auth.getAccessToken()).resolves.toBe('new-token');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Ignoring legacy or invalid cached authentication token',
      );
    });

    it('should share one token request across concurrent callers', async () => {
      const mockToken = {
        access_token: 'shared-token',
        expires_in: 3600,
        token_type: 'Bearer',
        refresh_token: 'shared-refresh',
      };
      let resolveToken!: (value: { data: typeof mockToken }) => void;
      const tokenResponse = new Promise<{ data: typeof mockToken }>((resolve) => {
        resolveToken = resolve;
      });
      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockReturnValue(tokenResponse);

      const first = auth.getAccessToken();
      const second = auth.getAccessToken();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);

      resolveToken({ data: mockToken });
      await expect(Promise.all([first, second])).resolves.toEqual([
        'shared-token',
        'shared-token',
      ]);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should reject malformed token responses', async () => {
      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { expires_in: 3600, token_type: 'Bearer' },
      });

      await expect(auth.getAccessToken()).rejects.toThrow(
        'Authentication server returned an invalid token response',
      );
    });
  });

  describe('forceRefresh', () => {
    it('should force token refresh', async () => {
      const currentToken = {
        access_token: 'current-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'current-refresh',
        issuedAt: Date.now(),
      };

      const refreshedToken = {
        access_token: 'force-refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'new-refresh',
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(serializeStoredToken(currentToken));

      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: refreshedToken });

      auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);

      await auth.forceRefresh();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '',
        expect.stringContaining('grant_type=refresh_token'),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Forcing token refresh');
    });

    it('should preserve the existing refresh token when rotation omits one', async () => {
      const currentToken = {
        access_token: 'current-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'keep-this-refresh-token',
        issuedAt: Date.now(),
      };
      const refreshedToken = {
        access_token: 'refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(serializeStoredToken(currentToken));
      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: refreshedToken });
      auth = new SomfyProtectAuth(mockLogger, username, password, storagePath);

      await auth.forceRefresh();

      const persistedToken = String((mockedFs.writeFileSync as jest.Mock).mock.calls[0][1]);
      expect(persistedToken).toContain('"refresh_token": "keep-this-refresh-token"');
    });
  });

  describe('clearToken', () => {
    it('should clear cached token file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.unlinkSync = jest.fn();

      auth.clearToken();

      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        path.join(storagePath, 'somfy-protect-token.json'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Cleared cached authentication token');
    });

    it('should handle errors when clearing token', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.unlinkSync = jest.fn().mockImplementation(() => {
        throw new Error('Permission denied');
      });

      auth.clearToken();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to clear cached token:',
        expect.any(Error),
      );
    });

    it('should not error if token file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      auth.clearToken();

      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('token persistence', () => {
    it('should save token to file after successful authentication', async () => {
      const mockToken = {
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'test-refresh',
      };

      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: mockToken });

      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync = jest.fn();
      mockedFs.writeFileSync = jest.fn();

      await auth.getAccessToken();

      const temporaryTokenPath = path.join(
        storagePath,
        `somfy-protect-token.json.${process.pid}.tmp`,
      );
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        temporaryTokenPath,
        expect.stringContaining('"username": "test@example.com"'),
        { mode: 0o600 },
      );
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        temporaryTokenPath,
        expect.stringContaining('"access_token": "test-token"'),
        { mode: 0o600 },
      );
      expect(mockedFs.renameSync).toHaveBeenCalledWith(
        temporaryTokenPath,
        path.join(storagePath, 'somfy-protect-token.json'),
      );
      expect(mockedFs.chmodSync).toHaveBeenCalledWith(temporaryTokenPath, 0o600);
      expect(mockedFs.chmodSync).toHaveBeenCalledWith(
        path.join(storagePath, 'somfy-protect-token.json'),
        0o600,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Saved authentication token to cache');
    });

    it('should create storage directory if it does not exist', async () => {
      const mockToken = {
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'all',
        refresh_token: 'test-refresh',
      };

      const mockAxiosInstance = (mockedAxios.create as jest.Mock).mock.results[0].value;
      mockAxiosInstance.post.mockResolvedValueOnce({ data: mockToken });

      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync = jest.fn();
      mockedFs.writeFileSync = jest.fn();

      await auth.getAccessToken();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
    });
  });
});
