const ICLOUD_MAIL_PREFIX = '[MultiPage:icloud-mail]';
const isTopFrame = window === window.top;

console.log(ICLOUD_MAIL_PREFIX, 'Content script loaded on', location.href, 'frame:', isTopFrame ? 'top' : 'child');

function isMailApplicationFrame() {
  if (/\/applications\/mail2\//.test(location.pathname)) {
    return true;
  }
  return Boolean(document.querySelector('.content-container, .mail-message-defaults, .thread-participants'));
}

if (isTopFrame) {
  console.log(ICLOUD_MAIL_PREFIX, 'Top frame detected; waiting for mail iframe.');
} else {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'POLL_EMAIL') {
      if (!isMailApplicationFrame()) {
        sendResponse({ ok: false, reason: 'wrong-frame' });
        return;
      }
      resetStopState();
      handlePollEmail(message.step, message.payload).then((result) => {
        sendResponse(result);
      }).catch((err) => {
        if (isStopError(err)) {
          log(`步骤 ${message.step}：已被用户停止。`, 'warn');
          sendResponse({ stopped: true, error: err.message });
          return;
        }
        log(`步骤 ${message.step}：iCloud 邮箱轮询失败：${err.message}`, 'warn');
        sendResponse({ error: err.message });
      });
      return true;
    }

    if (message.type === 'CREATE_ICLOUD_STANDARD_ALIAS') {
      if (!isMailApplicationFrame()) {
        sendResponse({ ok: false, reason: 'wrong-frame' });
        return;
      }
      resetStopState();
      createIcloudStandardAlias(message.payload || {}).then((result) => {
        sendResponse(result);
      }).catch((err) => {
        if (isStopError(err)) {
          log('普通 iCloud 别名邮箱：已被用户停止。', 'warn');
          sendResponse({ stopped: true, error: err.message });
          return;
        }
        log(`普通 iCloud 别名邮箱：创建失败：${err.message}`, 'warn');
        sendResponse({ error: err.message });
      });
      return true;
    }

    if (message.type === 'SYNC_ICLOUD_STANDARD_POOL') {
      if (!isMailApplicationFrame()) {
        sendResponse({ ok: false, reason: 'wrong-frame' });
        return;
      }
      resetStopState();
      syncIcloudStandardPool(message.payload || {}).then((result) => {
        sendResponse(result);
      }).catch((err) => {
        if (isStopError(err)) {
          log('普通 iCloud 邮箱池同步：已被用户停止。', 'warn');
          sendResponse({ stopped: true, error: err.message });
          return;
        }
        log(`普通 iCloud 邮箱池同步失败：${err.message}`, 'warn');
        sendResponse({ error: err.message });
      });
      return true;
    }
  });

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getDialogCandidates(root = document) {
    return Array.from(root.querySelectorAll('ui-popup[role="dialog"]'));
  }

  function findDialogByText(root = document, patterns = []) {
    return getDialogCandidates(root).find((item) => {
      const text = normalizeText(item.textContent || '');
      return patterns.every((pattern) => pattern.test(text));
    }) || null;
  }

  function findButtonByText(root, pattern, options = {}) {
    const excluded = new Set(Array.isArray(options.excludeElements) ? options.excludeElements : []);
    const matchAriaLabel = options.matchAriaLabel !== false;
    return Array.from(root.querySelectorAll('ui-button,button,[role="button"],[role="menuitem"]'))
      .find((el) => {
        let current = el;
        while (current) {
          if (excluded.has(current)) {
            return false;
          }
          current = current.parentElement || current.parentNode || null;
        }

        const textMatched = pattern.test(normalizeText(el.textContent || ''));
        if (textMatched) {
          return true;
        }
        if (!matchAriaLabel) {
          return false;
        }
        return pattern.test(el.getAttribute('aria-label') || '');
      }) || null;
  }

  function findMenuItemByText(root, pattern, options = {}) {
    const excluded = new Set(Array.isArray(options.excludeElements) ? options.excludeElements : []);
    return Array.from(root.querySelectorAll('ui-menu-item,[role="menuitem"]'))
      .find((el) => {
        let current = el;
        while (current) {
          if (excluded.has(current)) {
            return false;
          }
          current = current.parentElement || current.parentNode || null;
        }

        const ownText = normalizeText(el.textContent || '');
        const labelText = normalizeText(el.querySelector?.('p')?.textContent || '');
        return pattern.test(labelText || ownText);
      }) || null;
  }

  function findSettingsLauncher(root = document) {
    const settingPattern = /^(?:设置|設定|settings?)$/i;
    const explicitCandidates = Array.from(root.querySelectorAll([
      'ui-button[aria-label="设置"]',
      'ui-button[aria-label="設定"]',
      'ui-button[aria-label="Settings"]',
      'ui-button[title="设置"]',
      'ui-button[title="設定"]',
      'ui-button[title="Settings"]',
      'button[aria-label="设置"]',
      'button[aria-label="設定"]',
      'button[aria-label="Settings"]',
      '[role="button"][aria-label="设置"]',
      '[role="button"][aria-label="設定"]',
      '[role="button"][aria-label="Settings"]',
    ].join(', ')));

    const explicitMatch = explicitCandidates.find((el) => {
      const ariaLabel = normalizeText(el.getAttribute('aria-label') || '');
      const title = normalizeText(el.getAttribute('title') || '');
      return settingPattern.test(ariaLabel) || settingPattern.test(title);
    });
    if (explicitMatch) {
      return explicitMatch;
    }

    return findButtonByText(root, settingPattern);
  }

  async function waitForSettingsMenuItem(root, options = {}) {
    const {
      timeout = 4000,
      excludeElements = [],
    } = options;
    const start = Date.now();
    let previousCandidate = null;
    while (Date.now() - start < timeout) {
      throwIfStopped();
      const candidate = findMenuItemByText(root, /^(?:设置|設定|settings?)$/i, { excludeElements })
        || findButtonByText(root, /^(?:设置|設定|settings?)$/i, { excludeElements, matchAriaLabel: true });
      if (candidate && candidate === previousCandidate) {
        return candidate;
      }
      previousCandidate = candidate || null;
      await sleep(120);
    }
    return previousCandidate;
  }

  async function clickButtonByText(root, pattern, errorMessage) {
    const button = findButtonByText(root, pattern);
    if (!button) {
      throw new Error(errorMessage);
    }
    simulateClick(button);
    return button;
  }

  function describeElement(el) {
    if (!el) {
      return '[null]';
    }
    const tag = String(el.tagName || 'UNKNOWN').toUpperCase();
    const role = normalizeText(el.getAttribute?.('role') || '');
    const ariaLabel = normalizeText(el.getAttribute?.('aria-label') || '');
    const title = normalizeText(el.getAttribute?.('title') || '');
    const textValue = normalizeText(el.textContent || '').slice(0, 60);
    return `${tag} role=${role || '-'} aria=${ariaLabel || '-'} title=${title || '-'} text=${textValue || '-'}`;
  }

  function isElementVisible(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') {
      return false;
    }
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasVisibleMailLoading(root = document) {
    const loadingSelectors = [
      '[aria-busy="true"]',
      'ui-spinner',
      '.spinner',
      '.loading',
      '.activity-indicator',
      '[role="progressbar"]',
    ];
    return loadingSelectors.some((selector) => {
      const el = root.querySelector(selector);
      return isElementVisible(el);
    });
  }

  async function waitForMailAliasUiReady(doc, timeout = 15000) {
    const start = Date.now();
    let stableHits = 0;
    while (Date.now() - start < timeout) {
      throwIfStopped();
      const settingsReady = Boolean(findSettingsLauncher(doc) || findButtonByText(doc, /^(?:设置|設定|settings?)$/i));
      const listReady = Boolean(doc.querySelector('.content-container, .thread-list-item, .thread-participants'));
      const loadingVisible = hasVisibleMailLoading(doc);

      if ((settingsReady || listReady) && !loadingVisible) {
        stableHits += 1;
      } else {
        stableHits = 0;
      }

      if (stableHits >= 3) {
        log('普通 iCloud 别名邮箱：邮件页面已稳定，继续执行设置流程。', 'ok');
        return;
      }
      await sleep(150);
    }

    log('普通 iCloud 别名邮箱：等待邮件页面稳定超时，继续尝试后续流程。', 'warn');
  }

  function dispatchMouseActivationSequence(target) {
    if (!target) {
      return;
    }
    const options = { bubbles: true, cancelable: true };
    target.dispatchEvent(new MouseEvent('mousedown', options));
    target.dispatchEvent(new MouseEvent('mouseup', options));
    target.dispatchEvent(new MouseEvent('click', options));
  }

  function getVisibleDialogCandidates(root = document) {
    const selectors = [
      'ui-popup[role="dialog"]',
      '[role="dialog"]',
      'dialog',
      '.regular',
    ];
    const seen = new Set();
    const list = [];
    for (const selector of selectors) {
      const nodes = Array.from(root.querySelectorAll(selector));
      for (const node of nodes) {
        if (!node || seen.has(node)) {
          continue;
        }
        seen.add(node);
        if (isElementVisible(node)) {
          list.push(node);
        }
      }
    }
    return list;
  }

  function findSettingsAccountContainer(root = document) {
    const accountPattern = /账户|帳戶|account/i;
    const addAliasPattern = /添加别名|加入別名|add\s+alias/i;
    const aliasPattern = /别名|別名|alias/i;

    const dialogs = getVisibleDialogCandidates(root);

    // Highest confidence: account + add alias in the same visible dialog.
    const strictDialog = dialogs.find((dialog) => {
      const text = normalizeText(dialog.textContent || '');
      return accountPattern.test(text) && addAliasPattern.test(text);
    });
    if (strictDialog) {
      return strictDialog;
    }

    // Medium confidence: dialog contains explicit add-alias control.
    const withAddAliasControl = dialogs.find((dialog) => {
      const explicit = dialog.querySelector('ui-button[aria-label="添加别名"],button[aria-label="添加别名"]');
      if (explicit && isElementVisible(explicit)) {
        return true;
      }
      const byText = findButtonByText(dialog, addAliasPattern);
      return Boolean(byText && isElementVisible(byText));
    });
    if (withAddAliasControl) {
      return withAddAliasControl;
    }

    // Fallback: dialog includes account + alias context text.
    const accountAliasDialog = dialogs.find((dialog) => {
      const text = normalizeText(dialog.textContent || '');
      return accountPattern.test(text) && aliasPattern.test(text);
    });
    if (accountAliasDialog) {
      return accountAliasDialog;
    }

    return null;
  }

  async function waitForSettingsAccountContainer(root = document, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      throwIfStopped();
      const container = findSettingsAccountContainer(root);
      if (container) {
        return container;
      }
      await sleep(120);
    }
    return null;
  }

  async function activateSettingsMenuItem(menuItem, doc = document) {
    if (!menuItem) {
      throw new Error('未提供可激活的设置菜单项。');
    }

    const waitForContainer = async (timeoutMs) => {
      if (typeof waitForSettingsAccountContainer === 'function') {
        return waitForSettingsAccountContainer(doc, timeoutMs);
      }
      const direct = findDialogByText(doc, [/账户|帳戶|account/i]) || findDialogByText(doc, [/添加别名|加入別名|add\s+alias/i]);
      if (direct) {
        return direct;
      }
      await sleep(timeoutMs);
      return findDialogByText(doc, [/账户|帳戶|account/i]) || findDialogByText(doc, [/添加别名|加入別名|add\s+alias/i]);
    };

    log(`普通 iCloud 别名邮箱：准备激活设置菜单项。${describeElement(menuItem)}`, 'info');
    simulateClick(menuItem);
    const openedAfterClick = await waitForContainer(2200);
    if (openedAfterClick) {
      log('普通 iCloud 别名邮箱：菜单项 click 激活成功。', 'ok');
      return openedAfterClick;
    }

    const innerLabelNode = menuItem.querySelector?.('p,span') || null;
    if (innerLabelNode) {
      log(`普通 iCloud 别名邮箱：尝试触发菜单项内部文本点击序列。${describeElement(innerLabelNode)}`, 'warn');
      dispatchMouseActivationSequence(innerLabelNode);
      const openedAfterInnerMouse = await waitForContainer(1800);
      if (openedAfterInnerMouse) {
        log('普通 iCloud 别名邮箱：内部文本鼠标序列激活成功。', 'ok');
        return openedAfterInnerMouse;
      }
    }

    dispatchMouseActivationSequence(menuItem);
    const openedAfterMouseSequence = await waitForContainer(1800);
    if (openedAfterMouseSequence) {
      log('普通 iCloud 别名邮箱：菜单项鼠标序列激活成功。', 'ok');
      return openedAfterMouseSequence;
    }

    const focusTarget = menuItem.querySelector?.('button,[role="button"],p,span') || menuItem;
    focusTarget.focus?.();

    if (typeof KeyboardEvent === 'function') {
      const keyEventOptions = { bubbles: true, cancelable: true };
      focusTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...keyEventOptions }));
      focusTarget.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', ...keyEventOptions }));
      focusTarget.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ...keyEventOptions }));
    }
    const openedAfterEnter = await waitForContainer(1800);
    if (openedAfterEnter) {
      log('普通 iCloud 别名邮箱：菜单项 Enter 激活成功。', 'ok');
      return openedAfterEnter;
    }

    if (typeof KeyboardEvent === 'function') {
      const keyEventOptions = { bubbles: true, cancelable: true };
      focusTarget.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ...keyEventOptions }));
      focusTarget.dispatchEvent(new KeyboardEvent('keypress', { key: ' ', code: 'Space', ...keyEventOptions }));
      focusTarget.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', ...keyEventOptions }));
    }
    const openedAfterSpace = await waitForContainer(1800);
    if (openedAfterSpace) {
      log('普通 iCloud 别名邮箱：菜单项 Space 激活成功。', 'ok');
      return openedAfterSpace;
    }

    const innerClickable = menuItem.querySelector?.('p,span,button,[role="button"]') || null;
    if (innerClickable && innerClickable !== menuItem) {
      log(`普通 iCloud 别名邮箱：尝试激活菜单项内部元素。${describeElement(innerClickable)}`, 'warn');
      simulateClick(innerClickable);
      const openedAfterInnerClick = await waitForContainer(1800);
      if (openedAfterInnerClick) {
        log('普通 iCloud 别名邮箱：内部元素 click 激活成功。', 'ok');
        return openedAfterInnerClick;
      }
    }

    throw new Error('已点击设置菜单项，但未检测到账户设置界面。');
  }

  function getMailAutomationDocument() {
    if (isMailApplicationFrame()) {
      return document;
    }
    const frame = document.querySelector('iframe.child-application');
    return frame?.contentDocument || null;
  }

  async function waitForMailAutomationDocument(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      throwIfStopped();
      const mailDoc = getMailAutomationDocument();
      if (mailDoc?.querySelector) {
        return mailDoc;
      }
      await sleep(100);
    }
    throw new Error('未找到 iCloud Mail 页面文档，请确认邮件应用已完成加载。');
  }

  function generateIcloudStandardAlias(length = 12) {
    const total = Math.max(3, Math.min(20, Math.floor(Number(length) || 12)));
    const first = 'abcdefghijklmnopqrstuvwxyz';
    const rest = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let value = first[Math.floor(Math.random() * first.length)];
    for (let i = 1; i < total; i += 1) {
      value += rest[Math.floor(Math.random() * rest.length)];
    }
    if (!/^[a-z][a-z0-9]{2,19}$/.test(value)) {
      throw new Error('生成别名不符合规则');
    }
    return value;
  }

  async function waitForDialog(root, patterns, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      throwIfStopped();
      const dialog = findDialogByText(root, patterns);
      if (dialog) {
        return dialog;
      }
      await sleep(100);
    }
    throw new Error(`未找到目标弹窗：${patterns.map((pattern) => pattern.toString()).join(' / ')}`);
  }

  async function ensureSettingsAccountDialog(doc, timeout = 10000) {
    const findContainer = typeof findSettingsAccountContainer === 'function'
      ? findSettingsAccountContainer
      : (root) => findDialogByText(root, [/账户|帳戶|account/i]);

    const existingDialog = findContainer(doc);
    if (existingDialog) {
      log(`普通 iCloud 别名邮箱：已检测到账户设置界面。${describeElement(existingDialog)}`, 'info');
      return existingDialog;
    }

    log('普通 iCloud 别名邮箱：未检测到账户设置界面，开始尝试自动打开设置。', 'warn');
    const settingsLauncher = findSettingsLauncher(doc) || findButtonByText(doc, /^(?:设置|設定|settings?)$/i);
    if (!settingsLauncher) {
      throw new Error('未找到 iCloud Mail 的“设置”入口按钮。');
    }

    const launcherDesc = typeof describeElement === 'function'
      ? describeElement(settingsLauncher)
      : String(settingsLauncher?.tagName || 'UNKNOWN');
    log(`普通 iCloud 别名邮箱：已找到“设置”入口，准备点击。${launcherDesc}`, 'info');
    simulateClick(settingsLauncher);
    await sleep(180);

    log('普通 iCloud 别名邮箱：等待设置菜单稳定展开。', 'info');
    const settingsMenuItem = await waitForSettingsMenuItem(doc, {
      timeout: 5000,
      excludeElements: [settingsLauncher],
    }) || findButtonByText(doc, /^(?:设置|設定|settings?)$/i, {
      excludeElements: [settingsLauncher],
      matchAriaLabel: true,
    });
    if (!settingsMenuItem) {
      throw new Error('未找到设置菜单项“设置”。');
    }

    const menuItemDesc = typeof describeElement === 'function'
      ? describeElement(settingsMenuItem)
      : String(settingsMenuItem?.tagName || 'UNKNOWN');
    log(`普通 iCloud 别名邮箱：已找到设置菜单项，准备激活。${menuItemDesc}`, 'info');

    let activatedContainer = null;
    if (typeof activateSettingsMenuItem === 'function') {
      activatedContainer = await activateSettingsMenuItem(settingsMenuItem, doc);
      if (activatedContainer) {
        return activatedContainer;
      }
    } else {
      simulateClick(settingsMenuItem);
    }

    const fallbackContainer = typeof waitForSettingsAccountContainer === 'function'
      ? await waitForSettingsAccountContainer(doc, timeout)
      : await waitForDialog(doc, [/账户|帳戶|account/i], timeout);
    if (fallbackContainer) {
      log(`普通 iCloud 别名邮箱：激活后通过轮询检测到账户设置界面。${describeElement(fallbackContainer)}`, 'ok');
      return fallbackContainer;
    }

    throw new Error('已完成设置菜单激活，但未检测到账户设置界面。');
  }

  function readAliasDialogError(aliasDialog) {
    const text = normalizeText(aliasDialog?.textContent || '');
    if (!text) {
      return '';
    }

    const patterns = [
      /别名长度必须介于 3-20 个字符之间。?/,
      /别名不能以数字开头。?/,
      /你目前处于等候期/,
      /你可以在七天后创建一个新别名/,
      /已被占用/,
      /不可用/,
      /already.*(?:used|taken|exists|unavailable)/i,
    ];
    const matched = patterns.find((pattern) => pattern.test(text));
    if (!matched) {
      return '';
    }

    const result = text.match(matched);
    return normalizeText(result?.[0] || text);
  }

  async function waitForAliasCreationCompletion(doc, aliasDialog, alias, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      throwIfStopped();

      const alertDialog = Array.from(doc.querySelectorAll('ui-popup[role="alertdialog"]'))
        .find((item) => readAliasDialogError(item));
      const alertText = readAliasDialogError(alertDialog);
      if (alertText) {
        throw new Error(`iCloud 页面提示：${alertText}`);
      }

      const dialogs = getDialogCandidates(doc);
      if (!aliasDialog?.isConnected || !dialogs.includes(aliasDialog)) {
        log(`普通 iCloud 别名邮箱：检测到创建弹窗已关闭，视为创建完成：${alias}@icloud.com`, 'ok');
        return;
      }

      const errorText = readAliasDialogError(aliasDialog);
      if (errorText) {
        throw new Error(`iCloud 页面提示：${errorText}`);
      }

      await sleep(200);
    }

    throw new Error('点击“创建”后长时间未观察到完成结果，请检查页面是否仍停留在创建弹窗。');
  }

  async function createStandardAliasFromMailIframe(doc, options = {}) {
    log('普通 iCloud 别名邮箱：开始查找“设置-账户”弹窗。', 'info');
    const settingsDialog = await ensureSettingsAccountDialog(doc, 10000);

    const addAliasBtnStart = Date.now();
    let addAliasBtn = null;
    while (Date.now() - addAliasBtnStart < 10000) {
      throwIfStopped();
      const latestSettingsDialog = typeof findSettingsAccountContainer === 'function'
        ? (findSettingsAccountContainer(doc) || settingsDialog)
        : settingsDialog;

      addAliasBtn = latestSettingsDialog?.querySelector('ui-button[aria-label="添加别名"],button[aria-label="添加别名"]')
        || latestSettingsDialog?.querySelector('ui-button.actionable-row-item.ic-cbcudj')
        || findButtonByText(latestSettingsDialog || settingsDialog, /添加别名|加入別名|add\s+alias/i);
      if (addAliasBtn) {
        break;
      }
      await sleep(120);
    }

    if (!addAliasBtn) {
      throw new Error('未找到“添加别名”按钮。');
    }
    log('普通 iCloud 别名邮箱：已找到“添加别名”按钮，准备点击。', 'info');
    simulateClick(addAliasBtn);

    log('普通 iCloud 别名邮箱：等待“添加邮件别名”弹窗出现。', 'info');
    const aliasDialogStart = Date.now();
    let aliasDialog = null;
    while (Date.now() - aliasDialogStart < 10000) {
      throwIfStopped();

      const alertDialog = Array.from(doc.querySelectorAll('ui-popup[role="alertdialog"]'))
        .find((item) => readAliasDialogError(item));
      const alertText = readAliasDialogError(alertDialog);
      if (alertText) {
        throw new Error(`iCloud 页面提示：${alertText}`);
      }

      aliasDialog = doc.querySelector('ui-popup[role="dialog"][aria-label="添加邮件别名"]')
        || findDialogByText(doc, [/新的地址别名|添加邮件别名/, /地址/, /创建/]);
      if (aliasDialog) {
        break;
      }

      await sleep(100);
    }
    if (!aliasDialog) {
      throw new Error('未找到“添加邮件别名”弹窗。');
    }
    const aliasInput = aliasDialog.querySelector('input[aria-label="别名"]');
    if (!aliasInput) {
      throw new Error('未找到别名输入框。');
    }

    const alias = String(options.alias || '').trim().toLowerCase() || generateIcloudStandardAlias(options.length);
    log(`普通 iCloud 别名邮箱：已找到别名输入框，准备填入 ${alias}@icloud.com`, 'info');
    fillInput(aliasInput, alias);
    await sleep(250);

    const createBtn = findButtonByText(aliasDialog, /创建/);
    if (!createBtn) {
      throw new Error('未找到创建按钮。');
    }
    if (createBtn.hasAttribute('disabled') || createBtn.getAttribute('aria-disabled') === 'true') {
      throw new Error('创建按钮仍不可用，请检查别名是否合法或是否已被占用。');
    }

    log(`普通 iCloud 别名邮箱：准备点击“创建”按钮，提交 ${alias}@icloud.com`, 'info');
    simulateClick(createBtn);
    await waitForAliasCreationCompletion(doc, aliasDialog, alias, Number(options.submitTimeoutMs) || 10000);
    return {
      ok: true,
      alias,
      email: `${alias}@icloud.com`,
    };
  }

  async function createIcloudStandardAlias(options = {}) {
    log('普通 iCloud 别名邮箱：开始准备页面文档。', 'info');
    const iframeDoc = await waitForMailAutomationDocument(10000);
    if (typeof waitForMailAliasUiReady === 'function') {
      await waitForMailAliasUiReady(iframeDoc, Number(options.pageReadyTimeoutMs) || 15000);
    }
    log('普通 iCloud 别名邮箱：页面文档已就绪，开始创建流程。', 'ok');
    const maxAttempts = Math.max(1, Number(options.maxAttempts) || 1);
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfStopped();
      const alias = generateIcloudStandardAlias(options.length);
      log(`普通 iCloud 别名邮箱：正在尝试创建第 ${attempt}/${maxAttempts} 个别名 ${alias}@icloud.com`, 'info');
      try {
        return await createStandardAliasFromMailIframe(iframeDoc, { ...options, alias });
      } catch (err) {
        lastError = err;
        log(`普通 iCloud 别名邮箱：第 ${attempt}/${maxAttempts} 次尝试失败：${err.message}`, 'warn');
        if (attempt < maxAttempts) {
          await sleep(300);
        }
      }
    }

    throw new Error(`普通 iCloud 别名邮箱创建失败，已尝试 ${maxAttempts} 次：${lastError?.message || '未知错误'}`);
  }

  function normalizeIcloudMailHostFromLocation(loc = location) {
    const host = String(loc?.hostname || '').trim().toLowerCase();
    if (host.endsWith('icloud.com.cn')) {
      return 'icloud.com.cn';
    }
    return 'icloud.com';
  }

  function normalizeStandardIcloudEmail(raw, fallbackHost = 'icloud.com') {
    const value = String(raw || '').trim().toLowerCase();
    if (!value || !value.includes('@')) {
      return '';
    }
    const parts = value.split('@');
    if (parts.length !== 2) {
      return '';
    }
    const local = parts[0].trim();
    if (!local) {
      return '';
    }
    const domain = String(parts[1] || '').trim().toLowerCase();
    if (domain === 'icloud.com' || domain === 'icloud.com.cn') {
      return `${local}@${domain}`;
    }
    if (domain === 'me.com' || domain === 'mac.com') {
      return `${local}@${fallbackHost}`;
    }
    return '';
  }

  function collectStandardAliasLikeTexts(root, values = new Set()) {
    if (!root) {
      return values;
    }

    const pushText = (text) => {
      const normalized = normalizeText(text).toLowerCase();
      if (!normalized || !normalized.includes('@')) {
        return;
      }
      const matches = normalized.match(/[a-z0-9._%+-]+@(?:icloud\.com|icloud\.com\.cn|me\.com|mac\.com)/g) || [];
      for (const email of matches) {
        values.add(email);
      }
    };

    const nodes = root.querySelectorAll('input, textarea, [contenteditable], ui-input, label, p, span, div, li, td');
    for (const node of nodes) {
      pushText(node.value);
      pushText(node.getAttribute?.('value'));
      pushText(node.getAttribute?.('aria-label'));
      pushText(node.getAttribute?.('title'));
      pushText(node.textContent);
    }

    pushText(root.textContent);
    return values;
  }

  function parseAliasEntriesFromSettingsDialog(dialog, host) {
    if (!dialog) {
      return [];
    }

    const aliasMap = new Map();
    const aliasEmails = collectStandardAliasLikeTexts(dialog, new Set());
    for (const rawEmail of aliasEmails) {
      const normalizedEmail = normalizeStandardIcloudEmail(rawEmail, host);
      if (!normalizedEmail) {
        continue;
      }
      aliasMap.set(normalizedEmail, {
        email: normalizedEmail,
        label: '',
        note: '',
        active: true,
        source: 'standard-alias',
      });
    }

    return Array.from(aliasMap.values())
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  function parsePrimaryEmailFromSettingsDialog(dialog, host) {
    if (!dialog) {
      return '';
    }

    const titleLikeNodes = Array.from(dialog.querySelectorAll('label, p, span, div, li, td'));
    for (const node of titleLikeNodes) {
      const text = normalizeText(node.textContent).toLowerCase();
      if (!text) {
        continue;
      }
      if (!/(主要地址|主地址|primary\s+address|mail\s+address|账户地址|account\s+address)/i.test(text)) {
        continue;
      }

      const neighborCandidates = [
        node.nextElementSibling,
        node.parentElement?.querySelector?.('input, [contenteditable], .email, [data-email]') || null,
        node.parentElement,
      ];
      for (const candidate of neighborCandidates) {
        if (!candidate) continue;
        const emails = collectStandardAliasLikeTexts(candidate, new Set());
        for (const email of emails) {
          const normalized = normalizeStandardIcloudEmail(email, host);
          if (normalized) {
            return normalized;
          }
        }
      }
    }

    const fallbackEmails = collectStandardAliasLikeTexts(dialog, new Set());
    const aliases = parseAliasEntriesFromSettingsDialog(dialog, host).map((item) => item.email);
    const aliasSet = new Set(aliases);
    for (const email of fallbackEmails) {
      const normalized = normalizeStandardIcloudEmail(email, host);
      if (normalized && !aliasSet.has(normalized)) {
        return normalized;
      }
    }

    return '';
  }

  async function syncIcloudStandardPool(options = {}) {
    const desiredMaxAliasCount = Math.max(0, Math.min(3, Number(options.maxAliasCount) || 3));
    const createMissing = options.createMissing !== false;

    log('普通 iCloud 邮箱池：开始同步设置中的主地址与别名列表。', 'info');

    const iframeDoc = await waitForMailAutomationDocument(10000);
    if (typeof waitForMailAliasUiReady === 'function') {
      await waitForMailAliasUiReady(iframeDoc, Number(options.pageReadyTimeoutMs) || 15000);
    }

    let settingsDialog = await ensureSettingsAccountDialog(iframeDoc, 10000);
    const host = normalizeIcloudMailHostFromLocation(location);

    let primaryEmail = parsePrimaryEmailFromSettingsDialog(settingsDialog, host);
    let aliases = parseAliasEntriesFromSettingsDialog(settingsDialog, host)
      .filter((item) => item.email !== primaryEmail);

    let createdCount = 0;
    if (createMissing && aliases.length < desiredMaxAliasCount) {
      const missing = desiredMaxAliasCount - aliases.length;
      log(`普通 iCloud 邮箱池：当前别名数量 ${aliases.length}/${desiredMaxAliasCount}，将尝试补齐 ${missing} 个。`, 'info');
      for (let index = 0; index < missing; index += 1) {
        throwIfStopped();
        await createStandardAliasFromMailIframe(iframeDoc, {
          maxAttempts: Math.max(1, Number(options.maxAttemptsPerAlias) || 3),
          submitTimeoutMs: Number(options.submitTimeoutMs) || 10000,
        });
        createdCount += 1;
        await sleep(220);
      }

      settingsDialog = (typeof findSettingsAccountContainer === 'function'
        ? (findSettingsAccountContainer(iframeDoc) || settingsDialog)
        : settingsDialog);
      primaryEmail = parsePrimaryEmailFromSettingsDialog(settingsDialog, host);
      aliases = parseAliasEntriesFromSettingsDialog(settingsDialog, host)
        .filter((item) => item.email !== primaryEmail);
    } else {
      log(`普通 iCloud 邮箱池：当前别名数量 ${aliases.length}，无需补齐。`, 'info');
    }

    if (!primaryEmail) {
      log('普通 iCloud 邮箱池：未从账户设置中提取到主要地址。', 'warn');
    }

    log(`普通 iCloud 邮箱池：同步完成。主地址=${primaryEmail || '-'}，别名数=${aliases.length}，本次新增=${createdCount}`, 'ok');

    return {
      ok: true,
      host,
      primaryEmail: primaryEmail || '',
      aliases,
      createdCount,
    };
  }

  function isVisibleElement(node) {
    return Boolean(node instanceof HTMLElement)
      && (Boolean(node.offsetParent) || getComputedStyle(node).position === 'fixed');
  }

  function collectThreadItems() {
    return Array.from(document.querySelectorAll('.content-container')).filter((item) => {
      if (!isVisibleElement(item)) return false;
      return item.querySelector('.thread-participants')
        && item.querySelector('.thread-subject')
        && item.querySelector('.thread-preview');
    });
  }

  function getThreadItemMetadata(item) {
    const sender = normalizeText(item.querySelector('.thread-participants')?.textContent || '');
    const subject = normalizeText(item.querySelector('.thread-subject')?.textContent || '');
    const preview = normalizeText(item.querySelector('.thread-preview')?.textContent || '');
    const timestamp = normalizeText(item.querySelector('.thread-timestamp')?.textContent || '');
    return {
      sender,
      subject,
      preview,
      timestamp,
      combinedText: normalizeText([sender, subject, preview, timestamp].filter(Boolean).join(' ')),
    };
  }

  function buildItemSignature(item) {
    const meta = getThreadItemMetadata(item);
    return normalizeText([
      item.getAttribute('aria-label') || '',
      meta.sender,
      meta.subject,
      meta.preview,
      meta.timestamp,
    ].join('::')).slice(0, 240);
  }

  function extractVerificationCode(text) {
    const matchCn = text.match(/(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/);
    if (matchCn) return matchCn[1];

    const matchEn = text.match(/code[:\s]+is[:\s]+(\d{6})|code[:\s]+(\d{6})/i);
    if (matchEn) return matchEn[1] || matchEn[2];

    const match6 = text.match(/\b(\d{6})\b/);
    if (match6) return match6[1];

    return null;
  }

  function readOpenedMailHeader() {
    const headerRoot = document.querySelector('.ic-efwqa7');
    if (!headerRoot) {
      return { sender: '', recipients: '', timestamp: '' };
    }

    const contactValues = Array.from(headerRoot.querySelectorAll('.contact-token .ic-x1z554'))
      .map((node) => normalizeText(node.textContent))
      .filter(Boolean);
    const sender = contactValues[0] || '';
    const recipients = contactValues.slice(1).join(' ');
    const timestamp = normalizeText(headerRoot.querySelector('.ic-rffsj8')?.textContent || '');
    return { sender, recipients, timestamp };
  }

  function getOpenedMailBodyRoot() {
    return document.querySelector('.mail-message-defaults, .pane.thread-detail-pane');
  }

  function readOpenedMailBody() {
    const bodyRoot = getOpenedMailBodyRoot();
    return normalizeText(bodyRoot?.innerText || bodyRoot?.textContent || '');
  }

  function getThreadListItemRoot(item) {
    return item?.closest?.('.thread-list-item, [role="treeitem"]') || null;
  }

  function isThreadItemSelected(item, expectedSignature = '') {
    const expected = normalizeText(expectedSignature);
    const candidates = collectThreadItems();
    const matchedItem = expected
      ? candidates.find((candidate) => buildItemSignature(candidate) === expected)
      : item;
    const root = getThreadListItemRoot(matchedItem || item);
    if (!root) {
      return false;
    }
    if (root.getAttribute('aria-selected') === 'true') {
      return true;
    }
    const className = String(root.className || '').toLowerCase();
    return /\b(selected|current|active)\b/.test(className);
  }

  function openedMailMatchesExpectedContent(expectedMeta = {}, header = null, bodyText = '') {
    const expectedSender = normalizeText(expectedMeta.sender || '').toLowerCase();
    const expectedSubject = normalizeText(expectedMeta.subject || '').toLowerCase();
    const combined = normalizeText([
      header?.sender || '',
      header?.recipients || '',
      header?.timestamp || '',
      bodyText || '',
    ].join(' ')).toLowerCase();

    if (expectedSender && combined.includes(expectedSender)) {
      return true;
    }
    if (expectedSubject && combined.includes(expectedSubject)) {
      return true;
    }
    return false;
  }

  async function waitForOpenedMailContent(item, expectedMeta = {}, timeout = 10000) {
    const expectedSignature = buildItemSignature(item);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      throwIfStopped();
      const headerRoot = document.querySelector('.ic-efwqa7');
      const bodyRoot = getOpenedMailBodyRoot();
      const selected = isThreadItemSelected(item, expectedSignature);
      if (selected && (headerRoot || bodyRoot)) {
        const header = readOpenedMailHeader();
        const bodyText = normalizeText(bodyRoot?.innerText || bodyRoot?.textContent || '');
        if (openedMailMatchesExpectedContent(expectedMeta, header, bodyText)) {
          return { headerRoot, bodyRoot };
        }
      }
      await sleep(100);
    }
    throw new Error('打开邮件后未找到详情区域，请确认邮件内容已加载。');
  }

  async function openMailItemAndRead(item) {
    const expectedMeta = getThreadItemMetadata(item);
    simulateClick(item);

    const { bodyRoot } = await waitForOpenedMailContent(item, expectedMeta, 10000);
    await sleep(300);

    const header = readOpenedMailHeader();
    const bodyText = normalizeText(
      bodyRoot?.innerText || bodyRoot?.textContent || readOpenedMailBody()
    );
    return {
      ...header,
      bodyText,
      combinedText: normalizeText([header.sender, header.recipients, header.timestamp, bodyText].filter(Boolean).join(' ')),
    };
  }

  async function refreshInbox() {
    const refreshPatterns = [/刷新/i, /refresh/i, /重新载入/i];
    const candidates = document.querySelectorAll('button, [role="button"], a');
    for (const node of candidates) {
      const text = normalizeText(node.innerText || node.textContent || '');
      const label = normalizeText(node.getAttribute('aria-label') || node.getAttribute('title') || '');
      if (refreshPatterns.some((pattern) => pattern.test(text) || pattern.test(label))) {
        simulateClick(node);
        await sleep(1000);
        return;
      }
    }

    const inboxPatterns = [/收件箱/, /inbox/i];
    for (const node of candidates) {
      const text = normalizeText(node.innerText || node.textContent || '');
      const label = normalizeText(node.getAttribute('aria-label') || node.getAttribute('title') || '');
      if (inboxPatterns.some((pattern) => pattern.test(text) || pattern.test(label))) {
        simulateClick(node);
        await sleep(1000);
        return;
      }
    }
  }

  async function handlePollEmail(step, payload) {
    const { senderFilters, subjectFilters, maxAttempts, intervalMs, excludeCodes = [] } = payload;
    const excludedCodeSet = new Set(excludeCodes.filter(Boolean));
    const FALLBACK_AFTER = 3;
    const normalizedSenderFilters = senderFilters.map((filter) => String(filter || '').toLowerCase()).filter(Boolean);
    const normalizedSubjectFilters = subjectFilters.map((filter) => String(filter || '').toLowerCase()).filter(Boolean);

    log(`步骤 ${step}：开始轮询 iCloud 邮箱（最多 ${maxAttempts} 次）`);
    await waitForElement('.content-container', 10000);
    await sleep(1500);

    const existingSignatures = new Set(collectThreadItems().map(buildItemSignature));
    log(`步骤 ${step}：已记录当前 ${existingSignatures.size} 封旧邮件快照`);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      log(`步骤 ${step}：正在轮询 iCloud 邮箱，第 ${attempt}/${maxAttempts} 次`);

      if (attempt > 1) {
        await refreshInbox();
        await sleep(1200);
      }

      const items = collectThreadItems();
      const useFallback = attempt > FALLBACK_AFTER;

      for (const item of items) {
        const signature = buildItemSignature(item);
        if (!useFallback && existingSignatures.has(signature)) {
          continue;
        }

        const meta = getThreadItemMetadata(item);
        const lowerSender = meta.sender.toLowerCase();
        const lowerSubject = normalizeText([meta.subject, meta.preview].join(' ')).toLowerCase();
        const senderMatch = normalizedSenderFilters.some((filter) => lowerSender.includes(filter));
        const subjectMatch = normalizedSubjectFilters.some((filter) => lowerSubject.includes(filter));

        if (!senderMatch && !subjectMatch) {
          continue;
        }

        let code = extractVerificationCode(meta.combinedText);
        let opened = null;

        if (!code) {
          opened = await openMailItemAndRead(item);
          const openedSender = opened.sender.toLowerCase();
          const openedBody = opened.bodyText.toLowerCase();
          const openedSenderMatch = normalizedSenderFilters.some((filter) => openedSender.includes(filter));
          const openedSubjectMatch = normalizedSubjectFilters.some((filter) => openedBody.includes(filter));
          if (!openedSenderMatch && !openedSubjectMatch && !senderMatch && !subjectMatch) {
            continue;
          }
          code = extractVerificationCode(opened.combinedText);
        }

        if (!code) {
          continue;
        }
        if (excludedCodeSet.has(code)) {
          log(`步骤 ${step}：跳过排除的验证码：${code}`, 'info');
          continue;
        }

        const source = useFallback && existingSignatures.has(signature) ? '回退匹配邮件' : '新邮件';
        log(`步骤 ${step}：已找到验证码：${code}（来源：${source}）`, 'ok');
        return {
          ok: true,
          code,
          emailTimestamp: Date.now(),
          preview: (opened?.combinedText || meta.combinedText).slice(0, 160),
        };
      }

      if (attempt === FALLBACK_AFTER + 1) {
        log(`步骤 ${step}：连续 ${FALLBACK_AFTER} 次未发现新邮件，开始回退到首封匹配邮件`, 'warn');
      }

      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }

    throw new Error(
      `${Math.round((maxAttempts * intervalMs) / 1000)} 秒后仍未在 iCloud 邮箱中找到新的匹配邮件。请手动检查收件箱。`
    );
  }
}
