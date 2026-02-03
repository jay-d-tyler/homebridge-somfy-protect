import { SomfyProtectPlatform } from '../src/platform.js';
import { SomfyProtectApi } from '../src/api.js';
import { SomfyProtectAlarmAccessory } from '../src/alarmAccessory.js';
import type { API, PlatformConfig, PlatformAccessory, Logging } from 'homebridge';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('../src/api.js');
jest.mock('../src/alarmAccessory.js');

describe('SomfyProtectPlatform', () => {
  let platform: SomfyProtectPlatform;
  let mockLogger: jest.Mocked<Logging>;
  let mockApi: jest.Mocked<API>;
  let mockSomfyApi: jest.Mocked<SomfyProtectApi>;
  let mockConfig: PlatformConfig;
  let didFinishLaunchingCallback: () => void;
  let shutdownCallback: () => void;

  const mockSites = [
    {
      site_id: 'site-1',
      name: 'Home',
      label: 'Home',
      brand: 'somfy',
      security_level: 'disarmed' as const,
    },
    {
      site_id: 'site-2',
      name: 'Office',
      label: 'Office',
      brand: 'somfy',
      security_level: 'armed' as const,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      success: jest.fn(),
    } as unknown as jest.Mocked<Logging>;

    // Mock API
    mockApi = {
      hap: {
        uuid: {
          generate: jest.fn((id) => `uuid-${id}`),
        },
        Service: { SecuritySystem: jest.fn(), AccessoryInformation: jest.fn() },
        Characteristic: {},
        Categories: {
          SECURITY_SYSTEM: 31,
        },
      },
      on: jest.fn((event, callback) => {
        if (event === 'didFinishLaunching') {
          didFinishLaunchingCallback = callback;
        } else if (event === 'shutdown') {
          shutdownCallback = callback;
        }
      }),
      platformAccessory: jest.fn((name, uuid) => ({
        UUID: uuid,
        displayName: name,
        context: {},
        getService: jest.fn(),
        addService: jest.fn(),
      })),
      registerPlatformAccessories: jest.fn(),
      updatePlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      user: {
        storagePath: jest.fn().mockReturnValue('/mock/storage'),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Mock config
    mockConfig = {
      platform: 'SomfyProtect',
      name: 'Somfy Protect',
      username: 'test@example.com',
      password: 'test-password',
    };

    // Mock Somfy API
    mockSomfyApi = {
      getSites: jest.fn().mockResolvedValue(mockSites),
      getSite: jest.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    (SomfyProtectApi as jest.Mock).mockImplementation(() => mockSomfyApi);

    platform = new SomfyProtectPlatform(mockLogger, mockConfig, mockApi);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(platform.log).toBe(mockLogger);
      expect(mockLogger.debug).toHaveBeenCalledWith('Finished initializing platform');
    });

    it('should register didFinishLaunching callback', () => {
      expect(mockApi.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
    });

    it('should register shutdown callback', () => {
      expect(mockApi.on).toHaveBeenCalledWith('shutdown', expect.any(Function));
    });

    it('should log error if username is missing', () => {
      const badConfig = { ...mockConfig, username: undefined };
      new SomfyProtectPlatform(mockLogger, badConfig, mockApi);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Username and password are required in config.json',
      );
    });

    it('should log error if password is missing', () => {
      const badConfig = { ...mockConfig, password: undefined };
      new SomfyProtectPlatform(mockLogger, badConfig, mockApi);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Username and password are required in config.json',
      );
    });
  });

  describe('configureAccessory', () => {
    it('should add accessory to accessories map', () => {
      const mockAccessory = {
        UUID: 'test-uuid',
        displayName: 'Test Accessory',
      } as PlatformAccessory;

      platform.configureAccessory(mockAccessory);

      expect(platform.accessories.get('test-uuid')).toBe(mockAccessory);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Loading accessory from cache:',
        'Test Accessory',
      );
    });
  });

  describe('discoverSites', () => {
    beforeEach(async () => {
      await didFinishLaunchingCallback();
      // Wait for async operations
      await Promise.resolve();
    });

    it('should discover and register all sites', async () => {
      expect(mockSomfyApi.getSites).toHaveBeenCalled();
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalledTimes(2);
      expect(SomfyProtectAlarmAccessory).toHaveBeenCalledTimes(2);
    });

    it('should warn if no sites found', async () => {
      mockSomfyApi.getSites.mockResolvedValueOnce([]);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No Somfy Protect sites found on your account',
      );
    });

    it('should use specific site if siteId is configured', async () => {
      const configWithSiteId = { ...mockConfig, siteId: 'site-2' };
      new SomfyProtectPlatform(
        mockLogger,
        configWithSiteId,
        mockApi,
      );

      // Get the callback for this platform
      const callbacks = (mockApi.on as jest.Mock).mock.calls;
      const launchCallback = callbacks.find(call => call[0] === 'didFinishLaunching')[1];

      await launchCallback();
      await Promise.resolve();

      expect(mockLogger.info).toHaveBeenCalledWith('Using configured site: Office');
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    });

    it('should error if configured siteId not found', async () => {
      const configWithBadSiteId = { ...mockConfig, siteId: 'nonexistent' };
      new SomfyProtectPlatform(
        mockLogger,
        configWithBadSiteId,
        mockApi,
      );

      const callbacks = (mockApi.on as jest.Mock).mock.calls;
      const launchCallback = callbacks.find(call => call[0] === 'didFinishLaunching')[1];

      await launchCallback();
      await Promise.resolve();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Configured site ID "nonexistent" not found',
      );
    });

    it('should warn if multiple sites detected without siteId', async () => {
      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Multiple sites detected'),
      );
    });

    it('should handle API errors and retry', async () => {
      mockSomfyApi.getSites.mockRejectedValueOnce(new Error('API error'));

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to discover Somfy Protect sites:',
        expect.any(Error),
      );

      // Verify retry is scheduled
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60000);
    });
  });

  describe('registerSite', () => {
    beforeEach(async () => {
      await didFinishLaunchingCallback();
      await Promise.resolve();
    });

    it('should create new accessory with correct category', () => {
      expect(mockApi.platformAccessory).toHaveBeenCalledWith(
        'Home',
        'uuid-site-1',
        mockApi.hap.Categories.SECURITY_SYSTEM,
      );
    });

    it('should register accessory with Homebridge', () => {
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalledWith(
        'homebridge-somfy-protect',
        'SomfyProtect',
        expect.any(Array),
      );
    });

    it('should create alarm accessory instance', () => {
      expect(SomfyProtectAlarmAccessory).toHaveBeenCalled();
    });

    it('should restore existing accessory from cache', () => {
      const existingAccessory = {
        UUID: 'uuid-site-1',
        displayName: 'Home',
        context: {},
        getService: jest.fn(),
        addService: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      platform.accessories.set('uuid-site-1', existingAccessory);

      // Trigger discovery again
      platform.registerSite(mockSites[0]);

      expect(mockApi.updatePlatformAccessories).toHaveBeenCalledWith([existingAccessory]);
      expect(mockLogger.info).toHaveBeenCalledWith('Restoring existing accessory:', 'Home');
    });
  });

  describe('removeStaleAccessories', () => {
    it('should remove accessories that no longer exist', async () => {
      // Add a stale accessory
      const staleAccessory = {
        UUID: 'uuid-stale',
        displayName: 'Stale Accessory',
        context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      platform.accessories.set('uuid-stale', staleAccessory);
      const mockAccessoryInstance = {
        destroy: jest.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      platform.accessoryInstances.set('uuid-stale', mockAccessoryInstance as any);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledWith(
        'homebridge-somfy-protect',
        'SomfyProtect',
        [staleAccessory],
      );
      expect(mockAccessoryInstance.destroy).toHaveBeenCalled();
      expect(platform.accessories.has('uuid-stale')).toBe(false);
    });
  });

  describe('polling', () => {
    beforeEach(async () => {
      await didFinishLaunchingCallback();
      await Promise.resolve();
    });

    it('should start polling after discovery', () => {
      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 10000);
    });

    it('should use custom polling interval from config', async () => {
      const customConfig = { ...mockConfig, pollingInterval: 15000 };
      new SomfyProtectPlatform(mockLogger, customConfig, mockApi);

      const callbacks = (mockApi.on as jest.Mock).mock.calls;
      const launchCallback = callbacks.find(call => call[0] === 'didFinishLaunching')[1];

      await launchCallback();
      await Promise.resolve();

      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 15000);
    });

    it('should emit siteUpdated events when polling', async () => {
      const updatedSite = { ...mockSites[0], security_level: 'armed' as const };
      mockSomfyApi.getSite.mockResolvedValue(updatedSite);

      const eventSpy = jest.fn();
      platform.events.on('siteUpdated', eventSpy);

      // Trigger poll
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(mockSomfyApi.getSite).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalledWith('site-1', updatedSite);
    });

    it('should handle polling errors gracefully', async () => {
      mockSomfyApi.getSite.mockRejectedValue(new Error('Polling error'));

      // Trigger poll
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Polling error (will retry):',
        'Polling error',
      );
    });

    it('should not create duplicate polling intervals', () => {
      const initialCallCount = (setInterval as jest.Mock).mock.calls.length;

      platform.startPolling();

      expect((setInterval as jest.Mock).mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('stopPolling', () => {
    beforeEach(async () => {
      await didFinishLaunchingCallback();
      await Promise.resolve();
    });

    it('should stop polling when called', () => {
      platform.stopPolling();

      expect(clearInterval).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Stopped status polling');
    });

    it('should handle multiple calls to stopPolling', () => {
      platform.stopPolling();
      platform.stopPolling();

      // Should not error
      expect(mockLogger.debug).toHaveBeenCalledWith('Stopped status polling');
    });
  });

  describe('graceful shutdown', () => {
    beforeEach(async () => {
      await didFinishLaunchingCallback();
      await Promise.resolve();
    });

    it('should cleanup on shutdown event', () => {
      const mockAccessoryInstance = {
        destroy: jest.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      platform.accessoryInstances.set('uuid-site-1', mockAccessoryInstance as any);

      shutdownCallback();

      expect(clearInterval).toHaveBeenCalled();
      expect(mockAccessoryInstance.destroy).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Homebridge is shutting down, cleaning up...',
      );
    });

    it('should remove all event listeners on shutdown', () => {
      shutdownCallback();

      const listenerCountAfter = platform.events.eventNames().length;
      expect(listenerCountAfter).toBe(0);
    });
  });

  describe('EventEmitter', () => {
    it('should have events property', () => {
      expect(platform.events).toBeInstanceOf(EventEmitter);
    });

    it('should allow subscribing to siteUpdated events', () => {
      const callback = jest.fn();
      platform.events.on('siteUpdated', callback);

      platform.events.emit('siteUpdated', 'site-1', mockSites[0]);

      expect(callback).toHaveBeenCalledWith('site-1', mockSites[0]);
    });
  });
});
