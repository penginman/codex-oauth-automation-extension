# 普通 iCloud 独立生成器项目计划

> 本文档为普通 iCloud 项目唯一主计划文档，采用单文档滚动更新机制。后续所有关键任务节点统一在此更新，不拆分子计划文件。

- 项目代号：`icloud-standard-alias`
- 文档路径：`docs/普通iCloud项目计划.md`
- 创建日期：`2026-04-17`
- 最近更新：`2026-04-17 16:35 (Asia/Hong_Kong)`

---

## 1. 项目目标与范围

### 1.1 目标
- 新增独立邮箱生成器 `icloud-standard-alias`，通过 iCloud Mail 页面 DOM 流程创建普通别名邮箱。
- 与现有 `icloud`（Hide My Email API）生成器并存，确保互不影响。
- 建立可持续续做的里程碑看板，保证下次会话可无缝衔接。

### 1.2 范围内（In Scope）
- 生成器选项接入（UI、状态持久化、恢复）。
- 后台分发接入（新生成器走 iCloud mail content message）。
- content 侧 DOM 创建流程接入（含失败提示与重试）。
- 必要测试覆盖与回归验证。

### 1.3 范围外（Out of Scope）
- 重构现有 Hide My Email 管理模块架构。
- 新增与本需求无关的 iCloud 设置自动导航大改。
- 多文档并行计划管理。

---

## 2. 已锁定决策

### 2.1 核心决策
- 生成器内部标识：`icloud-standard-alias`
- 页面消息类型：`CREATE_ICLOUD_STANDARD_ALIAS`
- 页面准备策略：后台自动打开或复用 iCloud Mail 页面后执行
- 冲突重试策略：默认 1 次（仅保留单次尝试，避免重复点击设置和重复提交）
- 文档维护策略：单文档滚动更新

### 2.2 接口/契约
- `emailGenerator` 新增合法值：`icloud-standard-alias`
- content 消息新增：`CREATE_ICLOUD_STANDARD_ALIAS`
- 响应约定：
  - 成功：`{ ok: true, email: string, alias: string }`
  - 失败：`{ ok: false, error: string }`（或现有错误通道中的 `error`）
- 错误文案要求：必须可定位问题（节点缺失、按钮不可用、会话未就绪、重试耗尽）

---

## 3. 里程碑看板

状态枚举：`pending | in_progress | blocked | done`

| 里程碑 | 目标 | 状态 | 开始时间 | 目标输出 | 证据 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| M0 | 主计划文档初始化 | done | 2026-04-17 | 建立单文档滚动维护骨架 | 本文档已创建 | 进入 M1 |
| M1 | 生成器枚举与 UI 接入 | done | 2026-04-17 15:03 | `icloud-standard-alias` 出现在 sidepanel 并可持久化恢复 | 已修改 `sidepanel/sidepanel.html`、`sidepanel/sidepanel.js`、`background.js`，并通过定向测试 | 进入 M2 |
| M2 | 后台分发接入 | done | 2026-04-17 15:08 | 新生成器路由到 `icloud-mail` content message | 已修改 `background/generated-email-helpers.js` 与 `background.js`，并通过定向测试 | 进入 M3 |
| M3 | content DOM 创建流程 | done | 2026-04-17 15:11 | `CREATE_ICLOUD_STANDARD_ALIAS` + 单次尝试 + DOM 创建链路 | 已修改 `content/icloud-mail.js`，并补充设置菜单、别名弹窗、alertdialog 处理逻辑 | 进入 M4 |
| M4 | 测试补齐 | done | 2026-04-17 15:14 | 覆盖映射、分发、规则与失败路径 | 已新增/修改 `tests/background-generated-email-module.test.js`、`tests/background-icloud.test.js`、`tests/icloud-mail-content.test.js`、`tests/sidepanel-icloud-standard-generator.test.js`，并完成定向验证 | 进入 M5 |
| M5 | 回归与交付 | in_progress | 2026-04-17 16:35 | 现有 `icloud` 隐私邮箱链路不回归，等待浏览器手动回归 | 已完成定向回归测试，待浏览器安装扩展手测 | 等待手动验证日志 |

---

## 4. 当前会话进度

### 4.1 本次完成
- 已建立普通 iCloud 项目主计划文档。
- 已锁定长期维护机制（单文档滚动更新）。
- 已初始化 M0-M5 里程碑并定义状态标准。
- 已启动 M1，开始接入 `icloud-standard-alias` 的枚举、UI 选项与状态恢复逻辑。
- 已完成 M1：新生成器已在 sidepanel 可选、可恢复，并接入 iCloud 面板联动。
- 已完成 M2：后台已将 `icloud-standard-alias` 分发到 `CREATE_ICLOUD_STANDARD_ALIAS` 消息链路。
- 已完成 M3：`content/icloud-mail.js` 已支持普通 iCloud 别名创建、基础错误提示、设置菜单自动打开与单次尝试。\n- 已修复“设置”重复点击问题：菜单项查找现在会排除 launcher 及其子节点，并等待真正的菜单项出现后再点击。\n- 已补充等待期提示处理：当页面出现 `ui-popup[role="alertdialog"]` 且文案为“你目前处于等候期”时，会直接抛出可定位错误。
- 已完成 M4：新增测试覆盖了菜单项排除、等待期 alertdialog、单次尝试默认值，并完成通过验证。\n- 已进入 M5：当前保留详细日志，等待你在浏览器中手动安装扩展做真实页面验证。

### 4.2 当前阻塞
- 无代码阻塞；当前仅待浏览器真实页面手动验证。

### 4.3 风险与注意
- 若后续没有按规则更新“证据+下一步”，续做可追溯性会下降。
- `icloud-standard-alias` 实施阶段需重点关注与现有 `icloud` 分支隔离，避免行为回归。\n- 当前日志仍偏详细，待浏览器链路验证稳定后再删减。
- `node --test` 在当前沙箱下会触发 `spawn EPERM`，已改用 `node -e "require(...)"` 方式完成定向测试验证。

---

## 5. 验收清单

### 5.1 功能验收
- [x] 新生成器可选、可保存、可恢复。
- [ ] 新生成器能自动打开或复用 iCloud Mail 并创建普通别名。
- [x] 现有 `icloud`（Hide My Email）行为保持不变。
- [x] 别名冲突、按钮不可用、节点缺失、等待期限制时有可定位错误提示。

### 5.2 回归验收
- [x] `emailGenerator=icloud` 分支仍走 Hide My Email API。
- [ ] 自动运行流程中邮箱获取重试与等待逻辑不被破坏。
- [x] sidepanel 文案和状态恢复逻辑无回归。

### 5.3 日志与报错验收
- [ ] 成功日志包含生成结果邮箱。
- [x] 失败日志包含明确失败阶段与错误原因。
- [x] 单次尝试失败时提示包含“已尝试次数”和错误原因。

---

## 6. 下次续做入口

### 6.1 唯一下一步任务
- 下一步：由你在浏览器中重新加载扩展并手动触发 `icloud-standard-alias`，把从“开始准备页面文档”开始的完整日志发我，我继续按日志收口。

### 6.2 推荐启动口令
- `继续普通 iCloud 项目：查看最新浏览器日志，继续收口普通别名创建链路。`

### 6.3 关键节点更新规则（固定执行）
1. 开始某里程碑前：将状态改为 `in_progress`，填写“开始时间 + 目标输出”。
2. 完成后：将状态改为 `done`，补“改动文件、测试命令、结果摘要”。
3. 若受阻：将状态改为 `blocked`，补“阻塞原因 + 临时绕过 + 需要输入”。
4. 每次会话结束：只保留一个最高优先级“唯一下一步任务”。

### 6.4 会话更新模板
```md
- 更新时间：YYYY-MM-DD HH:mm (Asia/Hong_Kong)
- 当前里程碑：Mx
- 状态变更：pending -> in_progress / in_progress -> done / in_progress -> blocked
- 改动文件：...
- 测试命令：...
- 结果摘要：...
- 下一步：...
```

### 6.5 本次证据
- 更新时间：2026-04-17 15:18 (Asia/Hong_Kong)
- 当前里程碑：M1 -> M4
- 状态变更：M1 done，M2 done，M3 done，M4 in_progress
- 改动文件：`background.js`、`background/generated-email-helpers.js`、`content/icloud-mail.js`、`sidepanel/sidepanel.html`、`sidepanel/sidepanel.js`、`tests/background-generated-email-module.test.js`、`tests/background-icloud.test.js`、`tests/icloud-mail-content.test.js`、`tests/sidepanel-icloud-standard-generator.test.js`
- 测试命令：`D:\nvm\22.20.0\node.exe -e "require('./tests/background-generated-email-module.test.js')"`、`D:\nvm\22.20.0\node.exe -e "require('./tests/icloud-mail-content.test.js')"`、`D:\nvm\22.20.0\node.exe -e "require('./tests/sidepanel-icloud-standard-generator.test.js')"`、`D:\nvm\22.20.0\node.exe -e "require('./tests/background-icloud.test.js')"`
- 结果摘要：上述定向测试均通过；`node --test` 直接执行受沙箱 `spawn EPERM` 限制，已采用替代验证方式。
- 下一步：继续补 `M4/M5` 的回归验证，确认新生成器在更多现有流程中的兼容性。

