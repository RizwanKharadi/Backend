const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const electronLog = require('electron-log');

const AGENT_DATA_DIR = path.join(os.homedir(), '.finsync360-agent');
const LOGS_DIR = path.join(AGENT_DATA_DIR, 'logs');
const MAIN_LOG_FILE = path.join(LOGS_DIR, 'main.log');
const VOUCHER_SYNC_LOG_FILE = path.join(LOGS_DIR, 'voucher-sync.log');

let loggingConfigured = false;
let voucherSyncLogger = null;

function formatDetailValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return value.stack || value.message || String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDetails(details = {}) {
  const parts = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatDetailValue(value)}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

class VoucherSyncDiagnosticLog {
  constructor(logFilePath) {
    this.logFilePath = logFilePath;
    this.scopeLogger = electronLog.scope('VoucherSync');
    fs.ensureDirSync(path.dirname(logFilePath));
  }

  write(level, event, details = {}) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${event}${formatDetails(details)}\n`;

    try {
      fs.appendFileSync(this.logFilePath, line, 'utf8');
    } catch (error) {
      electronLog.error('Failed to write voucher-sync.log', { message: error.message });
    }

    const scoped = this.scopeLogger[level] || this.scopeLogger.info;
    scoped.call(this.scopeLogger, event, details);
  }

  info(event, details) {
    this.write('info', event, details);
  }

  warn(event, details) {
    this.write('warn', event, details);
  }

  error(event, details) {
    this.write('error', event, details);
  }

  getLogFilePath() {
    return this.logFilePath;
  }
}

function configureAgentLogging(options = {}) {
  if (loggingConfigured) {
    return getAgentLogPaths();
  }

  fs.ensureDirSync(LOGS_DIR);

  const maxLogSize =
    typeof options.maxLogSize === 'number'
      ? options.maxLogSize
      : 10 * 1024 * 1024;

  electronLog.transports.file.level = options.fileLevel || 'info';
  electronLog.transports.console.level = options.consoleLevel || 'debug';
  electronLog.transports.file.resolvePathFn = () => MAIN_LOG_FILE;
  electronLog.transports.file.maxSize = maxLogSize;

  loggingConfigured = true;
  voucherSyncLogger = new VoucherSyncDiagnosticLog(VOUCHER_SYNC_LOG_FILE);

  electronLog.info('Agent logging configured', {
    dataDir: AGENT_DATA_DIR,
    logsDir: LOGS_DIR,
    mainLogFile: MAIN_LOG_FILE,
    voucherSyncLogFile: VOUCHER_SYNC_LOG_FILE
  });

  return getAgentLogPaths();
}

function getVoucherSyncLogger() {
  if (!voucherSyncLogger) {
    configureAgentLogging();
  }
  return voucherSyncLogger;
}

function getAgentLogPaths() {
  return {
    dataDir: AGENT_DATA_DIR,
    logsDir: LOGS_DIR,
    mainLogFile: MAIN_LOG_FILE,
    voucherSyncLogFile: VOUCHER_SYNC_LOG_FILE,
    syncStateFile: path.join(AGENT_DATA_DIR, 'sync-state.json')
  };
}

module.exports = {
  AGENT_DATA_DIR,
  LOGS_DIR,
  MAIN_LOG_FILE,
  VOUCHER_SYNC_LOG_FILE,
  configureAgentLogging,
  getVoucherSyncLogger,
  getAgentLogPaths
};
