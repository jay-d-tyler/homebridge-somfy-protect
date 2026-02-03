import { SomfyProtectAlarmAccessory } from '../src/alarmAccessory.js';
import type { SomfyProtectPlatform } from '../src/platform.js';
import type { SomfyProtectApi } from '../src/api.js';
import type { PlatformAccessory, Service } from 'homebridge';
import { EventEmitter } from 'events';

describe('SomfyProtectAlarmAccessory', () => {
  let accessory: SomfyProtectAlarmAccessory;
  let mockPlatform: jest.Mocked<SomfyProtectPlatform>;
  let mockAccessory: jest.Mocked<PlatformAccessory>;
  let mockApi: jest.Mocked<SomfyProtectApi>;
  let mockService: jest.Mocked<Service>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCharacteristic: any;

  const mockSite = {
    site_id: 'test-site-id',
    name: 'Test Home',
    label: 'Test Home',
    brand: 'somfy',
    security_level: 'disarmed' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock characteristic
    mockCharacteristic = {
      SecuritySystemCurrentState: {
        STAY_ARM: 0,
        AWAY_ARM: 1,
        NIGHT_ARM: 2,
        DISARMED: 3,
        ALARM_TRIGGERED: 4,
      },
      SecuritySystemTargetState: {
        STAY_ARM: 0,
        AWAY_ARM: 1,
        NIGHT_ARM: 2,
        DISARM: 3,
      },
      StatusFault: {
        NO_FAULT: 0,
        GENERAL_FAULT: 1,
      },
    };

    // Mock service
    mockService = {
      getCharacteristic: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn().mockReturnThis(),
      setCharacteristic: jest.fn().mockReturnThis(),
      setProps: jest.fn().mockReturnThis(),
      onGet: jest.fn().mockReturnThis(),
      onSet: jest.fn().mockReturnThis(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Mock platform
    mockPlatform = {
      Service: { SecuritySystem: jest.fn(), AccessoryInformation: jest.fn() },
      Characteristic: mockCharacteristic,
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
      events: new EventEmitter(),
      homebridgeApi: {
        hap: {
          HapStatusError: class HapStatusError extends Error {
            constructor(public statusCode: number) {
              super();
            }
          },
          HAPStatus: {
            SERVICE_COMMUNICATION_FAILURE: -70402,
          },
        },
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Mock accessory
    const mockInfoService = {
      setCharacteristic: jest.fn().mockReturnThis(),
    };

    mockAccessory = {
      context: {
        site: mockSite,
        lastUpdate: Date.now(),
      },
      getService: jest.fn((service) => {
        if (service === mockPlatform.Service.AccessoryInformation) {
          return mockInfoService;
        }
        return mockService;
      }),
      addService: jest.fn().mockReturnValue(mockService),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Mock API
    mockApi = {
      setSecurityLevel: jest.fn().mockResolvedValue({ task_id: 'task-1', site_id: 'test-site-id' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    accessory = new SomfyProtectAlarmAccessory(mockPlatform, mockAccessory, mockApi);
  });

  describe('constructor', () => {
    it('should set accessory information', () => {
      const infoService = mockAccessory.getService(mockPlatform.Service.AccessoryInformation);
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.Manufacturer,
        'Somfy',
      );
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.FirmwareRevision,
        '2.0.0',
      );
    });

    it('should register characteristic handlers', () => {
      expect(mockService.getCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.SecuritySystemCurrentState,
      );
      expect(mockService.getCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.SecuritySystemTargetState,
      );
      expect(mockService.getCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.StatusFault,
      );
    });

    it('should set valid values for characteristics', () => {
      expect(mockService.setProps).toHaveBeenCalledWith({
        validValues: [
          mockCharacteristic.SecuritySystemCurrentState.STAY_ARM,
          mockCharacteristic.SecuritySystemCurrentState.AWAY_ARM,
          mockCharacteristic.SecuritySystemCurrentState.DISARMED,
          mockCharacteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        ],
      });
    });

    it('should listen for siteUpdated events', () => {
      expect(mockPlatform.events.listenerCount('siteUpdated')).toBeGreaterThan(0);
    });
  });

  describe('state conversion', () => {
    it('should convert armed to AWAY_ARM', async () => {
      mockAccessory.context.site.security_level = 'armed';
      const state = await accessory.getCurrentState();
      expect(state).toBe(mockCharacteristic.SecuritySystemCurrentState.AWAY_ARM);
    });

    it('should convert partial to STAY_ARM', async () => {
      mockAccessory.context.site.security_level = 'partial';
      const state = await accessory.getCurrentState();
      expect(state).toBe(mockCharacteristic.SecuritySystemCurrentState.STAY_ARM);
    });

    it('should convert disarmed to DISARMED', async () => {
      mockAccessory.context.site.security_level = 'disarmed';
      const state = await accessory.getCurrentState();
      expect(state).toBe(mockCharacteristic.SecuritySystemCurrentState.DISARMED);
    });
  });

  describe('getCurrentState', () => {
    it('should return current state successfully', async () => {
      mockAccessory.context.site.security_level = 'armed';
      mockAccessory.context.lastUpdate = Date.now();

      const state = await accessory.getCurrentState();

      expect(state).toBe(mockCharacteristic.SecuritySystemCurrentState.AWAY_ARM);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Getting current state'),
      );
    });

    it('should throw error if data is stale', async () => {
      mockAccessory.context.lastUpdate = Date.now() - 120000; // 2 minutes ago

      await expect(accessory.getCurrentState()).rejects.toThrow();
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.StatusFault,
        mockCharacteristic.StatusFault.GENERAL_FAULT,
      );
    });

    it('should throw error if no lastUpdate exists', async () => {
      mockAccessory.context.lastUpdate = undefined;

      await expect(accessory.getCurrentState()).rejects.toThrow();
    });
  });

  describe('getTargetState', () => {
    it('should return target state successfully', async () => {
      mockAccessory.context.site.security_level = 'partial';

      const state = await accessory.getTargetState();

      expect(state).toBe(mockCharacteristic.SecuritySystemTargetState.STAY_ARM);
    });
  });

  describe('setTargetState', () => {
    it('should set target state to AWAY_ARM', async () => {
      const targetState = mockCharacteristic.SecuritySystemTargetState.AWAY_ARM;

      await accessory.setTargetState(targetState);

      expect(mockApi.setSecurityLevel).toHaveBeenCalledWith('test-site-id', 'armed');
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.SecuritySystemCurrentState,
        mockCharacteristic.SecuritySystemCurrentState.AWAY_ARM,
      );
      expect(mockPlatform.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully set'),
      );
    });

    it('should set target state to STAY_ARM', async () => {
      const targetState = mockCharacteristic.SecuritySystemTargetState.STAY_ARM;

      await accessory.setTargetState(targetState);

      expect(mockApi.setSecurityLevel).toHaveBeenCalledWith('test-site-id', 'partial');
    });

    it('should set target state to DISARM', async () => {
      const targetState = mockCharacteristic.SecuritySystemTargetState.DISARM;

      await accessory.setTargetState(targetState);

      expect(mockApi.setSecurityLevel).toHaveBeenCalledWith('test-site-id', 'disarmed');
    });

    it('should handle API errors and revert state', async () => {
      const targetState = mockCharacteristic.SecuritySystemTargetState.AWAY_ARM;
      mockApi.setSecurityLevel.mockRejectedValueOnce(new Error('API error'));

      await expect(accessory.setTargetState(targetState)).rejects.toThrow();

      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.SecuritySystemTargetState,
        expect.any(Number),
      );
    });
  });

  describe('getStatusFault', () => {
    it('should return NO_FAULT when data is fresh', async () => {
      mockAccessory.context.lastUpdate = Date.now();

      const fault = await accessory.getStatusFault();

      expect(fault).toBe(mockCharacteristic.StatusFault.NO_FAULT);
    });

    it('should return GENERAL_FAULT when data is stale', async () => {
      mockAccessory.context.lastUpdate = Date.now() - 120000; // 2 minutes ago

      const fault = await accessory.getStatusFault();

      expect(fault).toBe(mockCharacteristic.StatusFault.GENERAL_FAULT);
    });

    it('should return GENERAL_FAULT when no lastUpdate', async () => {
      mockAccessory.context.lastUpdate = undefined;

      const fault = await accessory.getStatusFault();

      expect(fault).toBe(mockCharacteristic.StatusFault.GENERAL_FAULT);
    });
  });

  describe('EventEmitter integration', () => {
    it('should update characteristics when siteUpdated event is emitted', () => {
      const updatedSite = {
        ...mockSite,
        security_level: 'armed' as const,
      };

      mockPlatform.events.emit('siteUpdated', 'test-site-id', updatedSite);

      expect(mockAccessory.context.site).toEqual(updatedSite);
      expect(mockAccessory.context.lastUpdate).toBeGreaterThan(Date.now() - 1000);
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.SecuritySystemCurrentState,
        mockCharacteristic.SecuritySystemCurrentState.AWAY_ARM,
      );
    });

    it('should not update for different site_id', () => {
      const initialCallCount = (mockService.updateCharacteristic as jest.Mock).mock.calls.length;

      mockPlatform.events.emit('siteUpdated', 'different-site-id', mockSite);

      const finalCallCount = (mockService.updateCharacteristic as jest.Mock).mock.calls.length;
      expect(finalCallCount).toBe(initialCallCount);
    });

    it('should update reachability status', () => {
      const updatedSite = { ...mockSite };

      mockPlatform.events.emit('siteUpdated', 'test-site-id', updatedSite);

      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
        mockCharacteristic.StatusFault,
        mockCharacteristic.StatusFault.NO_FAULT,
      );
    });
  });

  describe('destroy', () => {
    it('should remove event listeners', () => {
      const listenerCount = mockPlatform.events.listenerCount('siteUpdated');

      accessory.destroy();

      expect(mockPlatform.events.listenerCount('siteUpdated')).toBeLessThan(listenerCount);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Cleaned up alarm accessory');
    });
  });

  describe('error handling', () => {
    it('should log authentication errors with user-friendly message', async () => {
      const error = {
        statusCode: 401,
        message: 'Unauthorized',
      };
      mockApi.setSecurityLevel.mockRejectedValueOnce(error);

      await expect(accessory.setTargetState(1)).rejects.toThrow();

      expect(mockPlatform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed'),
      );
    });

    it('should log rate limit errors with user-friendly message', async () => {
      const error = {
        statusCode: 429,
        message: 'Too many requests',
      };
      mockApi.setSecurityLevel.mockRejectedValueOnce(error);

      await expect(accessory.setTargetState(1)).rejects.toThrow();

      expect(mockPlatform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Rate limited'),
      );
    });

    it('should log server errors with user-friendly message', async () => {
      const error = {
        statusCode: 500,
        message: 'Internal server error',
      };
      mockApi.setSecurityLevel.mockRejectedValueOnce(error);

      await expect(accessory.setTargetState(1)).rejects.toThrow();

      expect(mockPlatform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('server error'),
      );
    });
  });
});
