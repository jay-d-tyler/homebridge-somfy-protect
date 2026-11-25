import { SomfyProtectPlatform } from '../src/platform.js';
import { SomfyProtectApi } from '../src/api.js';
import { SomfyProtectAlarmAccessory } from '../src/alarmAccessory.js';
import { HttpApiServer } from '../src/httpServer.js';
import type { API, PlatformConfig, PlatformAccessory, Logging } from 'homebridge';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('../src/api.js');
jest.mock('../src/alarmAccessory.js');
jest.mock('../src/httpServer.js');

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('SomfyProtectPlatform', () => {
  let platform: SomfyProtectPlatform;
  let mockLogger: jest.Mocked<Logging>;
  let mockApi: jest.Mocked<API>;
  let mockSomfyApi: jest.Mocked<SomfyProtectApi>;
  let mockConfig: PlatformConfig;
  let didFinishLaunchingCallback: () => void;
  let shutdownCallback: () => void;
  let randomSpy: jest.SpyInstance;

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
    // Legacy fake timers make setTimeout/setInterval jest mocks, which the
    // polling assertions below rely on
    jest.useFakeTimers({ legacyFakeTimers: true });
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

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
      oauthClientId: 'test-client-id',
      oauthClientSecret: 'test-client-secret',
    };

    // Mock Somfy API
    mockSomfyApi = {
      getSites: jest.fn().mockResolvedValue(mockSites),
      getSite: jest.fn().mockImplementation(
        (siteId: string) => Promise.resolve(mockSites.find(site => site.site_id === siteId)),
      ),
      setSecurityLevel: jest.fn().mockResolvedValue({
        task_id: 'task-1',
        site_id: 'site-1',
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    (SomfyProtectApi as jest.Mock).mockImplementation(() => mockSomfyApi);

    platform = new SomfyProtectPlatform(mockLogger, mockConfig, mockApi);
  });

  afterEach(() => {
    randomSpy.mockRestore();
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

    it.each([
      ['oauthClientId', undefined],
      ['oauthClientSecret', ' '],
    ])('should skip startup when %s is missing', (key, value) => {
      jest.mocked(mockApi.on).mockClear();
      new SomfyProtectPlatform(mockLogger, { ...mockConfig, [key]: value }, mockApi);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'OAuth Client ID and OAuth Client Secret are required in the Somfy Protect plugin settings',
      );
      expect(mockApi.on).not.toHaveBeenCalled();
      expect(SomfyProtectApi).not.toHaveBeenCalled();
      expect(HttpApiServer).not.toHaveBeenCalled();
    });

    it.each([
      ['pollingInterval', 1000],
      ['fastPollingInterval', 500],
      ['fastPollingDuration', 5000],
      ['httpPort', 70000],
      ['adaptivePolling', 'yes'],
      ['siteId', 123],
      ['httpToken', 123],
      ['httpHost', ''],
    ])('should reject invalid %s configuration', (key, value) => {
      new SomfyProtectPlatform(
        mockLogger,
        { ...mockConfig, [key]: value },
        mockApi,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid Somfy Protect configuration:'),
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
      expect(SomfyProtectApi).toHaveBeenCalledWith(mockLogger, {
        username: mockConfig.username,
        password: mockConfig.password,
        oauthClientId: mockConfig.oauthClientId,
        oauthClientSecret: mockConfig.oauthClientSecret,
      }, '/mock/storage');
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

      // Get the callback for this platform (the last one registered)
      const launchCalls = (mockApi.on as jest.Mock).mock.calls.filter(call => call[0] === 'didFinishLaunching');
      const launchCallback = launchCalls[launchCalls.length - 1][1];

      (mockApi.registerPlatformAccessories as jest.Mock).mockClear();
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

      const launchCalls = (mockApi.on as jest.Mock).mock.calls.filter(call => call[0] === 'didFinishLaunching');
      const launchCallback = launchCalls[launchCalls.length - 1][1];

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
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Retrying site discovery in 60000ms',
      );
    });

    it('should back off subsequent discovery retries', async () => {
      mockSomfyApi.getSites.mockRejectedValue(new Error('API error'));

      await didFinishLaunchingCallback();
      await flushPromises();
      jest.advanceTimersByTime(60000);
      await flushPromises();

      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 120000);
    });

    it('should cancel discovery retries during shutdown', async () => {
      mockSomfyApi.getSites.mockRejectedValueOnce(new Error('API error'));
      mockSomfyApi.getSites.mockClear();

      await didFinishLaunchingCallback();
      await flushPromises();
      expect(mockSomfyApi.getSites).toHaveBeenCalledTimes(1);

      shutdownCallback();
      jest.advanceTimersByTime(60000);
      await flushPromises();

      expect(mockSomfyApi.getSites).toHaveBeenCalledTimes(1);
    });

    it('should wire all three HTTP alarm callbacks', async () => {
      const httpConfig = {
        ...mockConfig,
        httpPort: 8582,
        httpToken: 'test-token',
        httpHost: '127.0.0.1',
      };
      new SomfyProtectPlatform(mockLogger, httpConfig, mockApi);
      const launchCalls = (mockApi.on as jest.Mock).mock.calls.filter(
        call => call[0] === 'didFinishLaunching',
      );
      const launchCallback = launchCalls[launchCalls.length - 1][1];

      await launchCallback();
      await flushPromises();

      const constructorCall = (HttpApiServer as jest.Mock).mock.calls.at(-1);
      expect(constructorCall?.slice(0, 3)).toEqual([
        mockLogger,
        8582,
        'test-token',
      ]);
      expect(constructorCall?.[6]).toBe('127.0.0.1');

      await constructorCall?.[3]();
      await constructorCall?.[4]();
      await constructorCall?.[5]();

      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledWith('site-1', 'disarmed');
      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledWith('site-1', 'armed');
      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledWith('site-1', 'partial');
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
        '@jay-d-tyler/homebridge-somfy-protect',
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (platform as any).registerSite(mockSites[0]);

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
      (platform as any).accessoryInstances.set('uuid-stale', mockAccessoryInstance as any);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledWith(
        '@jay-d-tyler/homebridge-somfy-protect',
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
      await flushPromises();
    });

    it('should start polling after discovery', () => {
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60000);
    });

    it('should use custom polling interval from config', async () => {
      const customConfig = { ...mockConfig, pollingInterval: 15000 };
      new SomfyProtectPlatform(mockLogger, customConfig, mockApi);

      const launchCalls = (mockApi.on as jest.Mock).mock.calls.filter(call => call[0] === 'didFinishLaunching');
      const launchCallback = launchCalls[launchCalls.length - 1][1];

      await launchCallback();
      await flushPromises();

      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 15000);
    });

    it('should emit siteUpdated events when polling', async () => {
      const updatedSite = { ...mockSites[0], security_level: 'armed' as const };
      mockSomfyApi.getSite.mockResolvedValue(updatedSite);

      const eventSpy = jest.fn();
      platform.events.on('siteUpdated', eventSpy);

      // Trigger poll
      jest.advanceTimersByTime(60000);
      await flushPromises();

      expect(mockSomfyApi.getSite).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalledWith('site-1', updatedSite, undefined);
    });

    it('should isolate a site polling error and continue with other sites', async () => {
      const updatedOffice = { ...mockSites[1], security_level: 'partial' as const };
      mockSomfyApi.getSite
        .mockRejectedValueOnce(new Error('Polling error'))
        .mockResolvedValueOnce(updatedOffice);
      mockSomfyApi.getSite.mockClear();
      const eventSpy = jest.fn();
      platform.events.on('siteUpdated', eventSpy);

      // Trigger poll
      jest.advanceTimersByTime(60000);
      await flushPromises();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Polling error for Home (will retry):',
        'Polling error',
      );
      expect(mockSomfyApi.getSite).toHaveBeenCalledTimes(2);
      expect(eventSpy).toHaveBeenCalledWith('site-2', updatedOffice, undefined);
    });

    it('should not overlap polling cycles when a request is still pending', async () => {
      let resolveFirstPoll!: (site: typeof mockSites[number]) => void;
      const pendingPoll = new Promise<typeof mockSites[number]>((resolve) => {
        resolveFirstPoll = resolve;
      });
      mockSomfyApi.getSite.mockReset();
      mockSomfyApi.getSite
        .mockReturnValueOnce(pendingPoll)
        .mockImplementation(
          (siteId: string) => Promise.resolve(mockSites.find(site => site.site_id === siteId)!),
        );

      jest.advanceTimersByTime(60000);
      await flushPromises();
      expect(mockSomfyApi.getSite).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(300000);
      await flushPromises();
      expect(mockSomfyApi.getSite).toHaveBeenCalledTimes(1);

      resolveFirstPoll(mockSites[0]);
      await flushPromises();
      expect(mockSomfyApi.getSite).toHaveBeenCalledTimes(2);
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 60000);
    });

    it('should switch a scheduled poll to the fast interval after a command', () => {
      platform.requestFastPolling('site-1', 'armed');

      expect(clearTimeout).toHaveBeenCalled();
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);
    });

    it('should leave polling unchanged when adaptive polling is disabled', async () => {
      const fixedConfig = { ...mockConfig, adaptivePolling: false };
      const fixedPlatform = new SomfyProtectPlatform(mockLogger, fixedConfig, mockApi);
      const launchCalls = (mockApi.on as jest.Mock).mock.calls.filter(call => call[0] === 'didFinishLaunching');
      const launchCallback = launchCalls[launchCalls.length - 1][1];
      await launchCallback();
      await flushPromises();
      (clearTimeout as jest.Mock).mockClear();

      fixedPlatform.requestFastPolling('site-1', 'armed');

      expect(clearTimeout).not.toHaveBeenCalled();
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 60000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((fixedPlatform as any).pendingTargets.get('site-1').state).toBe('armed');
    });

    it('should not create duplicate polling schedules', () => {
      const initialCallCount = (setTimeout as unknown as jest.Mock).mock.calls.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (platform as any).startPolling();

      expect((setTimeout as unknown as jest.Mock).mock.calls.length).toBe(initialCallCount);
    });

    it('should keep a pending command separate from the last observed state', async () => {
      const eventSpy = jest.fn();
      platform.events.on('siteUpdated', eventSpy);
      platform.requestFastPolling('site-1', 'armed');

      jest.advanceTimersByTime(1000);
      await flushPromises();

      expect(eventSpy).toHaveBeenCalledWith('site-1', mockSites[0], 'armed');
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('changed from armed to disarmed'),
      );
    });

    it('should clear a pending command when polling confirms it', async () => {
      const armedHome = { ...mockSites[0], security_level: 'armed' as const };
      mockSomfyApi.getSite.mockImplementation(
        (siteId: string) => Promise.resolve(siteId === 'site-1' ? armedHome : mockSites[1]),
      );
      const eventSpy = jest.fn();
      platform.events.on('siteUpdated', eventSpy);
      platform.requestFastPolling('site-1', 'armed');

      jest.advanceTimersByTime(1000);
      await flushPromises();

      expect(eventSpy).toHaveBeenCalledWith('site-1', armedHome, undefined);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Confirmed requested security level for Home: armed',
      );
    });

    it('should abandon a pending command after its confirmation timeout', async () => {
      const eventSpy = jest.fn();
      platform.events.on('siteUpdated', eventSpy);
      platform.requestFastPolling('site-1', 'armed');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (platform as any).pendingTargets.get('site-1').requestedAt = Date.now() - 60000;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (platform as any).pollStatus();

      expect(eventSpy).toHaveBeenCalledWith('site-1', mockSites[0], undefined);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Requested security level for Home was not observed before the confirmation timeout',
      );
    });
  });

  describe('HTTP alarm commands', () => {
    beforeEach(async () => {
      await didFinishLaunchingCallback();
      await flushPromises();
    });

    it.each([
      ['disarmed', 'disarmed'],
      ['armed', 'armed'],
      ['partial', 'partial'],
    ] as const)('should set every site to %s', async (_label, level) => {
      const eventSpy = jest.fn();
      platform.events.on('siteUpdated', eventSpy);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (platform as any).setAllAlarmsSecurityLevel(level);

      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledTimes(2);
      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledWith('site-1', level);
      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledWith('site-2', level);
      expect(eventSpy).toHaveBeenCalledWith('site-1', mockSites[0], level);
      expect(eventSpy).toHaveBeenCalledWith('site-2', mockSites[1], level);
      expect(platform.accessories.get('uuid-site-1')?.context.pendingTarget).toBe(level);
    });

    it('should skip a fresh site that is already in the requested state', async () => {
      const homeAccessory = platform.accessories.get('uuid-site-1')!;
      homeAccessory.context.lastUpdate = Date.now();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (platform as any).setAllAlarmsSecurityLevel('disarmed');

      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledTimes(1);
      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledWith('site-2', 'disarmed');
      expect(mockSomfyApi.setSecurityLevel).not.toHaveBeenCalledWith('site-1', 'disarmed');
    });

    it('should not trust an already-correct state when its cache is stale', async () => {
      const homeAccessory = platform.accessories.get('uuid-site-1')!;
      homeAccessory.context.lastUpdate = Date.now() - 300000;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (platform as any).setAllAlarmsSecurityLevel('disarmed');

      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledWith('site-1', 'disarmed');
    });

    it('should reject the overall operation when one site fails', async () => {
      mockSomfyApi.setSecurityLevel.mockImplementation((siteId: string) => {
        if (siteId === 'site-2') {
          return Promise.reject(new Error('Office failed'));
        }
        return Promise.resolve({ task_id: 'task-1', site_id: siteId });
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((platform as any).setAllAlarmsSecurityLevel('armed')).rejects.toThrow(
        'Office failed',
      );
      expect(mockSomfyApi.setSecurityLevel).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to set Office to armed:',
        expect.any(Error),
      );
    });
  });

  describe('stopPolling', () => {
    beforeEach(async () => {
      await didFinishLaunchingCallback();
      await flushPromises();
    });

    it('should stop polling when called', () => {
      platform.stopPolling();

      expect(clearTimeout).toHaveBeenCalled();
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
      await flushPromises();
    });

    it('should cleanup on shutdown event', () => {
      const mockAccessoryInstance = {
        destroy: jest.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (platform as any).accessoryInstances.set('uuid-site-1', mockAccessoryInstance as any);

      shutdownCallback();

      expect(clearTimeout).toHaveBeenCalled();
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
