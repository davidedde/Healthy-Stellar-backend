import { pushLogEntry, getRecentLogs, LogEntry } from './incident-log.buffer';

describe('incident-log.buffer', () => {
  describe('pushLogEntry / getRecentLogs', () => {
    it('pushes and retrieves log entries', () => {
      const entry: LogEntry = {
        level: 'info',
        message: 'Test message',
        timestamp: new Date().toISOString(),
        context: 'TestContext',
      };
      pushLogEntry(entry);

      const logs = getRecentLogs(1);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual(entry);
    });

    it('returns at most n entries', () => {
      for (let i = 0; i < 10; i++) {
        pushLogEntry({
          level: 'info',
          message: `msg-${i}`,
          timestamp: new Date().toISOString(),
        });
      }
      const logs = getRecentLogs(3);
      expect(logs.length).toBeLessThanOrEqual(3);
    });

    it('returns newest entries (from tail of buffer)', () => {
      pushLogEntry({
        level: 'info',
        message: 'old-entry',
        timestamp: new Date().toISOString(),
      });
      pushLogEntry({
        level: 'info',
        message: 'newest-entry',
        timestamp: new Date().toISOString(),
      });

      const logs = getRecentLogs(1);
      expect(logs[0].message).toBe('newest-entry');
    });

    it('defaults to returning up to 50 entries', () => {
      const logs = getRecentLogs();
      expect(logs.length).toBeLessThanOrEqual(50);
    });

    it('includes optional traceId when provided', () => {
      pushLogEntry({
        level: 'warn',
        message: 'traced',
        timestamp: new Date().toISOString(),
        traceId: 'trace-abc',
      });

      const logs = getRecentLogs(1);
      expect(logs[0].traceId).toBe('trace-abc');
    });
  });
});
