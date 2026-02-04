# Homebridge Somfy Protect

[![npm version](https://badge.fury.io/js/%40jay-d-tyler%2Fhomebridge-somfy-protect.svg)](https://badge.fury.io/js/%40jay-d-tyler%2Fhomebridge-somfy-protect)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

Modern Homebridge plugin to integrate Somfy Protect home security systems with Apple HomeKit.

## Features

✨ **Modern & Reliable**
- Built from scratch with latest Homebridge best practices
- Modern TypeScript with full type safety
- Async/await throughout (no callbacks)
- Automatic token refresh with persistence
- Robust error handling with retry logic
- Comprehensive logging

🔐 **Security Features**
- Expose Somfy Protect alarm to HomeKit
- Arm (Away), Arm (Stay/Partial), and Disarm modes
- Real-time status updates via polling
- Automatic state synchronization

🚀 **Smart Polling**
- Configurable polling interval (5-60 seconds)
- Automatic retry on failure with exponential backoff
- Efficient token caching between restarts

🏠 **Multi-Site Support**
- Automatically discovers all sites on your account
- Configure specific site ID for accounts with multiple homes
- Clear logging of available sites

🌐 **HTTP API for Automation**
- Optional HTTP server for integration with automation systems
- Secure token-based authentication
- Trigger disarm actions from virtual switches or webhooks
- Perfect for complex automation scenarios

## Installation

### Via Homebridge Config UI X (Recommended)

1. Search for "Somfy Protect" in the Plugins tab
2. Click **Install**
3. Configure your credentials
4. Restart Homebridge

### Manual Installation

\`\`\`bash
npm install -g @jay-d-tyler/homebridge-somfy-protect
\`\`\`

## Configuration

Configure the plugin through the Homebridge Config UI X interface, or manually edit your \`config.json\`:

### Minimum Configuration

\`\`\`json
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
\`\`\`

### Full Configuration

\`\`\`json
{
  "platforms": [
    {
      "platform": "SomfyProtect",
      "name": "Somfy Protect",
      "username": "your.email@example.com",
      "password": "your-password",
      "siteId": "your-site-id-if-multiple-sites",
      "pollingInterval": 10000,
      "debug": false,
      "httpPort": 8581,
      "httpToken": "your-secret-token"
    }
  ]
}
\`\`\`

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| \`platform\` | Yes | - | Must be \`SomfyProtect\` |
| \`name\` | No | "Somfy Protect" | Name shown in Homebridge logs |
| \`username\` | Yes | - | Your Somfy Protect account email |
| \`password\` | Yes | - | Your Somfy Protect account password |
| \`siteId\` | No | (first site) | Specific site ID if you have multiple homes |
| \`pollingInterval\` | No | 10000 | Status update interval in milliseconds (5000-60000) |
| \`debug\` | No | false | Enable debug logging |
| \`httpPort\` | No | 8581 | Port for HTTP API server (set to 0 to disable) |
| \`httpToken\` | No | - | Optional security token for HTTP API |

## Finding Your Site ID

If you have multiple Somfy Protect sites (homes) on your account:

1. Start Homebridge with this plugin configured (without \`siteId\`)
2. Check the Homebridge logs
3. You'll see a message like:
   \`\`\`
   Multiple sites detected. Add "siteId" to config to select a specific site:
     - Home: abc123-site-id
     - Vacation Home: xyz789-site-id
   \`\`\`
4. Copy the site ID you want to use into your config

## HTTP API for Automation

The plugin includes an optional HTTP API server that allows other automation systems to trigger actions. This is useful for integrating with virtual switches, webhooks, or other automation platforms.

### Enabling the HTTP API

Add \`httpPort\` to your configuration:

\`\`\`json
{
  "platform": "SomfyProtect",
  "username": "your.email@example.com",
  "password": "your-password",
  "httpPort": 8581,
  "httpToken": "your-secret-token"
}
\`\`\`

- **httpPort**: Port number for the API server (default: 8581, set to 0 to disable)
- **httpToken**: Optional security token (highly recommended)

### Using the HTTP API

#### Disarm All Alarms

\`\`\`bash
# Without authentication
curl -X POST http://localhost:8581/disarm

# With authentication token
curl -X POST http://localhost:8581/disarm \\
  -H "Authorization: Bearer your-secret-token"
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "message": "Disarm command sent"
}
\`\`\`

### Security Considerations

- **Always use httpToken** in production environments
- The API only accepts connections from your local network
- Consider using a firewall to restrict access to the API port
- The token must be sent in the \`Authorization\` header as a Bearer token

### Example: Virtual Switch Integration

You can use this API with automation plugins like [homebridge-http-switch](https://github.com/Supereg/homebridge-http-switch) to create virtual switches that trigger disarm:

\`\`\`json
{
  "accessory": "HTTP-SWITCH",
  "name": "Disarm Alarm",
  "onUrl": "http://localhost:8581/disarm",
  "httpMethod": "POST",
  "headers": {
    "Authorization": "Bearer your-secret-token"
  }
}
\`\`\`

## Supported Devices

Currently, the plugin exposes:
- **Alarm System** - Main security system with arm/disarm controls

### HomeKit Security States

| Somfy Protect | HomeKit |
|---------------|---------|
| Armed | Away Arm |
| Partial | Stay Arm |
| Disarmed | Disarmed |

## Troubleshooting

### Authentication Issues

If you see authentication errors:

1. Verify your username and password are correct
2. Try logging into the Somfy Protect mobile app to ensure your account is active
3. Enable debug logging in config
4. Check Homebridge logs for detailed error messages

### Clear Cached Token

If you're having persistent authentication issues, you can clear the cached token:

\`\`\`bash
rm ~/.homebridge/somfy-protect-token.json
\`\`\`

Then restart Homebridge.

### Enable Debug Logging

Set \`"debug": true\` in your config to see detailed API calls and responses.

## Improvements Over Original Plugin

This is a complete rewrite of the original \`homebridge-somfy-protect\` plugin with significant improvements:

### Reliability
- ✅ Fixed token management bug (missing \`await\`)
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
- [ ] Adaptive polling (faster after changes)

---

Made with ❤️ for the Homebridge community
