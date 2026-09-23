import { QARunner } from './runner.js';

export class QADaemon {
  private runner: QARunner;
  private intervalMs: number;
  private timer: any = null;
  private isRunning: boolean = false;

  constructor(intervalHours = 24, baseUrl?: string, cdpPort?: number) {
    this.intervalMs = intervalHours * 60 * 60 * 1000;
    this.runner = new QARunner(baseUrl, cdpPort);
  }

  start() {
    console.log(`🤖 [QA DAEMON] Starting continuous background supervisor...`);
    console.log(`⏱️ [QA DAEMON] Schedule: Executing automatically every ${this.intervalMs / (60 * 60 * 1000)} hours.`);

    // Run first iteration immediately
    this.executeAudit();

    // Schedule recurring daily audit
    this.timer = setInterval(() => {
      this.executeAudit();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log(`🛑 [QA DAEMON] Supervisor stopped.`);
    }
  }

  private async executeAudit() {
    if (this.isRunning) {
      console.log(`⚠️ [QA DAEMON] Previous audit cycle still in progress. Skipping turn.`);
      return;
    }
    this.isRunning = true;
    console.log(`\n======================================================================`);
    console.log(`📅 [QA DAEMON] TRIGGERING SCHEDULED DAILY E2E QA & HEALTH AUDIT`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    console.log(`======================================================================\n`);

    try {
      const result = await this.runner.runAll(true);
      console.log(`✅ [QA DAEMON] Daily audit completed. Health: ${result.overallHealthScore}%`);
      if (result.heals.length > 0) {
        console.log(`🤖 [QA DAEMON] Agent autonomously resolved ${result.heals.length} issues without manual intervention.`);
      }
    } catch (err) {
      console.error(`❌ [QA DAEMON] Daily audit encountered an error:`, err);
    } finally {
      this.isRunning = false;
    }
  }
}
