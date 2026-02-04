/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'SomfyProtect';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-somfy-protect';

/**
 * Somfy Protect API Configuration
 */
export const API_CONFIG = {
  BASE_URL: 'https://api.myfox.io',
  TOKEN_URL: 'https://sso.myfox.io/oauth/oauth/v2/token',
  // OAuth credentials (base64 decoded from official app)
  CLIENT_ID: Buffer.from(
    'ODRlZGRmNDgtMmI4ZS0xMWU1LWIyYTUtMTI0Y2ZhYjI1NTk1XzQ3NWJ1cXJmOHY4a2d3b280Z293MDhna2tjMGNrODA0ODh3bzQ0czhvNDhzZzg0azQw',
    'base64',
  ).toString('utf-8'),
  CLIENT_SECRET: Buffer.from(
    'NGRzcWZudGlldTB3Y2t3d280MGt3ODQ4Z3c0bzBjOGs0b3djODBrNGdvMGNzMGs4NDQ=',
    'base64',
  ).toString('utf-8'),
};

/**
 * Polling Configuration
 */
export const POLLING_CONFIG = {
  INITIAL_INTERVAL: 10000, // 10 seconds
  FAST_INTERVAL: 5000, // 5 seconds (after state change)
  SLOW_INTERVAL: 30000, // 30 seconds (when stable)
  FAST_POLLING_DURATION: 60000, // 1 minute of fast polling after change
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000, // 5 seconds between retries
};
