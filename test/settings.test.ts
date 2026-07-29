import fs from 'fs';
import path from 'path';
import { PLUGIN_VERSION } from '../src/settings.js';

describe('plugin metadata', () => {
  it('should keep the HomeKit firmware revision aligned with package.json', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { version: string };

    expect(PLUGIN_VERSION).toBe(packageJson.version);
  });
});
