import {
  deleteAccount,
  fetchUserInfo,
  getAccounts,
  getSiteByUrl,
  getSiteCookies,
  saveAccount,
  SITES,
  renameAccount,
  switchToAccount,
  prepareForNewLogin
} from "./utils.js";

// 监听来自 content script 或 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender).then(sendResponse).catch(error => {
    console.error("Background error:", error);
    sendResponse({ success: false, error: error.message });
  });
  return true; // 保持通道开启以进行异步响应
});

// content script 不需要 cookie，剥离掉以防通过页面上下文泄露
function stripCookies(accounts) {
  const result = {};
  for (const [id, account] of Object.entries(accounts)) {
    if (account && account.cookies) {
      const { cookies: _omit, ...rest } = account;
      result[id] = rest;
    } else {
      result[id] = account;
    }
  }
  return result;
}

async function handleMessage(request, sender) {
  const siteId = resolveSiteId(request, sender);
  if (!siteId) {
    return { success: false, error: "当前页面暂不支持账号切换" };
  }

  switch (request.type) {
    case "GET_SITE":
      return { success: true, data: siteId };

    case "GET_ACCOUNTS": {
      const accounts = await getAccounts(siteId);
      // 来自 content script（sender.tab 存在）时剥离 cookie，仅扩展页面可拿到完整数据
      if (sender?.tab) {
        return { success: true, data: stripCookies(accounts) };
      }
      return { success: true, data: accounts };
    }

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
      // 仅凭 accountId 切换；cookie 由 background 自行从 storage 取，不经过 content script
      await switchToAccount(siteId, request.accountId || request.account?.id);
      return { success: true };

    case "LOGIN_NEW":
      // 登录新账号前也保存当前状态
      await prepareForNewLogin(siteId);
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
