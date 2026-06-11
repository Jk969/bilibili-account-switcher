import {
  clearSiteCookies,
  deleteAccount,
  fetchUserInfo,
  getAccounts,
  getSiteByUrl,
  getSiteCookies,
  saveAccount,
  setSiteCookies,
  SITES,
  updateCurrentAccountCookies,
  renameAccount
} from "./utils.js";

// 监听来自 content script 或 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender).then(sendResponse).catch(error => {
    console.error("Background error:", error);
    sendResponse({ success: false, error: error.message });
  });
  return true; // 保持通道开启以进行异步响应
});

async function handleMessage(request, sender) {
  const siteId = resolveSiteId(request, sender);
  if (!siteId && request.type !== "GET_CURRENT_SITE_CONFIG") {
    return { success: false, error: "当前页面暂不支持账号切换" };
  }

  switch (request.type) {
    case "GET_SITE":
      return { success: true, data: siteId };

    case "GET_CURRENT_SITE_CONFIG": {
      const url = sender?.tab?.url;
      const site = getSiteByUrl(url);
      if (site) {
        return {
          success: true,
          data: {
            id: site.id,
            name: site.name,
            shortName: site.shortName,
            accentColor: site.accentColor
          }
        };
      }
      return { success: false, error: "Unsupported site" };
    }

    case "GET_ACCOUNTS":
      return { success: true, data: await getAccounts(siteId) };

    case "GET_USER_INFO":
      return { success: true, data: await fetchUserInfo(siteId) };

    case "ADD_ACCOUNT": {
      const userInfo = await fetchUserInfo(siteId);
      if (!userInfo) {
        return { success: false, error: "未获取到用户信息，请确认已登录" };
      }

      const cookies = await getSiteCookies(siteId);
      const accountData = { ...userInfo, cookies };
      await saveAccount(siteId, accountData);
      return { success: true };
    }

    case "SWITCH_ACCOUNT":
      // 切换前自动更新当前账号的 Cookies 到 storage
      // 防止因使用期间 Cookie 变化导致切回时失效
      await updateCurrentAccountCookies(siteId);
      await setSiteCookies(siteId, request.account.cookies);
      return { success: true };

    case "LOGIN_NEW":
      // 登录新账号前也保存当前状态
      await updateCurrentAccountCookies(siteId);
      await clearSiteCookies(siteId);
      return { success: true };

    case "DELETE_ACCOUNT":
      await deleteAccount(siteId, request.accountId || request.mid);
      return { success: true };

    case "RENAME_ACCOUNT":
      await renameAccount(siteId, request.accountId, request.newName);
      return { success: true };

    default:
      return { success: false, error: "Unknown action" };
  }
}

function resolveSiteId(request, sender) {
  if (request.siteId && (SITES[request.siteId] || request.siteId.includes('.'))) {
    return request.siteId;
  }
  const senderSite = getSiteByUrl(sender?.tab?.url);
  if (senderSite) return senderSite.id;
  return null;
}
