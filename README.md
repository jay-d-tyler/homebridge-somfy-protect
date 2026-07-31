# Homebridge Somfy Protect

[![npm version](https://badge.fury.io/js/%40jay-d-tyler%2Fhomebridge-somfy-protect.svg)](https://badge.fury.io/js/%40jay-d-tyler%2Fhomebridge-somfy-protect)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

Modern Homebridge plugin to integrate Somfy Protect home security systems with Apple HomeKit.

## Features

✨ **Modern & Reliable**
- Built from scratch with latest Homebridge best practices
- Modern TypeScript with full type safety
- Promise-based API and lifecycle handling
- Automatic token refresh with persistence
- Robust error handling with retry logic
- Comprehensive logging

🔐 **Security Features**
- Expose Somfy Protect alarm to HomeKit
- Arm (Away), Arm (Stay/Partial), and Disarm modes
- Responsive status updates via adaptive polling
- Automatic state synchronization

🚀 **Smart Polling**
- Adaptive polling: fast (1s) updates right after a state change, slow (60s) when stable
- Configurable polling intervals (5-300 seconds)
- Bounded retries with backoff and jitter
- Efficient token caching between restarts

🏠 **Multi-Site Support**
- Automatically discovers all sites on your account
- Configure specific site ID for accounts with multiple homes
- Clear logging of available sites

🌐 **HTTP API for Automation**
- Optional HTTP server for integration with automation systems
- Secure token-based authentication
- Trigger Away, Night/Partial, and Disarm actions from virtual switches or webhooks
- Perfect for complex automation scenarios

## Installation

### Via Homebridge Config UI X (Recommended)

1. Search for "Somfy Protect" in the Plugins tab
2. Click **Install**
3. Configure your credentials
4. Restart Homebridge

### Manual Installation

```bash
npm install -g @jay-d-tyler/homebridge-somfy-protect
```

## Configuration

Configure the plugin through the Homebridge Config UI X interface, or manually edit your `config.json`:

### Minimum Configuration

```json
{
  "platforms": [
    {
      "platform": "SomfyProtect",
      "name": "Somfy Protect",
      "username": "your.email@example.com",
      "password": "your-password"
    }
  ]
}
```

### Full Configuration

```json
{
  "platforms": [
    {
      "platform": "SomfyProtect",
      "name": "Somfy Protect",
      "username": "your.email@example.com",
      "password": "your-password",
      "siteId": "your-site-id-if-multiple-sites",
      "pollingInterval": 60000,
      "adaptivePolling": true,
      "fastPollingInterval": 1000,
      "fastPollingDuration": 60000,
      "httpPort": 8582,
      "httpToken": "your-secret-token",
      "httpHost": "127.0.0.1"
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | - | Must be `SomfyProtect` |
| `name` | No | "Somfy Protect" | Name shown in Homebridge logs |
| `username` | Yes | - | Your Somfy Protect account email |
| `password` | Yes | - | Your Somfy Protect account password |
| `siteId` | No | (first site) | Specific site ID if you have multiple homes |
| `pollingInterval` | No | 60000 | Normal status update interval in milliseconds (5000-300000) |
| `adaptivePolling` | No | true | Poll faster right after a state change, then slow back down |
| `fastPollingInterval` | No | 1000 | Poll interval after a state change in milliseconds (1000-10000) |
| `fastPollingDuration` | No | 60000 | How long to fast-poll after a state change in milliseconds |
| `httpPort` | No | 0 (disabled) | Port for HTTP API server; avoid 8581, which the Homebridge UI uses |
| `httpToken` | When HTTP API enabled | - | Required Bearer token when `httpPort` is non-zero |
| `httpHost` | No | 127.0.0.1 | Bind address for the HTTP API; use `0.0.0.0` only when LAN access is required |

## Finding Your Site ID

If you have multiple Somfy Protect sites (homes) on your account:

1. Start Homebridge with this plugin configured (without `siteId`)
2. Check the Homebridge logs
3. You'll see a message like:
   ```
   Multiple sites detected. Add "siteId" to config to select a specific site:
     - Home: abc123-site-id
     - Vacation Home: xyz789-site-id
   ```
4. Copy the site ID you want to use into your config

## HTTP API for Automation

The plugin includes an optional HTTP API server that allows other automation systems to trigger actions. This is useful for integrating with virtual switches, webhooks, or other automation platforms.

### Enabling the HTTP API

Add `httpPort` to your configuration:

```json
{
  "platform": "SomfyProtect",
  "username": "your.email@example.com",
  "password": "your-password",
  "httpPort": 8582,
  "httpToken": "your-secret-token",
  "httpHost": "127.0.0.1"
}
```

- **httpPort**: Port number for the API server (default: 0 = disabled). Avoid 8581 — the Homebridge UI usually runs there.
- **httpToken**: Required security token. The HTTP API refuses to start without it.
- **httpHost**: Bind address (default: `127.0.0.1`, accessible only from the Homebridge host). Set `0.0.0.0` only for integrations running elsewhere on your LAN.

### Using the HTTP API

Every endpoint requires the configured Bearer token.

```bash
# Disarm all alarms
curl -X POST http://localhost:8582/disarm \
  -H "Authorization: Bearer your-secret-token"

# Arm Away
curl -X POST http://localhost:8582/arm/away \
  -H "Authorization: Bearer your-secret-token"

# Arm Night (Somfy Partial)
curl -X POST http://localhost:8582/arm/night \
  -H "Authorization: Bearer your-secret-token"
```

| Endpoint | Somfy security level |
|----------|----------------------|
| `POST /disarm` | `disarmed` |
| `POST /arm/away` | `armed` |
| `POST /arm/night` | `partial` |

**Successful response:**

```json
{
  "success": true,
  "message": "Away arm command sent"
}
```

### Security Considerations

- **httpToken is mandatory whenever the HTTP API is enabled.** Requests without the correct token are rejected.
- The server listens on **localhost only by default**. If you deliberately bind to `0.0.0.0`, use a firewall to restrict access to the API port.
- The token must be sent in the `Authorization` header as a Bearer token
- The API is disabled by default (`httpPort` unset or 0)

### Example: Virtual Switch Integration

You can use this API with automation plugins like [homebridge-http-switch](https://github.com/Supereg/homebridge-http-switch) to create virtual switches that trigger disarm:

```json
{
  "accessory": "HTTP-SWITCH",
  "name": "Disarm Alarm",
  "onUrl": "http://localhost:8582/disarm",
  "httpMethod": "POST",
  "headers": {
    "Authorization": "Bearer your-secret-token"
  }
}
```

## Supported Devices

Currently, the plugin exposes:
- **Alarm System** - Main security system with arm/disarm controls

### HomeKit Security States

| Somfy Protect | HomeKit |
|---------------|---------|
| Armed | Away Arm |
| Partial | Night Arm |
| Disarmed | Disarmed |

## Troubleshooting

### Authentication Issues

If you see authentication errors:

1. Verify your username and password are correct
2. Try logging into the Somfy Protect mobile app to ensure your account is active
3. Enable Homebridge debug logging
4. Check Homebridge logs for detailed error messages

### Clear Cached Token

If you're having persistent authentication issues, you can clear the cached token:

```bash
rm ~/.homebridge/somfy-protect-token.json
```

Then restart Homebridge.

### Enable Debug Logging

Start Homebridge with debug logging enabled (for example, `homebridge -D`) to see detailed API calls and responses.

## Improvements Over Original Plugin

This is a complete rewrite of the original `homebridge-somfy-protect` plugin with significant improvements:

### Reliability
- ✅ Fixed token management bug (missing `await`)
- ✅ Proper error handling with retry logic
- ✅ Token persistence across restarts
- ✅ Automatic token refresh
- ✅ Recovery from API failures

### Modern Code
- ✅ Updated to latest Homebridge API (onGet/onSet)
- ✅ Latest dependencies (axios 1.7+, Node 20+)
- ✅ Full TypeScript with proper types
- ✅ ES modules
- ✅ No deprecated patterns

### Security
- ✅ No known vulnerabilities in dependencies
- ✅ Secure token storage
- ✅ Proper credential handling

### Developer Experience
- ✅ Comprehensive logging
- ✅ Clear error messages
- ✅ Easy configuration via UI
- ✅ Well-documented code

## API Information

This plugin uses the unofficial Somfy Protect API (formerly MyFox). The API endpoints and OAuth credentials are reverse-engineered from the official mobile app.

**Note**: Since this is an unofficial API, Somfy could change or revoke access at any time.

## Credits

- Original plugin by [alxscms](https://github.com/alxscms/homebridge-somfy-protect)
- API reference from [somfy-protect-api](https://github.com/Minims/somfy-protect-api)
- Built with [Homebridge Plugin Template](https://github.com/homebridge/homebridge-plugin-template)

## License

Apache-2.0

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Roadmap

Future enhancements planned:
- [ ] Individual device support (cameras, sensors, detectors)
- [ ] Battery level monitoring
- [ ] Camera snapshot support
- [ ] Webhook support (if API allows)

---

Made with ❤️ for the Homebridge community
