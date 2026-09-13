export default {
  testDir: './tests', testMatch: '**/ui.spec.js',
  use: { channel: 'msedge', headless: true, viewport: { width: 1120, height: 780 } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: false },
};
