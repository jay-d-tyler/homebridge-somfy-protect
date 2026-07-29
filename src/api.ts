import type { Logging } from 'homebridge';
import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { API_CONFIG, POLLING_CONFIG } from './settings.js';
import { SomfyProtectAuth } from './auth.js';
import {
  type Site,
  type SecurityLevel,
  type SetSecurityLevelResponse,
  isSecurityLevel,
  SomfyProtectApiError,
} from './types.js';

/**
 * Somfy Protect API Client
 */
export class SomfyProtectApi {
  private readonly axios: AxiosInstance;
  private readonly auth: SomfyProtectAuth;

  constructor(
    private readonly log: Logging,
    username: string,
    password: string,
    storagePath: string,
  ) {
    this.auth = new SomfyProtectAuth(log, username, password, storagePath);

    // Create axios instance
    this.axios = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Homebridge-Somfy-Protect',
      },
    });

    // Configure retry logic
    axiosRetry(this.axios, {
      retries: POLLING_CONFIG.MAX_RETRY_ATTEMPTS,
      retryDelay: (retryCount) => {
        return retryCount * POLLING_CONFIG.RETRY_DELAY;
      },
      retryCondition: (error) => {
        // Never replay non-idempotent operations such as the panic POST.
        return axiosRetry.isIdempotentRequestError(error);
      },
      onRetry: (retryCount, error) => {
        this.log.debug(`Retry attempt ${retryCount} after error:`, error.message);
      },
    });

    // Request interceptor to add auth token
    this.axios.interceptors.request.use(
      async (config) => {
        try {
          const token = await this.auth.getAccessToken();
          config.headers.Authorization = `Bearer ${token}`;
        } catch (error) {
          this.log.error('Failed to get access token:', error);
          throw error;
        }
        return config;
      },
      (error) => Promise.reject(error),
    );

    // Response interceptor for error handling
    this.axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;

          // Handle authentication errors — retry once with a refreshed token.
          // The _authRetried flag stops an infinite loop when the API keeps
          // returning 401 even after a refresh.
          const config = error.config as (typeof error.config & { _authRetried?: boolean }) | undefined;
          if (status === 401 && config && !config._authRetried) {
            this.log.warn('Authentication error, attempting to refresh token');
            try {
              await this.auth.forceRefresh();
              const token = await this.auth.getAccessToken();
              config._authRetried = true;
              config.headers.Authorization = `Bearer ${token}`;
              return this.axios.request(config);
            } catch (refreshError) {
              this.log.error('Token refresh failed:', refreshError);
            }
          }

          const message = error.response?.data?.message || error.message;
          throw new SomfyProtectApiError(
            message,
            status,
            error.response?.data,
          );
        }
        throw error;
      },
    );
  }

  /**
   * Get all sites
   */
  async getSites(): Promise<Site[]> {
    try {
      this.log.debug('Fetching all sites');
      const response = await this.axios.get<{ items: unknown[] }>('/v3/site');
      if (!Array.isArray(response.data.items)) {
        throw new SomfyProtectApiError('Somfy API returned an invalid sites response');
      }
      return response.data.items.map(site => this.validateSite(site));
    } catch (error) {
      this.log.error('Failed to get sites:', error);
      throw error;
    }
  }

  /**
   * Get site by ID
   */
  async getSite(siteId: string): Promise<Site> {
    try {
      this.log.debug(`Fetching site ${siteId}`);
      const response = await this.axios.get<unknown>(`/v3/site/${siteId}`);
      return this.validateSite(response.data);
    } catch (error) {
      this.log.error(`Failed to get site ${siteId}:`, error);
      throw error;
    }
  }

  /**
   * Set security level for a site
   */
  async setSecurityLevel(
    siteId: string,
    level: SecurityLevel,
  ): Promise<SetSecurityLevelResponse> {
    try {
      this.log.info(`Setting security level to '${level}' for site ${siteId}`);
      const response = await this.axios.put<SetSecurityLevelResponse>(
        `/v3/site/${siteId}/security`,
        { status: level },
      );
      return response.data;
    } catch (error) {
      this.log.error(`Failed to set security level for site ${siteId}:`, error);
      throw error;
    }
  }

  private validateSite(site: unknown): Site {
    if (!site || typeof site !== 'object') {
      throw new SomfyProtectApiError('Somfy API returned an invalid site response');
    }

    const candidate = site as Partial<Record<keyof Site, unknown>>;
    const siteId = typeof candidate.site_id === 'string'
      ? candidate.site_id.trim()
      : '';
    if (!siteId) {
      throw new SomfyProtectApiError(
        'Somfy API returned an invalid site response: missing site_id',
        undefined,
        site,
      );
    }

    const securityLevel = candidate.security_level;
    if (!isSecurityLevel(securityLevel)) {
      throw new SomfyProtectApiError(
        `Somfy API returned unknown security level: ${String(securityLevel)}`,
        undefined,
        site,
      );
    }

    const label = this.getSiteLabel(candidate.label, candidate.name, siteId);
    return {
      ...(site as Record<string, unknown>),
      site_id: siteId,
      label,
      security_level: securityLevel,
    };
  }

  private getSiteLabel(label: unknown, name: unknown, siteId: string): string {
    if (typeof label === 'string' && label.trim()) {
      return label.trim();
    }
    if (typeof name === 'string' && name.trim()) {
      return name.trim();
    }

    const fallback = `Somfy Protect (${siteId.slice(0, 8)})`;
    this.log.warn(`Somfy site ${siteId} has no label; using "${fallback}"`);
    return fallback;
  }
}
