// 常量定义
const BILIBILI_DOMAIN = "bilibili.com";
const API_NAV = "https://api.bilibili.com/x/web-interface/nav";

/**
 * 获取指定域名的所有 Cookie
 * @param {string} domain - 域名，默认为 bilibili.com
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
export async function getBilibiliCookies(domain = BILIBILI_DOMAIN) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: domain }, (cookies) => {
      resolve(cookies);
    });
  });
}

/**
 * 设置 Cookies 到浏览器
 * @param {chrome.cookies.Cookie[]} cookies - Cookie 对象数组
 */
export async function setBilibiliCookies(cookies) {
  // 先清除当前的 cookies
  await clearBilibiliCookies();
  
  const promises = cookies.map((cookie) => {
    // 构建 set 参数
    // 注意：url 是必须的，需要根据 domain 构建
    let url = "https://" + cookie.domain.replace(/^\./, "") + cookie.path;
    
    const cookieDetails = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      storeId: cookie.storeId,
      expirationDate: cookie.expirationDate
    };

    // 移除不支持的属性或者 undefined 的属性
    if (cookie.hostOnly !== undefined) delete cookieDetails.hostOnly;
    if (cookie.session !== undefined) delete cookieDetails.session;

    return new Promise((resolve) => {
      chrome.cookies.set(cookieDetails, (result) => {
        if (chrome.runtime.lastError) {
          console.error("Set cookie error:", chrome.runtime.lastError);
        }
        resolve(result);
      });
    });
  });

  await Promise.all(promises);
}

/**
 * 清除 B 站相关的所有 Cookies
 */
export async function clearBilibiliCookies() {
  const cookies = await getBilibiliCookies();
  const promises = cookies.map((cookie) => {
    let url = "https://" + cookie.domain.replace(/^\./, "") + cookie.path;
    return new Promise((resolve) => {
      chrome.cookies.remove({ url: url, name: cookie.name }, resolve);
    });
  });
  await Promise.all(promises);
}

/**
 * 调用 B 站 API 获取当前用户信息
 * @returns {Promise<Object|null>} 用户信息对象或 null
 */
export async function fetchUserInfo() {
  try {
    const response = await fetch(API_NAV);
    const data = await response.json();
    if (data.code === 0 && data.data.isLogin) {
      return {
        mid: data.data.mid,
        uname: data.data.uname,
        face: data.data.face,
        level_info: data.data.level_info,
        money: data.data.money,
        vip: data.data.vip
      };
    }
    return null;
  } catch (error) {
    console.error("Fetch user info error:", error);
    return null;
  }
}

/**
 * 保存账号信息到 storage
 * @param {Object} account - 账号信息对象
 */
export async function saveAccount(account) {
  const { accounts } = await getStorage("accounts");
  const newAccounts = accounts || {};
  
  // 更新或新增账号
  newAccounts[account.mid] = {
    ...account,
    timestamp: Date.now()
  };

  await setStorage({ accounts: newAccounts });
}

/**
 * 从 storage 获取所有账号
 * @returns {Promise<Object>} 账号字典 { mid: account }
 */
export async function getAccounts() {
  const { accounts } = await getStorage("accounts");
  return accounts || {};
}

/**
 * 删除账号
 * @param {string} mid - 用户 ID
 */
export async function deleteAccount(mid) {
  const accounts = await getAccounts();
  if (accounts[mid]) {
    delete accounts[mid];
    await setStorage({ accounts });
  }
}

// Storage 辅助函数
function getStorage(key) {
  return new Promise(resolve => chrome.storage.local.get(key, resolve));
}

function setStorage(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}
