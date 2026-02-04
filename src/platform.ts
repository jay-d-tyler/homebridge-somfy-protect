import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { EventEmitter } from 'events';

import { SomfyProtectAlarmAccessory } from './alarmAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME, POLLING_CONFIG } from './settings.js';
import { SomfyProtectApi } from './api.js';
import type { SomfyProtectConfig, Site } from './types.js';

/**
 * Somfy Protect Platform
 * Discovers and manages Somfy Protect alarm systems
 */
export class SomfyProtectPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly events = new EventEmitter();

  private api!: SomfyProtectApi;
  private pollingInterval?: NodeJS.Timeout;
  private readonly config: SomfyProtectConfig;
  private readonly accessoryInstances: Map<string, SomfyProtectAlarmAccessory> = new Map();
  private lastStateChange: number = 0;
  private previousStates: Map<string, string> = new Map();
  private isFastPolling: boolean = false;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly homebridgeApi: API,
  ) {
    this.config = config as SomfyProtectConfig;
    this.Service = homebridgeApi.hap.Service;
    this.Characteristic = homebridgeApi.hap.Characteristic;

    // Validate configuration
    if (!this.config.username || !this.config.password) {
      this.log.error('Username and password are required in config.json');
      return;
    }

    this.log.debug('Finished initializing platform');

    // Wait for Homebridge to finish loading cached accessories
    this.homebridgeApi.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.discoverSites();
    });

    // Graceful shutdown handler
    this.homebridgeApi.on('shutdown', () => {
      this.log.info('Homebridge is shutting down, cleaning up...');
      this.stopPolling();
      // Cleanup all accessory instances
      for (const [, instance] of this.accessoryInstances) {
        instance.destroy();
      }
      this.events.removeAllListeners();
    });
  }

  /**
   * Restore cached accessory from disk
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Discover Somfy Protect sites and register them as accessories
   */
  private async discoverSites(): Promise<void> {
    try {
      // Initialize API client
      this.api = new SomfyProtectApi(
        this.log,
        this.config.username,
        this.config.password,
        this.homebridgeApi.user.storagePath(),
      );

      // Get all sites
      const sites = await this.api.getSites();

      if (sites.length === 0) {
        this.log.warn('No Somfy Protect sites found on your account');
        return;
      }

      // Filter to specific site if configured
      let sitesToRegister: Site[];
      if (this.config.siteId) {
        const site = sites.find(s => s.site_id === this.config.siteId);
        if (!site) {
          this.log.error(`Configured site ID "${this.config.siteId}" not found`);
          this.log.error('Available sites:');
          sites.forEach(s => this.log.error(`  - ${s.label} (${s.site_id})`));
          return;
        }
        sitesToRegister = [site];
        this.log.info(`Using configured site: ${site.label}`);
      } else {
        sitesToRegister = sites;
        if (sites.length > 1) {
          this.log.warn('Multiple sites detected. Add "siteId" to config to select a specific site:');
          sites.forEach(s => this.log.warn(`  - ${s.label}: ${s.site_id}`));
        }
      }

      // Register each site as an accessory
      for (const site of sitesToRegister) {
        this.registerSite(site);
      }

      // Remove accessories that are no longer present
      this.removeStaleAccessories(sitesToRegister);

      // Start polling for status updates
      this.startPolling();

    } catch (error) {
      this.log.error('Failed to discover Somfy Protect sites:', error);
      // Retry after delay
      setTimeout(() => this.discoverSites(), 60000);
    }
  }

  /**
   * Register a Somfy Protect site as an accessory
   */
  private registerSite(site: Site): void {
    const uuid = this.homebridgeApi.hap.uuid.generate(site.site_id);
    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      // Update existing accessory
      this.log.info('Restoring existing accessory:', site.label);
      existingAccessory.context.site = site;
      this.homebridgeApi.updatePlatformAccessories([existingAccessory]);
      const instance = new SomfyProtectAlarmAccessory(this, existingAccessory, this.api);
      this.accessoryInstances.set(uuid, instance);
    } else {
      // Create new accessory with proper category
      this.log.info('Adding new accessory:', site.label);
      const accessory = new this.homebridgeApi.platformAccessory(
        site.label,
        uuid,
        this.homebridgeApi.hap.Categories.SECURITY_SYSTEM,
      );
      accessory.context.site = site;
      const instance = new SomfyProtectAlarmAccessory(this, accessory, this.api);
      this.accessoryInstances.set(uuid, instance);
      this.homebridgeApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }
  }

  /**
   * Remove accessories that no longer exist
   */
  private removeStaleAccessories(currentSites: Site[]): void {
    const currentUUIDs = new Set(
      currentSites.map(site => this.homebridgeApi.hap.uuid.generate(site.site_id)),
    );

    const accessoriesToRemove: PlatformAccessory[] = [];

    for (const [uuid, accessory] of this.accessories) {
      if (!currentUUIDs.has(uuid)) {
        this.log.info('Removing stale accessory:', accessory.displayName);
        // Cleanup accessory instance
        const instance = this.accessoryInstances.get(uuid);
        if (instance) {
          instance.destroy();
          this.accessoryInstances.delete(uuid);
        }
        accessoriesToRemove.push(accessory);
        this.accessories.delete(uuid);
      }
    }

    if (accessoriesToRemove.length > 0) {
      this.homebridgeApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
    }
  }

  /**
   * Start polling for status updates
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      return;
    }

    const interval = this.getPollingInterval();
    this.log.debug(`Starting status polling every ${interval}ms`);

    this.pollingInterval = setInterval(() => {
      this.pollStatus();
    }, interval);

    // Do an immediate poll
    this.pollStatus();
  }

  /**
   * Get current polling interval based on adaptive polling settings
   */
  private getPollingInterval(): number {
    const adaptiveEnabled = this.config.adaptivePolling !== false; // Enabled by default

    if (!adaptiveEnabled) {
      return this.config.pollingInterval || POLLING_CONFIG.INITIAL_INTERVAL;
    }

    // Check if we should be in fast polling mode
    const now = Date.now();
    const fastDuration = this.config.fastPollingDuration || POLLING_CONFIG.FAST_POLLING_DURATION;
    const timeSinceChange = now - this.lastStateChange;

    if (timeSinceChange < fastDuration) {
      return this.config.fastPollingInterval || POLLING_CONFIG.FAST_INTERVAL;
    }

    return this.config.pollingInterval || POLLING_CONFIG.INITIAL_INTERVAL;
  }

  /**
   * Restart polling with new interval (for adaptive polling)
   */
  private restartPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
    this.startPolling();
  }

  /**
   * Poll for status updates
   */
  private async pollStatus(): Promise<void> {
    try {
      const adaptiveEnabled = this.config.adaptivePolling !== false;

      for (const [, accessory] of this.accessories) {
        const site = accessory.context.site as Site;
        const updatedSite = await this.api.getSite(site.site_id);

        // Check for state changes (for adaptive polling)
        if (adaptiveEnabled) {
          const previousState = this.previousStates.get(site.site_id);
          const currentState = updatedSite.security_level;

          if (previousState && previousState !== currentState) {
            // State changed! Switch to fast polling
            this.log.info(`Security level changed from ${previousState} to ${currentState} - switching to fast polling`);
            this.lastStateChange = Date.now();

            // Restart polling with fast interval if not already in fast mode
            const newInterval = this.getPollingInterval();
            const wasFastPolling = this.isFastPolling;
            this.isFastPolling = true;

            if (!wasFastPolling) {
              this.restartPolling();
            }
          } else if (this.isFastPolling) {
            // Check if we should switch back to normal polling
            const now = Date.now();
            const fastDuration = this.config.fastPollingDuration || POLLING_CONFIG.FAST_POLLING_DURATION;
            const timeSinceChange = now - this.lastStateChange;

            if (timeSinceChange >= fastDuration) {
              this.log.debug('Switching back to normal polling');
              this.isFastPolling = false;
              this.restartPolling();
            }
          }

          // Store current state
          this.previousStates.set(site.site_id, currentState);
        }

        // Emit event to notify accessory of update (EventEmitter pattern)
        this.events.emit('siteUpdated', site.site_id, updatedSite);
      }
    } catch (error) {
      this.log.debug('Polling error (will retry):', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Stop polling (called on shutdown)
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
      this.log.debug('Stopped status polling');
    }
  }
}
