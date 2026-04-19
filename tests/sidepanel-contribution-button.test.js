const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => sidepanelSource.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < sidepanelSource.length; i += 1) {
    const ch = sidepanelSource[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  let depth = 0;
  let end = braceStart;
  for (; end < sidepanelSource.length; end += 1) {
    const ch = sidepanelSource[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return sidepanelSource.slice(start, end);
}

test('sidepanel html contains contribution button in header', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  assert.match(html, /id="btn-contribution-mode"/);
  assert.match(html, />\u8d21\u732e</);
});

test('openContributionUploadPage opens upload page in a new tab directly', async () => {
  const bundle = [
    extractFunction('openContributionUploadPage'),
  ].join('\n');

  const api = new Function(`
const calls = [];
const CONTRIBUTION_UPLOAD_URL = 'https://apikey.qzz.io/';
function isContributionButtonLocked() {
  return false;
}
function openExternalUrl(url) {
  calls.push({ type: 'open', url });
}
${bundle}
return {
  openContributionUploadPage,
  getCalls() {
    return calls;
  },
};
`)();

  const result = await api.openContributionUploadPage();
  assert.equal(result, true);
  assert.deepStrictEqual(api.getCalls(), [
    {
      type: 'open',
      url: 'https://apikey.qzz.io/',
    },
  ]);
});

test('isContributionButtonLocked keeps contribution button available during auto-run', () => {
  const bundle = [
    extractFunction('isContributionButtonLocked'),
  ].join('\n');

  const api = new Function(`
const currentAutoRun = { autoRunning: true, phase: 'running' };
function getStepStatuses() {
  return { 1: 'running', 2: 'pending' };
}
function isAutoRunLockedPhase() {
  return true;
}
function isAutoRunPausedPhase() {
  return false;
}
function isAutoRunScheduledPhase() {
  return false;
}
${bundle}
return { isContributionButtonLocked };
`)();

  assert.equal(api.isContributionButtonLocked(), false);
});

test('openContributionUploadPage remains available during auto-run', async () => {
  const bundle = [
    extractFunction('isContributionButtonLocked'),
    extractFunction('openContributionUploadPage'),
  ].join('\n');

  const api = new Function(`
const calls = [];
const CONTRIBUTION_UPLOAD_URL = 'https://apikey.qzz.io/';
const currentAutoRun = { autoRunning: true, phase: 'running' };
function getStepStatuses() {
  return { 1: 'running', 2: 'pending' };
}
function isAutoRunLockedPhase() {
  return true;
}
function isAutoRunPausedPhase() {
  return false;
}
function isAutoRunScheduledPhase() {
  return false;
}
function openExternalUrl(url) {
  calls.push({ type: 'open', url });
}
${bundle}
return {
  openContributionUploadPage,
  getCalls() {
    return calls;
  },
};
`)();

  const result = await api.openContributionUploadPage();
  assert.equal(result, true);
  assert.deepStrictEqual(api.getCalls(), [
    {
      type: 'open',
      url: 'https://apikey.qzz.io/',
    },
  ]);
});

test('openContributionUploadPage blocks while manual flow is running', async () => {
  const bundle = [
    extractFunction('isContributionButtonLocked'),
    extractFunction('openContributionUploadPage'),
  ].join('\n');

  const api = new Function(`
const CONTRIBUTION_UPLOAD_URL = 'https://apikey.qzz.io/';
const currentAutoRun = { autoRunning: false, phase: 'idle' };
function getStepStatuses() {
  return { 1: 'running', 2: 'pending' };
}
function isAutoRunLockedPhase() {
  return false;
}
function isAutoRunPausedPhase() {
  return false;
}
function isAutoRunScheduledPhase() {
  return false;
}
function openExternalUrl() {
  throw new Error('should not open url');
}
${bundle}
return { openContributionUploadPage };
`)();

  await assert.rejects(
    () => api.openContributionUploadPage(),
    (error) => {
      assert.match(error.message, /\u5f53\u524d\u6d41\u7a0b\u8fd0\u884c\u4e2d/);
      return true;
    }
  );
});
