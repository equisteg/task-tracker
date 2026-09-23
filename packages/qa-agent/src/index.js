export * from './diagnostics.js';
export * from './healer.js';
export * from './reporter.js';
export * from './runner.js';
export * from './daemon.js';

import { QARunner } from './runner.js';
import { QADaemon } from './daemon.js';

async function main() {
  const args = process.argv.slice(2);
  const isDaemon = args.includes('--daemon');
  const autoHeal = !args.includes('--no-heal');
  const baseUrl = args.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:8000/index.html';
  const cdpPort = parseInt(args.find(a => a.startsWith('--cdp='))?.split('=')[1] || '9222', 10);

  if (isDaemon) {
    const hours = parseInt(args.find(a => a.startsWith('--hours='))?.split('=')[1] || '24', 10);
    const daemon = new QADaemon(hours, baseUrl, cdpPort);
    daemon.start();
  } else {
    const runner = new QARunner(baseUrl, cdpPort);
    try {
      const report = await runner.runAll(autoHeal);
      const exitCode = report.failedTests === 0 ? 0 : 1;
      process.exit(exitCode);
    } catch (err) {
      console.error('Fatal QA Runner error:', err);
      process.exit(1);
    }
  }
}

// If invoked directly from CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.js')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
