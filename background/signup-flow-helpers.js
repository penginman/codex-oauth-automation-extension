(function attachSignupFlowHelpers(root, factory) {
  root.MultiPageSignupFlowHelpers = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createSignupFlowHelpersModule() {
  function createSignupFlowHelpers(deps = {}) {
    const {
      addLog,
      buildGeneratedAliasEmail,
      chrome,
      ensureContentScriptReadyOnTab,
      ensureHotmailAccountForFlow,
      ensureLuckmailPurchaseForFlow,
      getTabId,
      isGeneratedAliasProvider,
      isHotmailProvider,
      isLuckmailProvider,
      isSignupPasswordPageUrl,
      isTabAlive,
      reuseOrCreateTab,
      sendToContentScriptResilient,
      setEmailState,
      SIGNUP_ENTRY_URL,
      SIGNUP_PAGE_INJECT_FILES,
      waitForTabUrlMatch,
    } = deps;

    async function openSignupEntryTab(step = 1) {
      const tabId = await reuseOrCreateTab('signup-page', SIGNUP_ENTRY_URL, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: 'signup-page',
      });

      await ensureContentScriptReadyOnTab('signup-page', tabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: 'signup-page',
        timeoutMs: 45000,
        retryDelayMs: 900,
        logMessage: `步骤 ${step}：ChatGPT 官网仍在加载，正在重试连接内容脚本...`,
      });

      return tabId;
    }

    async function ensureSignupEntryPageReady(step = 1) {
      const tabId = await openSignupEntryTab(step);
      const result = await sendToContentScriptResilient('signup-page', {
        type: 'ENSURE_SIGNUP_ENTRY_READY',
        step,
        source: 'background',
        payload: {},
      }, {
        timeoutMs: 20000,
        retryDelayMs: 700,
        logMessage: `步骤 ${step}：官网注册入口正在切换，等待页面恢复...`,
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      return { tabId, result: result || {} };
    }

    async function ensureSignupPasswordPageReadyInTab(tabId, step = 2, options = {}) {
      const { skipUrlWait = false } = options;

      if (!skipUrlWait) {
        const matchedTab = await waitForTabUrlMatch(tabId, (url) => isSignupPasswordPageUrl(url), {
          timeoutMs: 45000,
          retryDelayMs: 300,
        });
        if (!matchedTab) {
          throw new Error('等待进入密码页超时，请检查邮箱提交后页面是否仍停留在官网或邮箱页。');
        }
      }

      await ensureContentScriptReadyOnTab('signup-page', tabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: 'signup-page',
        timeoutMs: 45000,
        retryDelayMs: 900,
        logMessage: `步骤 ${step}：密码页仍在加载，正在重试连接内容脚本...`,
      });

      const result = await sendToContentScriptResilient('signup-page', {
        type: 'ENSURE_SIGNUP_PASSWORD_PAGE_READY',
        step,
        source: 'background',
        payload: {},
      }, {
        timeoutMs: 20000,
        retryDelayMs: 700,
        logMessage: `步骤 ${step}：认证页正在切换，等待密码页重新就绪...`,
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      return result || {};
    }

    async function resolveSignupEmailForFlow(state) {
      let resolvedEmail = state.email;
      if (isHotmailProvider(state)) {
        const account = await ensureHotmailAccountForFlow({
          allowAllocate: true,
          markUsed: true,
          preferredAccountId: state.currentHotmailAccountId || null,
        });
        resolvedEmail = account.email;
      } else if (isLuckmailProvider(state)) {
        const purchase = await ensureLuckmailPurchaseForFlow({ allowReuse: true });
        resolvedEmail = purchase.email_address;
      } else if (isGeneratedAliasProvider(state)) {
        resolvedEmail = buildGeneratedAliasEmail(state);
      }

      if (!resolvedEmail) {
        throw new Error('缺少邮箱地址，请先在侧边栏粘贴邮箱。');
      }

      if (resolvedEmail !== state.email) {
        await setEmailState(resolvedEmail);
      }

      return resolvedEmail;
    }

    return {
      ensureSignupEntryPageReady,
      ensureSignupPasswordPageReadyInTab,
      openSignupEntryTab,
      resolveSignupEmailForFlow,
    };
  }

  return {
    createSignupFlowHelpers,
  };
});
