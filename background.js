import {
  getBilibiliCookies,
  setBilibiliCookies,
  clearBilibiliCookies,
  fetchUserInfo,
  saveAccount,
  getAccounts,
  deleteAccount
} from './utils.js';

// 监听来自 content script 或 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request).then(sendResponse).catch((error) => {
    console.error('Background error:', error);
    sendResponse({ success: false, error: error.message });
  });
  return true; // 保持通道开启以进行异步响应
});

async function handleMessage(request) {
  switch (request.type) {
    case 'GET_ACCOUNTS':
      return { success: true, data: await getAccounts() };
      
    case 'GET_USER_INFO':
      return { success: true, data: await fetchUserInfo() };
      
    case 'ADD_ACCOUNT':
      const userInfo = await fetchUserInfo();
      if (!userInfo) {
        return { success: false, error: '未获取到用户信息' };
      }
      const cookies = await getBilibiliCookies();
      const accountData = { ...userInfo, cookies };
      await saveAccount(accountData);
      return { success: true };
      
    case 'SWITCH_ACCOUNT':
      await setBilibiliCookies(request.account.cookies);
      return { success: true };
      
    case 'LOGIN_NEW':
      await clearBilibiliCookies();
      return { success: true };
      
    case 'DELETE_ACCOUNT':
      await deleteAccount(request.mid);
      return { success: true };
      
    default:
      return { success: false, error: 'Unknown action' };
  }
}
