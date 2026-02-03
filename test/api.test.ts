import { SomfyProtectApi } from '../src/api.js';
import { SomfyProtectAuth } from '../src/auth.js';
import axios from 'axios';
import type { Logging } from 'homebridge';
import type { Site, Device, SecurityLevel } from '../src/types.js';

// Mock dependencies
jest.mock('axios');
jest.mock('../src/auth.js');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SomfyProtectApi', () => {
  let api: SomfyProtectApi;
  let mockLogger: jest.Mocked<Logging>;
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
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // Mock auth
    mockAuth = {
      getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
      forceRefresh: jest.fn(),
      clearToken: jest.fn(),
    } as any;

    (SomfyProtectAuth as jest.Mock).mockImplementation(() => mockAuth);

    api = new SomfyProtectApi(mockLogger, 'test@example.com', 'password', '/storage');
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
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
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

    it('should handle errors when fetching sites', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(api.getSites()).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get sites:',
        expect.any(Error),
      );
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
        "Setting security level to 'armed' for site site-1",
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

  describe('stopAlarm', () => {
    it('should stop alarm successfully', async () => {
      mockAxiosInstance.put.mockResolvedValueOnce({ data: {} });

      await api.stopAlarm('site-1');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/v3/site/site-1/alarm/stop',
        {},
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Stopping alarm for site site-1');
    });

    it('should handle errors when stopping alarm', async () => {
      mockAxiosInstance.put.mockRejectedValueOnce(new Error('Stop failed'));

      await expect(api.stopAlarm('site-1')).rejects.toThrow('Stop failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to stop alarm for site site-1:',
        expect.any(Error),
      );
    });
  });

  describe('triggerPanic', () => {
    it('should trigger panic alarm', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

      await api.triggerPanic('site-1', 'alarm');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/v3/site/site-1/panic',
        { type: 'alarm' },
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Triggering alarm panic for site site-1');
    });

    it('should trigger silent panic', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

      await api.triggerPanic('site-1', 'silent');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/v3/site/site-1/panic',
        { type: 'silent' },
      );
      expect(mockLogger.warn).toHaveBeenCalledWith('Triggering silent panic for site site-1');
    });

    it('should default to alarm mode if not specified', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

      await api.triggerPanic('site-1');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/v3/site/site-1/panic',
        { type: 'alarm' },
      );
    });
  });

  describe('getDevices', () => {
    it('should fetch all devices for a site', async () => {
      const mockDevices: Device[] = [
        {
          device_id: 'device-1',
          site_id: 'site-1',
          box_id: 'box-1',
          label: 'Motion Sensor',
          device_definition: {
            device_definition_id: 'def-1',
            type: 'pir',
            label: 'PIR',
          },
        },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { items: mockDevices },
      });

      const devices = await api.getDevices('site-1');

      expect(devices).toEqual(mockDevices);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v3/site/site-1/device');
      expect(mockLogger.debug).toHaveBeenCalledWith('Fetching devices for site site-1');
    });
  });

  describe('getDevice', () => {
    it('should fetch specific device', async () => {
      const mockDevice: Device = {
        device_id: 'device-1',
        site_id: 'site-1',
        box_id: 'box-1',
        label: 'Camera',
        device_definition: {
          device_definition_id: 'def-1',
          type: 'indoor_camera',
          label: 'Indoor Camera',
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockDevice,
      });

      const device = await api.getDevice('site-1', 'device-1');

      expect(device).toEqual(mockDevice);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v3/site/site-1/device/device-1');
      expect(mockLogger.debug).toHaveBeenCalledWith('Fetching device device-1 for site site-1');
    });
  });

  describe('clearAuthToken', () => {
    it('should clear authentication token', () => {
      api.clearAuthToken();

      expect(mockAuth.clearToken).toHaveBeenCalled();
    });
  });
});
