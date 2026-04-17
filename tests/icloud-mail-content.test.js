const test = require('node:test');
const assert = require('node:assert/strict');
const fsNative = require('node:fs');

const sourceCode = fsNative.readFileSync('content/icloud-mail.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => sourceCode.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < sourceCode.length; i += 1) {
    const ch = sourceCode[i];
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
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < sourceCode.length; end += 1) {
    const ch = sourceCode[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return sourceCode.slice(start, end);
}

test('readOpenedMailBody falls back to thread detail pane and extracts verification code', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('extractVerificationCode'),
    extractFunction('getOpenedMailBodyRoot'),
    extractFunction('readOpenedMailBody'),
  ].join('\n');

  const api = new Function(`
const detailPane = {
  innerText: '此邮件包含远程内容。 你的 ChatGPT 代码为 731091 输入此临时验证码以继续：731091',
  textContent: '此邮件包含远程内容。 你的 ChatGPT 代码为 731091 输入此临时验证码以继续：731091',
};
const document = {
  querySelector(selector) {
    if (selector.includes('.pane.thread-detail-pane')) {
      return detailPane;
    }
    return null;
  },
};
${bundle}
return { readOpenedMailBody, extractVerificationCode };
`)();

  const bodyText = api.readOpenedMailBody();
  assert.match(bodyText, /731091/);
  assert.equal(api.extractVerificationCode(bodyText), '731091');
});

test('readOpenedMailBody ignores conversation list rows when no detail pane is open', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('getOpenedMailBodyRoot'),
    extractFunction('readOpenedMailBody'),
  ].join('\n');

  const api = new Function(`
const document = {
  querySelector(selector) {
    if (selector === '.mail-message-defaults, .pane.thread-detail-pane') {
      return null;
    }
    throw new Error('unexpected selector: ' + selector);
  },
};
${bundle}
return { readOpenedMailBody };
`)();

  assert.equal(api.readOpenedMailBody(), '');
});

test('isThreadItemSelected follows the selected thread-list-item instead of the content container itself', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('getThreadItemMetadata'),
    extractFunction('buildItemSignature'),
    extractFunction('getThreadListItemRoot'),
    extractFunction('isThreadItemSelected'),
  ].join('\n');

  const selectedRoot = {
    getAttribute(name) {
      return name === 'aria-selected' ? 'true' : '';
    },
    className: 'thread-list-item ic-z3c00x',
  };
  const selectedItem = {
    closest() {
      return selectedRoot;
    },
    getAttribute() {
      return '';
    },
    querySelector(selector) {
      const map = {
        '.thread-participants': { textContent: 'OpenAI' },
        '.thread-subject': { textContent: '你的 ChatGPT 代码为 731091' },
        '.thread-preview': { textContent: '输入此临时验证码以继续：731091' },
        '.thread-timestamp': { textContent: '下午1:35' },
      };
      return map[selector] || null;
    },
  };
  const staleRoot = {
    getAttribute() {
      return '';
    },
    className: 'thread-list-item ic-z3c00x',
  };
  const staleItem = {
    closest() {
      return staleRoot;
    },
    getAttribute() {
      return '';
    },
    querySelector(selector) {
      const map = {
        '.thread-participants': { textContent: 'JetBrains Sales' },
        '.thread-subject': { textContent: '旧邮件' },
        '.thread-preview': { textContent: '旧摘要' },
        '.thread-timestamp': { textContent: '2026/3/4' },
      };
      return map[selector] || null;
    },
  };

  const api = new Function(`
let threadItems = [];
function collectThreadItems() {
  return threadItems;
}
${bundle}
return {
  buildItemSignature,
  isThreadItemSelected,
  setThreadItems(next) {
    threadItems = next;
  },
};
`)();

  api.setThreadItems([selectedItem, staleItem]);
  assert.equal(api.isThreadItemSelected(staleItem, api.buildItemSignature(selectedItem)), true);
  assert.equal(api.isThreadItemSelected(staleItem, api.buildItemSignature(staleItem)), false);
});

test('generateIcloudStandardAlias returns a valid alias', () => {
  const bundle = [
    extractFunction('generateIcloudStandardAlias'),
  ].join('\n');

  const api = new Function(`
${bundle}
return { generateIcloudStandardAlias };
`)();

  const alias = api.generateIcloudStandardAlias(12);
  assert.match(alias, /^[a-z][a-z0-9]{2,19}$/);
  assert.equal(alias.length, 12);
});

test('waitForAliasCreationCompletion resolves when alias dialog closes', async () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('getDialogCandidates'),
    extractFunction('readAliasDialogError'),
    extractFunction('waitForAliasCreationCompletion'),
  ].join('\n');

  const api = new Function(`
const logs = [];
async function sleep() {}
function throwIfStopped() {}
function log(message, level) { logs.push({ message, level }); }
${bundle}
return { waitForAliasCreationCompletion, logs };
`)();

  const aliasDialog = { isConnected: false, textContent: '' };
  const doc = {
    querySelectorAll() {
      return [];
    },
  };

  await api.waitForAliasCreationCompletion(doc, aliasDialog, 'demoalias', 200);
  assert.equal(api.logs.length, 1);
  assert.match(api.logs[0].message, /demoalias@icloud.com/);
});

test('readAliasDialogError extracts known validation copy', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('readAliasDialogError'),
  ].join('\n');

  const api = new Function(`
${bundle}
return { readAliasDialogError };
`)();

  assert.equal(
    api.readAliasDialogError({ textContent: '别名长度必须介于 3-20 个字符之间。' }),
    '别名长度必须介于 3-20 个字符之间。'
  );
  assert.equal(
    api.readAliasDialogError({ textContent: '别名不能以数字开头。' }),
    '别名不能以数字开头。'
  );
  assert.match(
    api.readAliasDialogError({ textContent: '你目前处于等候期 你的别名数量曾达到上限，并在最近删除了一个别名。你可以在七天后创建一个新别名。' }),
    /你目前处于等候期/
  );
});

test('getDialogCandidates only returns ui-popup dialogs', () => {
  const bundle = [
    extractFunction('getDialogCandidates'),
  ].join('\n');

  const api = new Function(`
${bundle}
return { getDialogCandidates };
`)();

  const popupDialog = { id: 'popup-dialog' };
  const overlayActions = { id: 'overlay-actions' };
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'ui-popup[role="dialog"]') {
        return [popupDialog];
      }
      if (selector === '[role="dialog"], dialog, .regular') {
        return [popupDialog, overlayActions];
      }
      return [];
    },
  };

  assert.deepEqual(api.getDialogCandidates(doc), [popupDialog]);
});

test('findButtonByText can match by aria-label when text is empty', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('findButtonByText'),
  ].join('\n');

  const target = {
    textContent: '',
    getAttribute(name) {
      return name === 'aria-label' ? '设置' : '';
    },
  };
  const root = {
    querySelectorAll() {
      return [target];
    },
  };

  const api = new Function(`
${bundle}
return { findButtonByText };
`)();

  assert.equal(api.findButtonByText(root, /设置/), target);
});

test('findButtonByText can skip excluded elements', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('findButtonByText'),
  ].join('\n');

  const launcher = {
    textContent: '',
    getAttribute(name) {
      return name === 'aria-label' ? '设置' : '';
    },
  };
  const menuItem = {
    textContent: '设置',
    getAttribute() {
      return '';
    },
  };
  const root = {
    querySelectorAll() {
      return [launcher, menuItem];
    },
  };

  const api = new Function(`
${bundle}
return { findButtonByText };
`)();

  assert.equal(api.findButtonByText(root, /^设置$/, { excludeElements: [launcher] }), menuItem);
});

test('createStandardAliasFromMailIframe throws when settings dialog is missing', async () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('getDialogCandidates'),
    extractFunction('findDialogByText'),
    extractFunction('findButtonByText'),
    extractFunction('clickButtonByText'),
    extractFunction('generateIcloudStandardAlias'),
    extractFunction('waitForDialog'),
    extractFunction('findMenuItemByText'),
    extractFunction('waitForDialog'),
    extractFunction('ensureSettingsAccountDialog'),
    extractFunction('createStandardAliasFromMailIframe'),
  ].join('\n');

  const api = new Function(`
async function sleep() {}
function throwIfStopped() {}
function simulateClick() {}
function fillInput() {}
function log() {}
${bundle}
return { createStandardAliasFromMailIframe };
`)();

  await assert.rejects(
    () => api.createStandardAliasFromMailIframe({ querySelectorAll() { return []; } }),
    /未找到 iCloud Mail 的“设置”入口按钮。/
  );
});

test('findButtonByText skips descendants of excluded launcher controls', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('findButtonByText'),
  ].join('\n');

  const launcher = {
    textContent: '',
    parentElement: null,
    getAttribute(name) {
      return name === 'aria-label' ? '设置' : '';
    },
  };
  const launcherInnerButton = {
    textContent: '',
    parentElement: launcher,
    getAttribute(name) {
      return name === 'aria-label' ? '设置' : '';
    },
  };
  const menuItem = {
    textContent: '设置',
    parentElement: null,
    getAttribute() {
      return '';
    },
  };
  const root = {
    querySelectorAll() {
      return [launcher, launcherInnerButton, menuItem];
    },
  };

  const api = new Function([
    bundle,
    'return { findButtonByText };',
  ].join('\n'))();

  assert.equal(api.findButtonByText(root, /^设置$/, { excludeElements: [launcher] }), menuItem);
});

test('waitForAliasCreationCompletion surfaces wait-period alertdialog copy', async () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('getDialogCandidates'),
    extractFunction('readAliasDialogError'),
    extractFunction('waitForAliasCreationCompletion'),
  ].join('\n');

  const api = new Function([
    'async function sleep() {}',
    'function throwIfStopped() {}',
    'function log() {}',
    bundle,
    'return { waitForAliasCreationCompletion };',
  ].join('\n'))();

  const aliasDialog = { isConnected: true, textContent: '' };
  const alertDialog = {
    textContent: '你目前处于等候期 你的别名数量曾达到上限，并在最近删除了一个别名。你可以在七天后创建一个新别名。',
  };
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'ui-popup[role="dialog"]') {
        return [aliasDialog];
      }
      if (selector === 'ui-popup[role="alertdialog"]') {
        return [alertDialog];
      }
      return [];
    },
    querySelector() {
      return null;
    },
  };

  await assert.rejects(
    () => api.waitForAliasCreationCompletion(doc, aliasDialog, 'demoalias', 200),
    /你目前处于等候期/
  );
});

test('createIcloudStandardAlias defaults to a single attempt', async () => {
  const bundle = [
    extractFunction('createIcloudStandardAlias'),
  ].join('\n');

  const api = new Function([
    'const logs = [];',
    'let attempts = 0;',
    'async function waitForMailAutomationDocument() { return { ready: true }; }',
    'function generateIcloudStandardAlias() { return "demoalias"; }',
    'async function createStandardAliasFromMailIframe() { attempts += 1; throw new Error("mock failure"); }',
    'function throwIfStopped() {}',
    'async function sleep() {}',
    'function log(message, level) { logs.push({ message, level }); }',
    bundle,
    'return { createIcloudStandardAlias, getAttempts() { return attempts; }, logs };',
  ].join('\n'))();

  await assert.rejects(
    () => api.createIcloudStandardAlias({}),
    /已尝试 1 次/
  );
  assert.equal(api.getAttempts(), 1);
  assert.match(api.logs.find((entry) => /正在尝试创建第/.test(entry.message)).message, /1\/1/);
});

test('findMenuItemByText matches ui-menu-item text content', () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('findMenuItemByText'),
  ].join('\n');

  const menuItem = {
    tagName: 'UI-MENU-ITEM',
    textContent: '设置',
    parentElement: null,
    getAttribute() {
      return '';
    },
    querySelector(selector) {
      if (selector === 'p') {
        return { textContent: '设置' };
      }
      return null;
    },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector === 'ui-menu-item,[role="menuitem"]') {
        return [menuItem];
      }
      return [];
    },
  };

  const api = new Function(`
${bundle}
return { findMenuItemByText };
`)();

  assert.equal(api.findMenuItemByText(root, /^设置$/), menuItem);
});

test('ensureSettingsAccountDialog prefers ui-menu-item settings option from menu', async () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('getDialogCandidates'),
    extractFunction('findDialogByText'),
    extractFunction('findButtonByText'),
    extractFunction('findMenuItemByText'),
    extractFunction('findSettingsLauncher'),
    extractFunction('waitForSettingsMenuItem'),
    extractFunction('waitForDialog'),
    extractFunction('ensureSettingsAccountDialog'),
  ].join('\n');

  const launcher = {
    tagName: 'UI-BUTTON',
    textContent: '',
    parentElement: null,
    getAttribute(name) {
      if (name === 'aria-label') return '设置';
      if (name === 'title') return '设置';
      return '';
    },
  };
  const menuItem = {
    tagName: 'UI-MENU-ITEM',
    textContent: '设置',
    parentElement: null,
    getAttribute() {
      return '';
    },
    querySelector(selector) {
      if (selector === 'p') {
        return { textContent: '设置' };
      }
      return null;
    },
  };
  const settingsDialog = {
    textContent: '账户 添加别名',
  };

  globalThis.__testLauncher = launcher;
  globalThis.__testMenuItem = menuItem;
  globalThis.__testStage = 'before-menu';

  const api = new Function(`
const clicked = [];
async function sleep() {
  if (globalThis.__testStage === 'launcher-clicked') {
    globalThis.__testStage = 'menu-open-first';
    return;
  }
  if (globalThis.__testStage === 'menu-open-first') {
    globalThis.__testStage = 'menu-open';
  }
}
function throwIfStopped() {}
function log() {}
function simulateClick(node) {
  clicked.push(node.tagName || 'UNKNOWN');
  if (node === globalThis.__testLauncher) {
    globalThis.__testStage = 'launcher-clicked';
  }
  if (node === globalThis.__testMenuItem) {
    globalThis.__testStage = 'dialog-open';
  }
}
${bundle}
return {
  ensureSettingsAccountDialog,
  getClicked() {
    return clicked.slice();
  },
};
`)();

  const doc = {
    querySelectorAll(selector) {
      const currentStage = globalThis.__testStage || 'before-menu';
      if (selector === 'ui-popup[role="dialog"]') {
        return currentStage === 'dialog-open' ? [settingsDialog] : [];
      }
      if (selector === 'ui-menu-item,[role="menuitem"]') {
        return currentStage === 'menu-open-first' || currentStage === 'menu-open' || currentStage === 'dialog-open' ? [menuItem] : [];
      }
      if (selector === 'ui-button[aria-label="设置"], ui-button[title="设置"], button[aria-label="设置"], [role="button"][aria-label="设置"]') {
        return [launcher];
      }
      if (selector === 'ui-button,button,[role="button"],[role="menuitem"]') {
        return [launcher];
      }
      return [];
    },
  };

  const result = await api.ensureSettingsAccountDialog(doc, 500);
  assert.equal(result, settingsDialog);
  assert.deepEqual(api.getClicked(), ['UI-BUTTON', 'UI-MENU-ITEM']);

  delete globalThis.__testStage;
  delete globalThis.__testLauncher;
  delete globalThis.__testMenuItem;
});
