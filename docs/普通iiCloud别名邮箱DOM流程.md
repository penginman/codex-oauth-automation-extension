# 普通iiCloud别名邮箱 DOM 操作流程记录

## 目标
- 通过 iCloud Web 邮件页的「设置 -> 账户 -> 添加别名」流程，自动创建一个符合规则的 iCloud 邮箱别名。
- 该流程用于后续接入扩展里的新邮箱生成器（名称：`普通iiCloud别名邮箱`）。
- 实现方式采用 `item.querySelector(...)` / `Array.from(...).find(...)` 风格，不走 iCloud 别名后端 API。

## 本次会话已确认环境
- 登录方式：复用现有扩展「邮箱服务 = iCloud 邮箱」登录链路，手动登录成功后继续自动化。
- 页面入口：`https://www.icloud.com/`。
- 邮件应用页：`https://www.icloud.com/mail/`。
- Mail 应用实际运行在 iframe：
  - iframe URL 类似：`https://www.icloud.com/applications/mail2/current/.../index.html`。

## 已验证的关键规则
- 别名长度必须在 `3-20` 字符之间。
- 别名首字符不能是数字。
- 标签（Label）可以不填。

## QuerySelector 节点清单（可直接用于代码）

### 1) 顶层页面 -> mail2 iframe
- 顶层定位：
  - `const frame = document.querySelector('iframe.child-application');`
  - `const iframeDoc = frame?.contentDocument;`

### 2) 设置弹窗（账户页）
- 弹窗根（建议按文本语义找）：
  - `const dialogs = Array.from(iframeDoc.querySelectorAll('[role="dialog"], dialog, .regular'));`
  - `const settingsDialog = dialogs.find(d => /账户/.test(d.textContent || '') && /添加别名/.test(d.textContent || ''));`
- 关键按钮：
  - 关闭按钮：
    - `settingsDialog.querySelector('ui-button.x-close-button, button.x-close-button, .x-close-button')`
  - 当前账户 tab（已选中）：
    - `settingsDialog.querySelector('[role="tab"][aria-selected="true"], [role="tab"][tabindex="0"]')`
  - 添加别名（主选择器）：
    - `settingsDialog.querySelector('ui-button[aria-label="添加别名"], button[aria-label="添加别名"]')`
  - 添加别名（class 兜底）：
    - `settingsDialog.querySelector('ui-button.actionable-row-item.ic-cbcudj')`
  - 添加别名（文本兜底）：
    - `Array.from(settingsDialog.querySelectorAll('ui-button,button,[role="button"]')).find(btn => /添加别名/.test((btn.textContent || '').trim()) || /添加别名/.test(btn.getAttribute('aria-label') || ''))`

### 3) 添加别名弹窗
- 弹窗根（推荐）：
  - `const aliasDialog = dialogs.find(d => /添加邮件别名/.test(d.getAttribute('aria-label') || '') || /新的地址别名/.test(d.textContent || ''));`
- 输入框：
  - 别名输入框：
    - `aliasDialog.querySelector('input[aria-label="别名"]')`
  - 标签输入框（可选）：
    - `aliasDialog.querySelector('#accountlabel-component')`
  - 全名输入框（可不改）：
    - `aliasDialog.querySelector('#fullname-component')`
- 创建按钮：
  - 文本定位：
    - `Array.from(aliasDialog.querySelectorAll('ui-button,button,[role="button"]')).find(btn => /创建/.test((btn.textContent || '').trim()))`

## 代码流程（item.querySelector 风格伪代码）
```js
function findDialogByText(doc, patterns = []) {
  const dialogs = Array.from(doc.querySelectorAll('[role="dialog"], dialog, .regular'));
  return dialogs.find((item) => {
    const text = String(item.textContent || '').replace(/\s+/g, ' ');
    return patterns.every((pattern) => pattern.test(text));
  }) || null;
}

function clickByText(item, pattern) {
  const btn = Array.from(item.querySelectorAll('ui-button,button,[role="button"],[role="menuitem"]'))
    .find((el) => pattern.test(String(el.textContent || '').trim()) || pattern.test(el.getAttribute('aria-label') || ''));
  if (!btn) throw new Error('未找到目标按钮: ' + pattern);
  btn.click();
  return btn;
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

async function createStandardAliasFromMailIframe(doc) {
  const settingsDialog = findDialogByText(doc, [/账户/, /添加别名/]);
  if (!settingsDialog) throw new Error('未找到设置-账户弹窗');

  const addAliasBtn =
    settingsDialog.querySelector('ui-button[aria-label="添加别名"],button[aria-label="添加别名"]')
    || settingsDialog.querySelector('ui-button.actionable-row-item.ic-cbcudj')
    || clickByText(settingsDialog, /添加别名/);
  if (addAliasBtn?.click) addAliasBtn.click();

  const aliasDialog = findDialogByText(doc, [/新的地址别名|添加邮件别名/, /地址/, /创建/]);
  if (!aliasDialog) throw new Error('未找到添加别名弹窗');

  const aliasInput = aliasDialog.querySelector('input[aria-label="别名"]');
  if (!aliasInput) throw new Error('未找到别名输入框');

  const alias = generateIcloudStandardAlias();
  fillInput(aliasInput, alias);

  // 标签可空：不填
  const createBtn = Array.from(aliasDialog.querySelectorAll('ui-button,button,[role="button"]'))
    .find((btn) => /创建/.test((btn.textContent || '').trim()));
  if (!createBtn) throw new Error('未找到创建按钮');
  if (createBtn.hasAttribute('disabled') || createBtn.getAttribute('aria-disabled') === 'true') {
    throw new Error('创建按钮仍不可用，请检查别名是否合法');
  }

  createBtn.click();
  return `${alias}@icloud.com`;
}
```

## 已确认校验文案
- 长度超限时：`别名长度必须介于 3-20 个字符之间。`
- 首字符为数字时：`别名不能以数字开头。`

## 下次继续开发建议顺序
1. 在 `content/icloud-mail.js` 加入 `CREATE_ICLOUD_STANDARD_ALIAS` 消息处理。
2. 将上面的 querySelector 流程封装到独立函数（避免和轮询验证码逻辑混在一起）。
3. 在 `background.js` 新增生成器分发到 `sendToContentScript('icloud-mail', { type: 'CREATE_ICLOUD_STANDARD_ALIAS' })`。
4. 在 `sidepanel` 增加生成器选项「普通iiCloud别名邮箱」。
5. 增加最小测试覆盖（生成规则、分发逻辑、失败提示）。

## 当前状态
- 选择器与流程已经按 `item.querySelector` 风格整理完成。
- 文档可直接作为 `content/icloud-mail.js` 实现脚本的参考。
