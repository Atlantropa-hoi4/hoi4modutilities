import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from '@vscode/test-cli';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  version: 'stable',
  extensionDevelopmentPath: __dirname,
  workspaceFolder: path.join(__dirname, 'test', 'fixtures', 'workspace'),
  mocha: {
    timeout: 60000,
  },
});
