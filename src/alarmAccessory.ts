import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { SomfyProtectPlatform } from './platform.js';
import type { SomfyProtectApi } from './api.js';
import type { Site, SecurityLevel } from './types.js';
import { SomfyProtectApiError } from './types.js';
import { PLUGIN_VERSION } from './settings.js';

/**
 * Somfy Protect Alarm Accessory
 * Represents a Somfy Protect alarm system in HomeKit
 */
export class SomfyProtectAlarmAccessory {
  private service: Service;
  private isReachable = true;
  private pendingTarget?: SecurityLevel;
  // Kept so destroy() can remove the exact listener instance registered below
  private readonly boundHandleSiteUpdate: (
    siteId: string,
    updatedSite: Site,
    pendingTarget?: SecurityLevel,
  ) => void;

  /**
   * Data older than this is considered stale. Derived from the polling
   * interval so a slow (e.g. 60s+) poll doesn't trip false faults between polls.
   */
  private get stalenessThreshold(): number {
    return Math.max(90000, this.platform.getNormalPollingInterval() * 2 + 30000);
  }

  constructor(
    private readonly platform: SomfyProtectPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly api: SomfyProtectApi,
  ) {
    const site = this.accessory.context.site as Site;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Somfy')
      .setCharacteristic(this.platform.Characteristic.Model, 'Somfy Protect')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, site.site_id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, PLUGIN_VERSION)
      .setCharacteristic(this.platform.Characteristic.Name, site.label);

    // Get or create Security System service
    this.service = this.accessory.getService(this.platform.Service.SecuritySystem)
      || this.accessory.addService(this.platform.Service.SecuritySystem);

    this.service.setCharacteristic(this.platform.Characteristic.Name, site.label);

    // Set valid values for characteristics
    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .setProps({
        validValues: [
          this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM,
          this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM,
          this.platform.Characteristic.SecuritySystemCurrentState.DISARMED,
          this.platform.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        ],
      });

    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .setProps({
        validValues: [
          this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM,
          this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM,
          this.platform.Characteristic.SecuritySystemTargetState.DISARM,
        ],
      });

    // Register handlers using modern API
    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .onGet(this.getCurrentState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));

    // Add StatusFault characteristic to show connection issues in Home app
    this.service.getCharacteristic(this.platform.Characteristic.StatusFault)
      .onGet(this.getStatusFault.bind(this));

    // Listen for site updates from platform (EventEmitter pattern)
    this.boundHandleSiteUpdate = this.handleSiteUpdate.bind(this);
    this.platform.events.on('siteUpdated', this.boundHandleSiteUpdate);

    // Set initial state
    this.updateCharacteristics();
  }

  /**
   * Convert Somfy security level to HomeKit current state
   */
  private somfyToHomekitCurrentState(level: SecurityLevel): CharacteristicValue {
    switch (level) {
    case 'armed':
      return this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM;
    case 'partial':
      return this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM;
    case 'disarmed':
      return this.platform.Characteristic.SecuritySystemCurrentState.DISARMED;
    default:
      throw new Error(`Unknown security level: ${String(level)}`);
    }
  }

  /**
   * Convert Somfy security level to HomeKit target state
   */
  private somfyToHomekitTargetState(level: SecurityLevel): CharacteristicValue {
    switch (level) {
    case 'armed':
      return this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM;
    case 'partial':
      return this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM;
    case 'disarmed':
      return this.platform.Characteristic.SecuritySystemTargetState.DISARM;
    default:
      throw new Error(`Unknown security level: ${String(level)}`);
    }
  }

  /**
   * Convert HomeKit target state to Somfy security level
   */
  private homekitToSomfyLevel(state: CharacteristicValue): SecurityLevel {
    switch (state) {
    case this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM:
      return 'armed';
    case this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM:
      return 'partial';
    case this.platform.Characteristic.SecuritySystemTargetState.DISARM:
      return 'disarmed';
    default:
      throw new Error(`Unknown target state: ${String(state)}`);
    }
  }

  /**
   * Get current security state
   */
  async getCurrentState(): Promise<CharacteristicValue> {
    try {
      // Check if data is stale
      const lastUpdate = this.accessory.context.lastUpdate as number;
      const isStale = !lastUpdate || (Date.now() - lastUpdate > this.stalenessThreshold);

      if (isStale) {
        this.isReachable = false;
        this.service.updateCharacteristic(
          this.platform.Characteristic.StatusFault,
          this.platform.Characteristic.StatusFault.GENERAL_FAULT,
        );
        throw new this.platform.homebridgeApi.hap.HapStatusError(
          this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
        );
      }

      this.isReachable = true;
      const site = this.accessory.context.site as Site;
      this.platform.log.debug(`Getting current state for ${site.label}: ${site.security_level}`);
      return this.somfyToHomekitCurrentState(site.security_level);
    } catch (error) {
      if (error instanceof this.platform.homebridgeApi.hap.HapStatusError) {
        throw error;
      }
      this.handleError('getting current state', error);
      throw new this.platform.homebridgeApi.hap.HapStatusError(
        this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  /**
   * Get target security state
   */
  async getTargetState(): Promise<CharacteristicValue> {
    try {
      const site = this.accessory.context.site as Site;
      const targetLevel = this.pendingTarget || site.security_level;
      this.platform.log.debug(`Getting target state for ${site.label}: ${targetLevel}`);
      return this.somfyToHomekitTargetState(targetLevel);
    } catch (error) {
      this.platform.log.error('Error getting target state:', error);
      throw new this.platform.homebridgeApi.hap.HapStatusError(
        this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  /**
   * Set target security state
   */
  async setTargetState(value: CharacteristicValue): Promise<void> {
    try {
      const site = this.accessory.context.site as Site;
      const targetLevel = this.homekitToSomfyLevel(value);

      this.platform.log.info(`Setting ${site.label} to ${targetLevel}`);

      // Send command to Somfy API
      await this.api.setSecurityLevel(site.site_id, targetLevel);

      // Keep the requested target separate from the last state observed remotely.
      this.pendingTarget = targetLevel;
      this.accessory.context.pendingTarget = targetLevel;
      this.platform.requestFastPolling(site.site_id, targetLevel);

      // HomeKit target changes immediately; current state changes only after polling confirms it.
      this.service.updateCharacteristic(
        this.platform.Characteristic.SecuritySystemTargetState,
        this.somfyToHomekitTargetState(targetLevel),
      );

      this.platform.log.info(`Successfully set ${site.label} to ${targetLevel}`);

    } catch (error) {
      this.handleError('setting target state', error);

      // Revert to actual state on error
      const site = this.accessory.context.site as Site;
      this.service.updateCharacteristic(
        this.platform.Characteristic.SecuritySystemTargetState,
        this.somfyToHomekitTargetState(this.pendingTarget || site.security_level),
      );

      throw new this.platform.homebridgeApi.hap.HapStatusError(
        this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  /**
   * Get StatusFault characteristic (shows connection issues in Home app)
   */
  async getStatusFault(): Promise<CharacteristicValue> {
    const lastUpdate = this.accessory.context.lastUpdate as number;
    const isStale = !lastUpdate || (Date.now() - lastUpdate > this.stalenessThreshold);

    if (isStale || !this.isReachable) {
      return this.platform.Characteristic.StatusFault.GENERAL_FAULT;
    }

    return this.platform.Characteristic.StatusFault.NO_FAULT;
  }

  /**
   * Handle site update event from platform (EventEmitter pattern)
   */
  private handleSiteUpdate(
    siteId: string,
    updatedSite: Site,
    pendingTarget?: SecurityLevel,
  ): void {
    const currentSite = this.accessory.context.site as Site;

    if (siteId === currentSite.site_id) {
      // Update context
      this.accessory.context.site = updatedSite;
      this.accessory.context.lastUpdate = Date.now();
      this.pendingTarget = pendingTarget;
      if (pendingTarget) {
        this.accessory.context.pendingTarget = pendingTarget;
      } else {
        delete this.accessory.context.pendingTarget;
      }

      // Update characteristics
      this.updateCharacteristics(pendingTarget);

      // Update reachability
      this.isReachable = true;
      this.service.updateCharacteristic(
        this.platform.Characteristic.StatusFault,
        this.platform.Characteristic.StatusFault.NO_FAULT,
      );
    }
  }

  /**
   * Update characteristics based on current site data
   */
  private updateCharacteristics(targetOverride?: SecurityLevel): void {
    const site = this.accessory.context.site as Site;

    const currentState = this.somfyToHomekitCurrentState(site.security_level);
    const targetState = this.somfyToHomekitTargetState(targetOverride || site.security_level);

    this.service.updateCharacteristic(
      this.platform.Characteristic.SecuritySystemCurrentState,
      currentState,
    );

    this.service.updateCharacteristic(
      this.platform.Characteristic.SecuritySystemTargetState,
      targetState,
    );

    this.platform.log.debug(`Updated characteristics for ${site.label}: ${site.security_level}`);
  }

  /**
   * Handle errors with improved user-friendly messages
   */
  private handleError(operation: string, error: unknown): void {
    if (error instanceof SomfyProtectApiError) {
      if (error.statusCode === 401) {
        this.platform.log.error(
          `Authentication failed while ${operation}. Please check your credentials in config.`,
        );
      } else if (error.statusCode === 429) {
        this.platform.log.error(
          `Rate limited by Somfy API while ${operation}. Slowing down requests.`,
        );
      } else if (error.statusCode && error.statusCode >= 500) {
        this.platform.log.error(
          `Somfy API server error while ${operation}. Will retry automatically.`,
        );
      } else {
        this.platform.log.error(`Failed ${operation}: ${error.message}`);
      }
    } else if (error instanceof Error) {
      this.platform.log.error(`Error ${operation}:`, error.message);
    } else {
      this.platform.log.error(`Unknown error ${operation}:`, error);
    }
  }

  /**
   * Cleanup method (called on shutdown)
   */
  public destroy(): void {
    // Remove event listeners
    this.platform.events.removeListener('siteUpdated', this.boundHandleSiteUpdate);
    this.platform.log.debug('Cleaned up alarm accessory');
  }
}
