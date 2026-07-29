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
import { HttpApiServer } from './httpServer.js';
import type { SecurityLevel, SomfyProtectConfig, Site } from './types.js';

interface PendingTarget {
  state: SecurityLevel;
  requestedAt: number;
}

const DISCOVERY_RETRY_INITIAL_DELAY = 60000;
const DISCOVERY_RETRY_MAX_DELAY = 15 * 60000;
const DISCOVERY_RETRY_JITTER = 0.2;

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
  private pollingTimeout?: NodeJS.Timeout;
  private pollingActive = false;
  private pollInFlight = false;
  private discoveryRetryTimeout?: NodeJS.Timeout;
  private discoveryRetryAttempt = 0;
  private discoveryInFlight = false;
  private shuttingDown = false;
  private readonly config: SomfyProtectConfig;
  private readonly accessoryInstances: Map<string, SomfyProtectAlarmAccessory> = new Map();
  private httpServer?: HttpApiServer;
  private lastStateChange = 0;
  private readonly observedStates: Map<string, SecurityLevel> = new Map();
  private readonly pendingTargets: Map<string, PendingTarget> = new Map();
  private isFastPolling = false;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly homebridgeApi: API,
  ) {
    this.config = config as SomfyProtectConfig;
    this.Service = homebridgeApi.hap.Service;
    this.Characteristic = homebridgeApi.hap.Characteristic;

    // Validate configuration
    if (
      typeof this.config.username !== 'string'
      || !this.config.username.trim()
      || typeof this.config.password !== 'string'
      || !this.config.password
    ) {
      this.log.error('Username and password are required in config.json');
      return;
    }

    const configError = this.getConfigError();
    if (configError) {
      this.log.error(`Invalid Somfy Protect configuration: ${configError}`);
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
      this.shuttingDown = true;
      this.clearDiscoveryRetry();
      this.stopPolling();
      // Stop HTTP server
      if (this.httpServer) {
        this.httpServer.stop();
      }
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
    if (this.shuttingDown || this.discoveryInFlight) {
      return;
    }

    this.discoveryInFlight = true;
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

      if (this.shuttingDown) {
        return;
      }

      this.discoveryRetryAttempt = 0;
      this.clearDiscoveryRetry();

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

      // Start HTTP API server if enabled
      if (!this.httpServer && this.config.httpPort !== undefined && this.config.httpPort !== 0) {
        if (!this.config.httpToken?.trim()) {
          this.log.error('HTTP API not started: httpToken is required when httpPort is enabled');
        } else {
          this.httpServer = new HttpApiServer(
            this.log,
            this.config.httpPort,
            this.config.httpToken,
            () => this.setAllAlarmsSecurityLevel('disarmed'),
            () => this.setAllAlarmsSecurityLevel('armed'),
            () => this.setAllAlarmsSecurityLevel('partial'),
            this.config.httpHost?.trim() || '127.0.0.1',
          );
          this.httpServer.start();
        }
      }

    } catch (error) {
      this.log.error('Failed to discover Somfy Protect sites:', error);
      this.scheduleDiscoveryRetry();
    } finally {
      this.discoveryInFlight = false;
    }
  }

  private getConfigError(): string | undefined {
    const integerInRange = (
      value: unknown,
      minimum: number,
      maximum: number,
    ): boolean => value === undefined
      || (
        typeof value === 'number'
        && Number.isInteger(value)
        && value >= minimum
        && value <= maximum
      );

    if (!integerInRange(this.config.pollingInterval, 5000, 300000)) {
      return 'pollingInterval must be an integer between 5000 and 300000';
    }
    if (!integerInRange(this.config.fastPollingInterval, 1000, 10000)) {
      return 'fastPollingInterval must be an integer between 1000 and 10000';
    }
    if (!integerInRange(this.config.fastPollingDuration, 10000, 300000)) {
      return 'fastPollingDuration must be an integer between 10000 and 300000';
    }
    if (!integerInRange(this.config.httpPort, 0, 65535)) {
      return 'httpPort must be an integer between 0 and 65535';
    }
    if (
      this.config.adaptivePolling !== undefined
      && typeof this.config.adaptivePolling !== 'boolean'
    ) {
      return 'adaptivePolling must be a boolean';
    }
    if (this.config.siteId !== undefined && typeof this.config.siteId !== 'string') {
      return 'siteId must be a string';
    }
    if (this.config.httpToken !== undefined && typeof this.config.httpToken !== 'string') {
      return 'httpToken must be a string';
    }
    if (
      this.config.httpHost !== undefined
      && (typeof this.config.httpHost !== 'string' || !this.config.httpHost.trim())
    ) {
      return 'httpHost cannot be blank';
    }
    return undefined;
  }

  private scheduleDiscoveryRetry(): void {
    if (this.shuttingDown || this.discoveryRetryTimeout) {
      return;
    }

    const exponentialDelay = Math.min(
      DISCOVERY_RETRY_INITIAL_DELAY * (2 ** this.discoveryRetryAttempt),
      DISCOVERY_RETRY_MAX_DELAY,
    );
    const jitter = Math.floor(exponentialDelay * DISCOVERY_RETRY_JITTER * Math.random());
    const delay = exponentialDelay + jitter;
    this.discoveryRetryAttempt += 1;

    this.log.warn(`Retrying site discovery in ${delay}ms`);
    this.discoveryRetryTimeout = setTimeout(() => {
      this.discoveryRetryTimeout = undefined;
      void this.discoverSites();
    }, delay);
  }

  private clearDiscoveryRetry(): void {
    if (this.discoveryRetryTimeout) {
      clearTimeout(this.discoveryRetryTimeout);
      this.discoveryRetryTimeout = undefined;
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
      this.accessoryInstances.get(uuid)?.destroy();
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
        const site = accessory.context.site as Site | undefined;
        if (site) {
          this.observedStates.delete(site.site_id);
          this.pendingTargets.delete(site.site_id);
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
    if (this.pollingActive) {
      return;
    }

    this.pollingActive = true;
    const interval = this.getPollingInterval();
    this.log.debug(`Starting status polling every ${interval}ms`);
    void this.runPollingCycle();
  }

  /**
   * Normal (non-fast) polling interval, also used by accessories to judge staleness
   */
  public getNormalPollingInterval(): number {
    return this.config.pollingInterval || POLLING_CONFIG.INITIAL_INTERVAL;
  }

  /**
   * Get current polling interval based on adaptive polling settings
   */
  private getPollingInterval(): number {
    const adaptiveEnabled = this.config.adaptivePolling !== false; // Enabled by default

    if (adaptiveEnabled && this.isFastPolling) {
      const fastDuration = this.config.fastPollingDuration || POLLING_CONFIG.FAST_POLLING_DURATION;
      if (Date.now() - this.lastStateChange >= fastDuration) {
        this.isFastPolling = false;
        this.log.debug('Switching back to normal polling');
      }
    }

    if (adaptiveEnabled && this.isFastPolling) {
      return this.config.fastPollingInterval || POLLING_CONFIG.FAST_INTERVAL;
    }

    return this.getNormalPollingInterval();
  }

  /**
   * Run one poll at a time and schedule the next only after it finishes.
   */
  private async runPollingCycle(): Promise<void> {
    if (!this.pollingActive || this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    try {
      await this.pollStatus();
    } finally {
      this.pollInFlight = false;
      if (this.pollingActive) {
        this.scheduleNextPoll(this.getPollingInterval());
      }
    }
  }

  private scheduleNextPoll(delay: number): void {
    if (!this.pollingActive || this.pollingTimeout) {
      return;
    }

    this.pollingTimeout = setTimeout(() => {
      this.pollingTimeout = undefined;
      void this.runPollingCycle();
    }, delay);
  }

  /**
   * Switch to fast polling after a local or observed state change.
   */
  public requestFastPolling(siteId: string, expectedState?: SecurityLevel): void {
    if (expectedState) {
      this.pendingTargets.set(siteId, {
        state: expectedState,
        requestedAt: Date.now(),
      });
    }

    if (this.config.adaptivePolling === false) {
      return;
    }

    this.lastStateChange = Date.now();
    this.isFastPolling = true;

    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = undefined;
      this.scheduleNextPoll(this.getPollingInterval());
    }
  }

  /**
   * Poll for status updates
   */
  private async pollStatus(): Promise<void> {
    const adaptiveEnabled = this.config.adaptivePolling !== false;

    for (const [, accessory] of this.accessories) {
      const site = accessory.context.site as Site;
      try {
        const updatedSite = await this.api.getSite(site.site_id);

        // Check for state changes (for adaptive polling)
        if (adaptiveEnabled) {
          const previousState = this.observedStates.get(site.site_id);
          const currentState = updatedSite.security_level;
          const pendingTarget = this.pendingTargets.get(site.site_id);
          const commandConfirmed = pendingTarget?.state === currentState;

          if (previousState && previousState !== currentState && !commandConfirmed) {
            // State changed! Switch to fast polling
            this.log.info(`Security level changed from ${previousState} to ${currentState} - switching to fast polling`);
            this.requestFastPolling(site.site_id);
          }

          this.observedStates.set(site.site_id, currentState);
        }

        const pendingTarget = this.pendingTargets.get(site.site_id);
        let targetOverride = pendingTarget?.state;
        if (pendingTarget?.state === updatedSite.security_level) {
          this.pendingTargets.delete(site.site_id);
          delete accessory.context.pendingTarget;
          targetOverride = undefined;
          this.log.debug(`Confirmed requested security level for ${site.label}: ${updatedSite.security_level}`);
        } else if (
          pendingTarget
          && Date.now() - pendingTarget.requestedAt >= this.getCommandConfirmationTimeout()
        ) {
          this.pendingTargets.delete(site.site_id);
          delete accessory.context.pendingTarget;
          targetOverride = undefined;
          this.log.warn(
            `Requested security level for ${site.label} was not observed before the confirmation timeout`,
          );
        }

        // Emit event to notify accessory of update (EventEmitter pattern)
        this.events.emit('siteUpdated', site.site_id, updatedSite, targetOverride);
      } catch (error) {
        this.log.debug(
          `Polling error for ${site.label} (will retry):`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private getCommandConfirmationTimeout(): number {
    return this.config.fastPollingDuration || POLLING_CONFIG.FAST_POLLING_DURATION;
  }

  /**
   * Stop polling (called on shutdown)
   */
  public stopPolling(): void {
    const wasActive = this.pollingActive;
    this.pollingActive = false;
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = undefined;
    }
    if (wasActive) {
      this.log.debug('Stopped status polling');
    }
  }

  private async setAllAlarmsSecurityLevel(level: SecurityLevel): Promise<void> {
    this.log.info(`Setting all alarm systems to ${level} via HTTP API`);

    const operations: Promise<void>[] = [];
    for (const [uuid] of this.accessoryInstances) {
      const accessory = this.accessories.get(uuid);
      if (accessory) {
        const site = accessory.context.site as Site;
        if (site.security_level === level && this.isSiteCacheFresh(accessory)) {
          this.log.debug(`${site.label} is already ${level}; skipping API command`);
          continue;
        }

        this.log.info(`Setting ${site.label} to ${level}`);
        operations.push(
          this.api.setSecurityLevel(site.site_id, level)
            .then(() => {
              accessory.context.pendingTarget = level;
              this.requestFastPolling(site.site_id, level);
              this.events.emit('siteUpdated', site.site_id, site, level);
            })
            .catch((error) => {
              this.log.error(`Failed to set ${site.label} to ${level}:`, error);
              throw error;
            }),
        );
      }
    }

    if (operations.length === 0) {
      this.log.info(`All alarm systems are already ${level}`);
      return;
    }

    await Promise.all(operations);
    this.log.info(`All alarm systems set to ${level} successfully`);
  }

  private isSiteCacheFresh(accessory: PlatformAccessory): boolean {
    const lastUpdate = accessory.context.lastUpdate as number | undefined;
    if (!lastUpdate) {
      return false;
    }
    const threshold = Math.max(90000, this.getNormalPollingInterval() * 2 + 30000);
    return Date.now() - lastUpdate <= threshold;
  }
}
