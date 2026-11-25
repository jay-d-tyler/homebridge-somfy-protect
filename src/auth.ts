import type { Logging } from 'homebridge';
import axios, { type AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { API_CONFIG } from './settings.js';
import {
  type OAuthToken,
  type OAuthTokenResponse,
  type SomfyProtectCredentials,
  SomfyProtectApiError,
} from './types.js';

interface StoredOAuthToken {
  version: 1;
  username: string;
  token: OAuthToken;
}

/**
 * Handles authentication and token management for Somfy Protect API
 */
export class SomfyProtectAuth {
  private token: OAuthToken | null = null;
  private tokenRefreshPromise?: Promise<OAuthToken>;
  private readonly tokenPath: string;
  private readonly axios: AxiosInstance;

  constructor(
    private readonly log: Logging,
    private readonly credentials: SomfyProtectCredentials,
    storagePath: string,
  ) {
    this.tokenPath = path.join(storagePath, 'somfy-protect-token.json');
    this.axios = axios.create({
      baseURL: API_CONFIG.TOKEN_URL,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Homebridge-Somfy-Protect',
      },
    });

    // Load cached token
    this.loadToken();
  }

  /**
   * Load token from persistent storage
   */
  private loadToken(): void {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = fs.readFileSync(this.tokenPath, 'utf-8');
        const storedToken = JSON.parse(data) as unknown;

        if (!this.isStoredToken(storedToken)) {
          this.log.info('Ignoring legacy or invalid cached authentication token');
          return;
        }

        if (storedToken.username !== this.normalizedUsername) {
          this.log.info('Ignoring cached authentication token for a different account');
          return;
        }

        this.token = storedToken.token;
        this.log.debug('Loaded cached authentication token');
      }
    } catch (error) {
      this.log.warn('Failed to load cached token:', error);
      this.token = null;
    }
  }

  /**
   * Save token to persistent storage
   */
  private saveToken(token: OAuthToken): void {
    const temporaryTokenPath = `${this.tokenPath}.${process.pid}.tmp`;
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const storedToken: StoredOAuthToken = {
        version: 1,
        username: this.normalizedUsername,
        token,
      };
      // Write beside the destination and rename atomically so a crash cannot
      // leave a truncated credential file.
      fs.writeFileSync(temporaryTokenPath, JSON.stringify(storedToken, null, 2), { mode: 0o600 });
      fs.chmodSync(temporaryTokenPath, 0o600);
      fs.renameSync(temporaryTokenPath, this.tokenPath);
      fs.chmodSync(this.tokenPath, 0o600);
      this.log.debug('Saved authentication token to cache');
    } catch (error) {
      this.log.error('Failed to save token:', error);
    }
  }

  private get normalizedUsername(): string {
    return this.credentials.username.trim().toLowerCase();
  }

  private isStoredToken(value: unknown): value is StoredOAuthToken {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const stored = value as Partial<StoredOAuthToken>;
    const token = stored.token as Partial<OAuthToken> | undefined;

    return stored.version === 1
      && typeof stored.username === 'string'
      && !!token
      && typeof token.access_token === 'string'
      && token.access_token.length > 0
      && typeof token.expires_in === 'number'
      && Number.isFinite(token.expires_in)
      && token.expires_in > 0
      && typeof token.token_type === 'string'
      && token.token_type.length > 0
      && (token.scope === undefined || typeof token.scope === 'string')
      && (token.refresh_token === undefined || typeof token.refresh_token === 'string')
      && typeof token.issuedAt === 'number'
      && Number.isFinite(token.issuedAt);
  }

  private createToken(
    response: OAuthTokenResponse,
    fallbackRefreshToken?: string,
  ): OAuthToken {
    if (
      !response
      || typeof response.access_token !== 'string'
      || !response.access_token
      || typeof response.expires_in !== 'number'
      || !Number.isFinite(response.expires_in)
      || response.expires_in <= 0
      || typeof response.token_type !== 'string'
      || !response.token_type
    ) {
      throw new SomfyProtectApiError('Authentication server returned an invalid token response');
    }

    return {
      ...response,
      refresh_token: response.refresh_token || fallbackRefreshToken,
      issuedAt: Date.now(),
    };
  }

  /**
   * Check if current token is expired (with 60 second buffer)
   */
  private isTokenExpired(): boolean {
    if (!this.token || !this.token.issuedAt) {
      return true;
    }
    const expiresAt = this.token.issuedAt + (this.token.expires_in * 1000);
    const now = Date.now();
    const buffer = 60000; // 60 seconds
    return now >= (expiresAt - buffer);
  }

  /**
   * Request a new access token
   */
  private async requestNewToken(): Promise<OAuthToken> {
    this.log.debug('Requesting new access token');

    try {
      const params = new URLSearchParams({
        grant_type: 'password',
        client_id: this.credentials.oauthClientId,
        client_secret: this.credentials.oauthClientSecret,
        username: this.credentials.username,
        password: this.credentials.password,
      });

      const response = await this.axios.post<OAuthTokenResponse>('', params.toString());
      const token = this.createToken(response.data);

      this.token = token;
      this.saveToken(token);
      this.log.info('Successfully authenticated with Somfy Protect');
      return token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = status
          ? `Authentication failed (HTTP ${status})`
          : 'Authentication failed while contacting the Somfy Protect token endpoint';
        this.log.error(message);
        throw new SomfyProtectApiError(message, status);
      }
      throw error;
    }
  }

  /**
   * Refresh the access token using refresh token
   */
  private async refreshToken(): Promise<OAuthToken> {
    if (!this.token?.refresh_token) {
      return this.requestNewToken();
    }

    this.log.debug('Refreshing access token');

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.credentials.oauthClientId,
        client_secret: this.credentials.oauthClientSecret,
        refresh_token: this.token.refresh_token,
      });

      const existingRefreshToken = this.token.refresh_token;
      const response = await this.axios.post<OAuthTokenResponse>('', params.toString());
      const token = this.createToken(response.data, existingRefreshToken);

      this.token = token;
      this.saveToken(token);
      this.log.debug('Successfully refreshed access token');
      return token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        // If refresh fails, try to get a new token
        if (status === 400 || status === 401) {
          this.log.warn('Token refresh failed, requesting new token');
          return this.requestNewToken();
        }
        const message = status
          ? `Token refresh failed (HTTP ${status})`
          : 'Token refresh failed while contacting the Somfy Protect token endpoint';
        throw new SomfyProtectApiError(message, status);
      }
      throw error;
    }
  }

  /**
   * Get a valid access token (refreshes if needed)
   */
  public async getAccessToken(): Promise<string> {
    if (!this.token || this.isTokenExpired()) {
      await this.refreshAccessToken();
    }

    if (!this.token) {
      throw new SomfyProtectApiError('Failed to obtain access token');
    }

    return this.token.access_token;
  }

  /**
   * Force a token refresh (useful for error recovery)
   */
  public async forceRefresh(): Promise<void> {
    this.log.debug('Forcing token refresh');
    await this.refreshAccessToken();
  }

  private refreshAccessToken(): Promise<OAuthToken> {
    if (!this.tokenRefreshPromise) {
      this.tokenRefreshPromise = (async () => {
        try {
          if (this.token?.refresh_token) {
            return await this.refreshToken();
          }
          return await this.requestNewToken();
        } finally {
          this.tokenRefreshPromise = undefined;
        }
      })();
    }

    return this.tokenRefreshPromise;
  }

  /**
   * Clear cached token (useful for troubleshooting)
   */
  public clearToken(): void {
    this.token = null;
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
        this.log.info('Cleared cached authentication token');
      }
    } catch (error) {
      this.log.error('Failed to clear cached token:', error);
    }
  }
}
