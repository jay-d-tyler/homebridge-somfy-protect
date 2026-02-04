# Homebridge Somfy Protect

[![npm version](https://badge.fury.io/js/%40jay-d-tyler%2Fhomebridge-somfy-protect.svg)](https://badge.fury.io/js/%40jay-d-tyler%2Fhomebridge-somfy-protect)
[![npm](https://img.shields.io/npm/dt/@jay-d-tyler/homebridge-somfy-protect)](https://www.npmjs.com/package/@jay-d-tyler/homebridge-somfy-protect)

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

🚀 **Adaptive Polling**
- **NEW**: Intelligent polling that speeds up after state changes
- Fast polling (1s) right after arming/disarming for instant feedback
- Returns to normal polling (60s) when stable to minimize API calls
- Fully configurable polling intervals and duration
- Automatic retry on failure with exponential backoff
- Efficient token caching between restarts

🏠 **Multi-Site Support**
- Automatically discovers all sites on your account
- Configure specific site ID for accounts with multiple homes
- Clear logging of available sites

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
      "pollingInterval": 60000,
      "adaptivePolling": true,
      "fastPollingInterval": 1000,
      "fastPollingDuration": 60000,
      "debug": false
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
| \`pollingInterval\` | No | 60000 | Normal polling interval in milliseconds (5000-300000) |
| \`adaptivePolling\` | No | true | Enable adaptive polling (faster after changes) |
| \`fastPollingInterval\` | No | 1000 | Fast polling interval after state changes (1000-10000ms) |
| \`fastPollingDuration\` | No | 60000 | How long to use fast polling (10000-300000ms) |
| \`debug\` | No | false | Enable debug logging |

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
- [x] ~~Adaptive polling (faster after changes)~~ ✅ **Implemented in v2.0.2!**

---

Made with ❤️ for the Homebridge community
