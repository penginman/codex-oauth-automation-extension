const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports generated email helper module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /importScripts\([\s\S]*'background\/generated-email-helpers\.js'/);
});

test('generated email helper module exposes a factory', () => {
  const source = fs.readFileSync('background/generated-email-helpers.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageGeneratedEmailHelpers;`)(globalScope);

  assert.equal(typeof api?.createGeneratedEmailHelpers, 'function');
});

test('background script parses without duplicate top-level declarations', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  assert.doesNotThrow(() => {
    new Function(source);
  });
});

test('generated email helper routes icloud standard alias through icloud mail content script', async () => {
  const source = fs.readFileSync('background/generated-email-helpers.js', 'utf8');
  const globalScope = {};
  const moduleApi = new Function('self', `${source}; return self.MultiPageGeneratedEmailHelpers;`)(globalScope);

  const calls = {
    logs: [],
    reusedTabs: [],
    messages: [],
    setEmail: [],
  };

  const helpers = moduleApi.createGeneratedEmailHelpers({
    addLog: async (message, level = 'info') => { calls.logs.push({ message, level }); },
    buildCloudflareTempEmailHeaders: () => ({}),
    CLOUDFLARE_TEMP_EMAIL_GENERATOR: 'cloudflare-temp-email',
    DUCK_AUTOFILL_URL: 'https://duckduckgo.com/email/settings/autofill',
    fetch: async () => { throw new Error('unexpected fetch'); },
    fetchIcloudHideMyEmail: async () => { throw new Error('should not use hide my email path'); },
    getConfiguredIcloudHostPreference: () => 'icloud.com.cn',
    getCloudflareTempEmailAddressFromResponse: () => '',
    getCloudflareTempEmailConfig: () => ({}),
    getIcloudMailUrlForHost: (host) => host === 'icloud.com.cn' ? 'https://www.icloud.com.cn/mail/' : 'https://www.icloud.com/mail/',
    getState: async () => ({ emailGenerator: 'icloud-standard-alias', preferredIcloudHost: 'icloud.com' }),
    joinCloudflareTempEmailUrl: () => '',
    normalizeIcloudHost: (value = '') => String(value || '').trim().toLowerCase(),
    normalizeCloudflareDomain: (value = '') => String(value || '').trim().toLowerCase(),
    normalizeCloudflareTempEmailAddress: (value = '') => String(value || '').trim().toLowerCase(),
    normalizeEmailGenerator: (value = '') => String(value || '').trim().toLowerCase() || 'duck',
    reuseOrCreateTab: async (sourceName, url) => { calls.reusedTabs.push({ sourceName, url }); },
    sendToContentScript: async (sourceName, message) => {
      calls.messages.push({ sourceName, message });
      return { ok: true, email: 'alias@icloud.com', alias: 'alias' };
    },
    setEmailState: async (email) => { calls.setEmail.push(email); },
    throwIfStopped: () => {},
  });

  const email = await helpers.fetchGeneratedEmail({ emailGenerator: 'icloud-standard-alias' }, { generator: 'icloud-standard-alias' });

  assert.equal(email, 'alias@icloud.com');
  assert.deepEqual(calls.reusedTabs, [
    { sourceName: 'icloud-mail', url: 'https://www.icloud.com.cn/mail/' },
  ]);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].sourceName, 'icloud-mail');
  assert.equal(calls.messages[0].message.type, 'CREATE_ICLOUD_STANDARD_ALIAS');
  assert.deepEqual(calls.setEmail, ['alias@icloud.com']);
});
