import { SomfyProtectApi } from '../src/api.js';
import { SomfyProtectAuth } from '../src/auth.js';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import type { Logging } from 'homebridge';
import type { Site } from '../src/types.js';

// Mock dependencies
jest.mock('axios');
jest.mock('axios-retry', () => {
  const retry = jest.fn();
  Object.assign(retry, {
    isIdempotentRequestError: jest.fn(),
  });
  return {
    __esModule: true,
    default: retry,
  };
});
jest.mock('../src/auth.js');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedAxiosRetry = jest.mocked(axiosRetry);
const mockedIsIdempotentRequestError = jest.mocked(axiosRetry.isIdempotentRequestError);

describe('SomfyProtectApi', () => {
  let api: SomfyProtectApi;
  let mockLogger: jest.Mocked<Logging>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAxiosInstance: any;
  let mockAuth: jest.Mocked<SomfyProtectAuth>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      success: jest.fn(),
    } as unknown as jest.Mocked<Logging>;

    // Mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);
    mockedIsIdempotentRequestError.mockReturnValue(false);

    // Mock auth
    mockAuth = {
      getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
      forceRefresh: jest.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    (SomfyProtectAuth as jest.Mock).mockImplementation(() => mockAuth);

    api = new SomfyProtectApi(mockLogger, {
      username: 'test@example.com',
      password: 'password',
      oauthClientId: 'test-client-id',
      oauthClientSecret: 'test-client-secret',
    }, '/storage');
  });

  describe('constructor', () => {
    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.myfox.io',
          timeout: 30000,
          headers: expect.objectContaining({
            'User-Agent': 'Homebridge-Somfy-Protect',
          }),
        }),
      );
    });

    it('should configure retry logic', () => {
      expect(mockedAxiosRetry).toHaveBeenCalledWith(
        mockAxiosInstance,
        expect.objectContaining({
          retries: 3,
          retryCondition: expect.any(Function),
        }),
      );
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it('should delegate retries to the idempotent-request policy', () => {
      const retryOptions = mockedAxiosRetry.mock.calls[0][1]!;
      const error = {
        config: { method: 'post' },
        response: { status: 500 },
      };

      mockedIsIdempotentRequestError.mockReturnValue(false);
      expect(retryOptions.retryCondition!(error as never)).toBe(false);

      mockedIsIdempotentRequestError.mockReturnValue(true);
      expect(retryOptions.retryCondition!(error as never)).toBe(true);
      expect(mockedIsIdempotentRequestError).toHaveBeenCalledWith(error);
    });

    it('should add a bearer token in the request interceptor', async () => {
      const requestHandler = mockAxiosInstance.interceptors.request.use.mock.calls[0][0];
      const config = { headers: {} };

      await expect(requestHandler(config)).resolves.toBe(config);
      expect(config.headers).toEqual({ Authorization: 'Bearer mock-access-token' });
    });

    it('should retry a 401 only once after refreshing the token', async () => {
      const responseErrorHandler = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const config = { headers: {} };
      const retriedResponse = { data: { ok: true } };
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockAuth.getAccessToken.mockResolvedValue('refreshed-access-token');
      mockAxiosInstance.request.mockResolvedValue(retriedResponse);

      await expect(responseErrorHandler({
        config,
        response: { status: 401, data: {} },
        message: 'Unauthorized',
      })).resolves.toBe(retriedResponse);

      expect(mockAuth.forceRefresh).toHaveBeenCalledTimes(1);
      expect(config).toEqual({
        headers: { Authorization: 'Bearer refreshed-access-token' },
        _authRetried: true,
      });

      await expect(responseErrorHandler({
        config,
        response: { status: 401, data: {} },
        message: 'Still unauthorized',
      })).rejects.toThrow('Still unauthorized');
      expect(mockAuth.forceRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSites', () => {
    it('should fetch all sites successfully', async () => {
      const mockSites: Site[] = [
        {
          site_id: 'site-1',
          name: 'Home',
          label: 'Home',
          brand: 'somfy',
          security_level: 'disarmed',
        },
        {
          site_id: 'site-2',
          name: 'Office',
          label: 'Office',
          brand: 'somfy',
          security_level: 'armed',
        },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { items: mockSites },
      });

      const sites = await api.getSites();

      expect(sites).toEqual(mockSites);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v3/site');
      expect(mockLogger.debug).toHaveBeenCalledWith('Fetching all sites');
    });

    it('should accept the current Somfy site shape with an object brand', async () => {
      const liveSite = {
        site_id: 'site-1',
        label: 'Home',
        security_level: 'disarmed',
        brand: {
          brand_id: 'somfy_protect',
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { items: [liveSite] },
      });

      await expect(api.getSites()).resolves.toEqual([liveSite]);
    });

    it('should use the site name when the optional label is absent', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          items: [{
            site_id: 'site-1',
            name: 'Home',
            security_level: 'disarmed',
          }],
        },
      });

      await expect(api.getSites()).resolves.toEqual([
        expect.objectContaining({
          site_id: 'site-1',
          label: 'Home',
          security_level: 'disarmed',
        }),
      ]);
    });

    it('should generate a stable label when Somfy omits both display names', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          items: [{
            site_id: 'site-123456789',
            security_level: 'disarmed',
          }],
        },
      });

      await expect(api.getSites()).resolves.toEqual([
        expect.objectContaining({
          label: 'Somfy Protect (site-123)',
        }),
      ]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Somfy site site-123456789 has no label; using "Somfy Protect (site-123)"',
      );
    });

    it('should handle errors when fetching sites', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(api.getSites()).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get sites:',
        expect.any(Error),
      );
    });

    it('should reject malformed site collections', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { items: null },
      });

      await expect(api.getSites()).rejects.toThrow('invalid sites response');
    });

    it('should reject unknown security levels in site collections', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          items: [{
            site_id: 'site-1',
            name: 'Home',
            label: 'Home',
            brand: 'somfy',
            security_level: 'mystery',
          }],
        },
      });

      await expect(api.getSites()).rejects.toThrow('unknown security level');
    });
  });

  describe('getSite', () => {
    it('should fetch specific site successfully', async () => {
      const mockSite: Site = {
        site_id: 'site-1',
        name: 'Home',
        label: 'Home',
        brand: 'somfy',
        security_level: 'disarmed',
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockSite,
      });

      const site = await api.getSite('site-1');

      expect(site).toEqual(mockSite);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v3/site/site-1');
      expect(mockLogger.debug).toHaveBeenCalledWith('Fetching site site-1');
    });

    it('should reject an unknown security level', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          site_id: 'site-1',
          name: 'Home',
          label: 'Home',
          brand: 'somfy',
          security_level: 'unknown',
        },
      });

      await expect(api.getSite('site-1')).rejects.toThrow('unknown security level');
    });

    it('should reject a site without an identifier', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          label: 'Home',
          security_level: 'disarmed',
        },
      });

      await expect(api.getSite('site-1')).rejects.toThrow('missing site_id');
    });

    it('should reject a malformed site object', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: null,
      });

      await expect(api.getSite('site-1')).rejects.toThrow('invalid site response');
    });
  });

  describe('setSecurityLevel', () => {
    it('should set security level to armed', async () => {
      const mockResponse = { task_id: 'task-123', site_id: 'site-1' };

      mockAxiosInstance.put.mockResolvedValueOnce({
        data: mockResponse,
      });

      const result = await api.setSecurityLevel('site-1', 'armed');

      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/v3/site/site-1/security',
        { status: 'armed' },
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Setting security level to \'armed\' for site site-1',
      );
    });

    it('should set security level to partial', async () => {
      const mockResponse = { task_id: 'task-456', site_id: 'site-1' };

      mockAxiosInstance.put.mockResolvedValueOnce({
        data: mockResponse,
      });

      await api.setSecurityLevel('site-1', 'partial');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/v3/site/site-1/security',
        { status: 'partial' },
      );
    });

    it('should set security level to disarmed', async () => {
      const mockResponse = { task_id: 'task-789', site_id: 'site-1' };

      mockAxiosInstance.put.mockResolvedValueOnce({
        data: mockResponse,
      });

      await api.setSecurityLevel('site-1', 'disarmed');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/v3/site/site-1/security',
        { status: 'disarmed' },
      );
    });

    it('should handle errors when setting security level', async () => {
      mockAxiosInstance.put.mockRejectedValueOnce(new Error('API error'));

      await expect(api.setSecurityLevel('site-1', 'armed')).rejects.toThrow('API error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to set security level for site site-1:',
        expect.any(Error),
      );
    });
  });

});
