import type { Logging } from 'homebridge';
import axios, { type AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { API_CONFIG } from './settings.js';
import { type OAuthToken, SomfyProtectApiError } from './types.js';

/**
 * Handles authentication and token management for Somfy Protect API
 */
export class SomfyProtectAuth {
  private token: OAuthToken | null = null;
  private readonly tokenPath: string;
  private readonly axios: AxiosInstance;

  constructor(
    private readonly log: Logging,
    private readonly username: string,
    private readonly password: string,
    storagePath: string,
  ) {
    this.tokenPath = path.join(storagePath, 'somfy-protect-token.json');
    this.axios = axios.create({
      baseURL: API_CONFIG.TOKEN_URL,
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
        this.token = JSON.parse(data);
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
  private saveToken(): void {
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.tokenPath, JSON.stringify(this.token, null, 2));
      this.log.debug('Saved authentication token to cache');
    } catch (error) {
      this.log.error('Failed to save token:', error);
    }
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
        client_id: API_CONFIG.CLIENT_ID,
        client_secret: API_CONFIG.CLIENT_SECRET,
        username: this.username,
        password: this.password,
      });

      const response = await this.axios.post<OAuthToken>('', params.toString());
      const token: OAuthToken = {
        ...response.data,
        issuedAt: Date.now(),
      };

      this.token = token;
      this.saveToken();
      this.log.info('Successfully authenticated with Somfy Protect');
      return token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.error_description || error.message;
        this.log.error('Authentication failed:', message);
        throw new SomfyProtectApiError(
          `Authentication failed: ${message}`,
          status,
          error.response?.data,
        );
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
        client_id: API_CONFIG.CLIENT_ID,
        client_secret: API_CONFIG.CLIENT_SECRET,
        refresh_token: this.token.refresh_token,
      });

      const response = await this.axios.post<OAuthToken>('', params.toString());
      const token: OAuthToken = {
        ...response.data,
        issuedAt: Date.now(),
      };

      this.token = token;
      this.saveToken();
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
        const message = error.response?.data?.error_description || error.message;
        throw new SomfyProtectApiError(
          `Token refresh failed: ${message}`,
          status,
          error.response?.data,
        );
      }
      throw error;
    }
  }

  /**
   * Get a valid access token (refreshes if needed)
   */
  public async getAccessToken(): Promise<string> {
    if (!this.token || this.isTokenExpired()) {
      if (this.token?.refresh_token) {
        await this.refreshToken();
      } else {
        await this.requestNewToken();
      }
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
    if (this.token?.refresh_token) {
      await this.refreshToken();
    } else {
      await this.requestNewToken();
    }
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
