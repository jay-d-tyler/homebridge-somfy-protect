/**
 * Somfy Protect API Types
 */

export interface SomfyProtectConfig {
  platform: string;
  name?: string;
  username: string;
  password: string;
  siteId?: string;
  pollingInterval?: number;
  adaptivePolling?: boolean;
  fastPollingInterval?: number;
  fastPollingDuration?: number;
  httpPort?: number;
  httpToken?: string;
  httpHost?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
}

export interface OAuthToken extends OAuthTokenResponse {
  issuedAt: number; // Timestamp when token was issued
}

export interface Site {
  site_id: string;
  label: string;
  security_level: SecurityLevel;
  name?: string;
  brand?: unknown;
  diagnosis?: unknown;
}

export type SecurityLevel = 'disarmed' | 'armed' | 'partial';

export function isSecurityLevel(value: unknown): value is SecurityLevel {
  return value === 'disarmed' || value === 'armed' || value === 'partial';
}

export interface SetSecurityLevelResponse {
  task_id: string;
  site_id: string;
}

/**
 * Homebridge API Error
 */
export class SomfyProtectApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown,
  ) {
    super(message);
    this.name = 'SomfyProtectApiError';
  }
}
