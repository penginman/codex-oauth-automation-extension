const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/verification-flow.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundVerificationFlow;`)(globalScope);

test('verification flow extends 2925 polling window', () => {
  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async () => ({}),
    sendToMailContentScriptResilient: async () => ({}),
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const step4Payload = helpers.getVerificationPollPayload(4, { email: 'user@example.com', mailProvider: '2925' });
  const step7Payload = helpers.getVerificationPollPayload(7, { email: 'user@example.com', mailProvider: '2925' });

  assert.equal(step4Payload.maxAttempts, 15);
  assert.equal(step4Payload.intervalMs, 15000);
  assert.equal(step7Payload.maxAttempts, 15);
  assert.equal(step7Payload.intervalMs, 15000);
});

test('verification flow runs beforeSubmit hook before filling the code', async () => {
  const events = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload.code]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastLoginCode || payload.lastSignupCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    7,
    { email: 'user@example.com', lastLoginCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    {
      beforeSubmit: async (result) => {
        events.push(['beforeSubmit', result.code]);
      },
    }
  );

  assert.deepStrictEqual(events, [
    ['beforeSubmit', '654321'],
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', '654321'],
  ]);
});
