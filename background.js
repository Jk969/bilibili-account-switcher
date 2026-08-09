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
  // 只信任本扩展自己的 frame（popup / options / content script）。
  // 未配置 externally_connectable 时网页本就无法直接发消息，这里再防御一层。
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: "未授权的调用方" });
    return false;
  }
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

  // 写/删类操作要求来自扩展页面（popup）或本扩展的 content script，
  // 且 content script 的站点必须与其所在页面对应，避免跨站点误操作。
  const isContentScript = !!sender?.tab;
  if (isContentScript) {
    const senderSite = getSiteByUrl(sender?.tab?.url);
    if (senderSite && senderSite.id !== siteId) {
      return { success: false, error: "站点不匹配，已拒绝操作" };
    }
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

// 快捷键：Alt+Shift+S 显示/隐藏当前页悬浮球。
// 注意：若悬浮球尚未注入（如该站点无账号），content script 收到也会忽略。
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== "toggle-floating") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FLOATING" }, () => {
      // content script 可能未注入（受限页面），忽略 lastError
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // 静默
  }
});
