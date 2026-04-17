const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/steps/oauth-login.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundStep6;`)(globalScope);

test('step 6 retries up to configured limit and then fails', async () => {
  const events = {
    cleanupCalls: 0,
    refreshCalls: 0,
    sendCalls: 0,
    completed: 0,
  };

  const executor = api.createStep6Executor({
    addLog: async () => {},
    completeStepFromBackground: async () => {
      events.completed += 1;
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getLoginAuthStateLabel: (state) => state || 'unknown',
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    isStep6RecoverableResult: (result) => result?.step6Outcome === 'recoverable',
    isStep6SuccessResult: (result) => result?.step6Outcome === 'success',
    refreshOAuthUrlBeforeStep6: async () => {
      events.refreshCalls += 1;
      return `https://oauth.example/${events.refreshCalls}`;
    },
    reuseOrCreateTab: async () => {},
    runPreStep6CookieCleanup: async () => {
      events.cleanupCalls += 1;
    },
    sendToContentScriptResilient: async () => {
      events.sendCalls += 1;
      return {
        step6Outcome: 'recoverable',
        state: 'email_page',
        message: '当前仍停留在邮箱页',
      };
    },
    shouldSkipLoginVerificationForCpaCallback: () => false,
    skipLoginVerificationStepsForCpaCallback: async () => {},
    STEP6_MAX_ATTEMPTS: 3,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep6({ email: 'user@example.com', password: 'secret' }),
    /已重试 2 次，仍未成功/
  );

  assert.equal(events.cleanupCalls, 1);
  assert.equal(events.refreshCalls, 3);
  assert.equal(events.sendCalls, 3);
  assert.equal(events.completed, 0);
});

test('step 6 can skip pre-login cleanup during step 7 recovery replay', async () => {
  const events = {
    cleanupCalls: 0,
    completedPayloads: [],
  };

  const executor = api.createStep6Executor({
    addLog: async () => {},
    completeStepFromBackground: async (step, payload) => {
      events.completedPayloads.push({ step, payload });
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getLoginAuthStateLabel: (state) => state || 'unknown',
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    isStep6RecoverableResult: () => false,
    isStep6SuccessResult: (result) => result?.step6Outcome === 'success',
    refreshOAuthUrlBeforeStep6: async () => 'https://oauth.example/latest',
    reuseOrCreateTab: async () => {},
    runPreStep6CookieCleanup: async () => {
      events.cleanupCalls += 1;
    },
    sendToContentScriptResilient: async () => ({
      step6Outcome: 'success',
      loginVerificationRequestedAt: 123,
    }),
    shouldSkipLoginVerificationForCpaCallback: () => false,
    skipLoginVerificationStepsForCpaCallback: async () => {},
    STEP6_MAX_ATTEMPTS: 3,
    throwIfStopped: () => {},
  });

  await executor.executeStep6(
    { email: 'user@example.com', password: 'secret' },
    { skipPreLoginCleanup: true }
  );

  assert.equal(events.cleanupCalls, 0);
  assert.deepStrictEqual(events.completedPayloads, [
    {
      step: 6,
      payload: { loginVerificationRequestedAt: 123 },
    },
  ]);
});
