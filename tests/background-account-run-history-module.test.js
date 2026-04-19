const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports account run history module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/account-run-history\.js/);
});

test('account run history module exposes a factory', () => {
  const source = fs.readFileSync('background/account-run-history.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundAccountRunHistory;`)(globalScope);

  assert.equal(typeof api?.createAccountRunHistoryHelpers, 'function');
});

test('account run history helper normalizes records and persists without helper upload when local helper is disabled', async () => {
  const source = fs.readFileSync('background/account-run-history.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundAccountRunHistory;`)(globalScope);

  let storedHistory = [{ email: 'old@example.com', password: 'old-pass', status: 'success', recordedAt: '2026-04-17T00:00:00.000Z' }];
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not call fetch');
  };

  const helpers = api.createAccountRunHistoryHelpers({
    ACCOUNT_RUN_HISTORY_STORAGE_KEY: 'accountRunHistory',
    addLog: async () => {},
    buildLocalHelperEndpoint: (baseUrl, path) => `${baseUrl}${path}`,
    chrome: {
      storage: {
        local: {
          get: async () => ({ accountRunHistory: storedHistory }),
          set: async (payload) => {
            storedHistory = payload.accountRunHistory;
          },
        },
      },
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getState: async () => ({
      email: ' latest@example.com ',
      password: ' secret ',
      accountRunHistoryTextEnabled: false,
      accountRunHistoryHelperBaseUrl: '',
    }),
    normalizeAccountRunHistoryHelperBaseUrl: (value) => String(value || '').trim(),
  });

  const record = helpers.buildAccountRunHistoryRecord(
    { email: ' latest@example.com ', password: ' secret ' },
    ' FAILED ',
    ' reason '
  );
  assert.deepStrictEqual(record, {
    email: 'latest@example.com',
    password: 'secret',
    status: 'failed',
    recordedAt: record.recordedAt,
    reason: 'reason',
  });

  const appended = await helpers.appendAccountRunRecord('failed', null, 'boom');
  assert.equal(appended.email, 'latest@example.com');
  assert.equal(appended.status, 'failed');
  assert.equal(storedHistory.length, 2);
  assert.equal(storedHistory[1].reason, 'boom');
  assert.equal(fetchCalled, false);
  assert.equal(helpers.shouldAppendAccountRunTextFile({ accountRunHistoryTextEnabled: false, accountRunHistoryHelperBaseUrl: 'http://127.0.0.1:17373' }), false);
  assert.equal(helpers.shouldAppendAccountRunTextFile({ accountRunHistoryTextEnabled: true, accountRunHistoryHelperBaseUrl: 'http://127.0.0.1:17373' }), true);
});

test('account run history helper deletes selected records and syncs remaining snapshot payload', async () => {
  const source = fs.readFileSync('background/account-run-history.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundAccountRunHistory;`)(globalScope);

  let storedHistory = [
    {
      recordId: 'keep@example.com',
      email: 'keep@example.com',
      password: 'secret',
      finalStatus: 'success',
      finishedAt: '2026-04-17T01:10:00.000Z',
      retryCount: 0,
      failureLabel: '流程完成',
      failureDetail: '',
      failedStep: null,
      source: 'manual',
      autoRunContext: null,
    },
    {
      recordId: 'remove@example.com',
      email: 'remove@example.com',
      password: 'secret',
      finalStatus: 'failed',
      finishedAt: '2026-04-17T01:00:00.000Z',
      retryCount: 2,
      failureLabel: '步骤 8 失败',
      failureDetail: '步骤 8：认证页异常',
      failedStep: 8,
      source: 'auto',
      autoRunContext: {
        currentRun: 1,
        totalRuns: 5,
        attemptRun: 3,
      },
    },
  ];
  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({
      url,
      options,
    });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        filePath: 'C:/tmp/account-run-history.json',
      }),
    };
  };

  const logs = [];
  const helpers = api.createAccountRunHistoryHelpers({
    ACCOUNT_RUN_HISTORY_STORAGE_KEY: 'accountRunHistory',
    addLog: async (message, level) => {
      logs.push({ message, level });
    },
    buildLocalHelperEndpoint: (baseUrl, path) => `${baseUrl}${path}`,
    chrome: {
      storage: {
        local: {
          get: async () => ({ accountRunHistory: storedHistory }),
          set: async (payload) => {
            storedHistory = payload.accountRunHistory;
          },
        },
      },
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getState: async () => ({
      accountRunHistoryTextEnabled: true,
      accountRunHistoryHelperBaseUrl: 'http://127.0.0.1:17373',
    }),
    normalizeAccountRunHistoryHelperBaseUrl: (value) => String(value || '').trim(),
  });

  const result = await helpers.deleteAccountRunHistoryRecords(['remove@example.com']);
  assert.deepStrictEqual(result, {
    deletedCount: 1,
    remainingCount: 1,
  });
  assert.equal(storedHistory.length, 1);
  assert.equal(storedHistory[0].email, 'keep@example.com');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://127.0.0.1:17373/sync-account-run-records');
  assert.deepStrictEqual(JSON.parse(fetchCalls[0].options.body), {
    generatedAt: JSON.parse(fetchCalls[0].options.body).generatedAt,
    summary: {
      total: 1,
      success: 1,
      failed: 0,
      stopped: 0,
      retryTotal: 0,
    },
    records: storedHistory,
  });
  assert.equal(logs[0].message, '账号记录快照已同步到本地：C:/tmp/account-run-history.json');
});
