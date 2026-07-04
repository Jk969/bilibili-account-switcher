// 多站点配置
export const SITES = {
  bilibili: {
    id: "bilibili",
    name: "Bilibili",
    shortName: "B站",
    accentColor: "#00a1d6",
    urlPatterns: ["bilibili.com"],
    cookieDomains: ["bilibili.com"],
    emptyTip: "暂无账号，请登录B站后添加",
    unsupportedTip: "请在 Bilibili 或 ChatGPT 页面使用",
    async fetchUserInfo() {
      const response = await fetch("https://api.bilibili.com/x/web-interface/nav", {
        credentials: "include"
      });
      const data = await response.json();
      if (data.code === 0 && data.data.isLogin) {
        return normalizeAccount(this.id, {
          id: String(data.data.mid),
          displayName: data.data.uname,
          subtitle: `UID: ${data.data.mid}`,
          avatar: data.data.face,
          raw: {
            mid: data.data.mid,
            uname: data.data.uname,
            face: data.data.face,
            level_info: data.data.level_info,
            money: data.data.money,
            vip: data.data.vip
          }
        });
      }
      return null;
    },
    getCurrentAccountIdFromCookies(cookies) {
      return cookies.find(cookie => cookie.name === "DedeUserID")?.value || null;
    }
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    shortName: "ChatGPT",
    accentColor: "#10a37f",
    urlPatterns: ["chatgpt.com", "chat.openai.com"],
    cookieDomains: ["chatgpt.com", "chat.openai.com", "openai.com", "auth.openai.com"],
    emptyTip: "暂无账号，请登录 ChatGPT 后添加",
    unsupportedTip: "请在 Bilibili 或 ChatGPT 页面使用",
    async fetchUserInfo() {
      try {
        const response = await fetch("https://chatgpt.com/backend-api/me", {
          credentials: "include"
        });
        if (response.ok) {
          const data = await response.json();
          const user = data.user || data;
          const id = user.id || user.email;
          if (id) {
            return normalizeAccount(this.id, {
              id: String(id),
              displayName: user.name || user.email || "ChatGPT 用户",
              subtitle: user.email || `ID: ${id}`,
              avatar: user.image || user.picture || "",
              raw: user
            });
          }
        }
      } catch (error) {
        console.warn("ChatGPT user info API unavailable, falling back to cookie fingerprint:", error);
      }

      const cookies = await getSiteCookies(this.id);
      return createCookieOnlyAccount(this.id, cookies, "ChatGPT 账号");
    }
  }
};

const ACCOUNTS_BY_SITE_KEY = "accountsBySite";
const LEGACY_BILIBILI_ACCOUNTS_KEY = "accounts";
// 记录每个站点「当前活动账号 id」，用于切换前精确回写最新 cookie
const ACTIVE_ACCOUNT_KEY = "activeAccountBySite";
// 记录「哪些站点有账号」的轻量集合（仅 siteId→true，不含 cookie），
// 供 content script 不唤醒 service worker、不读 accountsBySite 即可判断是否显示悬浮球
const SITES_WITH_ACCOUNTS_KEY = "sitesWithAccounts";
// 数据结构版本号，便于未来迁移；旧数据会在写入时被补上
const SCHEMA_VERSION = 1;

/**
 * 统一写入 accountsBySite，并补上 schema 版本号
 */
async function persistAccountsBySite(accountsBySite) {
  accountsBySite.schemaVersion = SCHEMA_VERSION;
  await setStorage({ [ACCOUNTS_BY_SITE_KEY]: accountsBySite });
}

/**
 * 重新计算某站点是否仍有账号，更新 sitesWithAccounts 集合
 */
export async function recomputeSiteHasAccounts(siteId) {
  const storage = await getStorage([SITES_WITH_ACCOUNTS_KEY]);
  const map = storage[SITES_WITH_ACCOUNTS_KEY] || {};
  const accounts = await getAccounts(siteId);
  if (Object.keys(accounts).length > 0) {
    map[siteId] = true;
  } else {
    delete map[siteId];
  }
  await setStorage({ [SITES_WITH_ACCOUNTS_KEY]: map });
}

export function getBaseDomain(hostname) {
  if (!hostname) return "";
  const parts = hostname.split('.');
  // IP 地址直接返回
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return hostname;
  }
  const tldSuffixes = [
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'com.hk', 'org.hk', 'co.uk', 'org.uk', 'co.jp', 'ne.jp',
    'com.tw', 'org.tw', 'edu.tw', 'org.mo', 'com.mo'
  ];
  let baseDomainIndex = parts.length - 2;
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join('.');
    if (tldSuffixes.includes(lastTwo)) {
      baseDomainIndex = parts.length - 3;
    }
  }
  if (baseDomainIndex < 0) baseDomainIndex = 0;
  return parts.slice(baseDomainIndex).join('.');
}

export function generateColorFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  // 使用 HSL，S 为 70% 保证色彩鲜明，L 为 40% 保证可读性
  return `hsl(${hue}, 70%, 40%)`;
}

export function createDynamicSiteConfig(siteId, hostname) {
  const baseDomain = getBaseDomain(hostname);
  const accentColor = generateColorFromString(baseDomain);
  return {
    id: baseDomain,
    name: baseDomain,
    shortName: baseDomain,
    accentColor: accentColor,
    urlPatterns: [baseDomain],
    cookieDomains: [baseDomain],
    emptyTip: `暂无账号，请登录 ${baseDomain} 后添加`,
    unsupportedTip: `请在对应的页面使用`,
    async fetchUserInfo() {
      const cookies = await getSiteCookies(baseDomain);
      return createCookieOnlyAccount(baseDomain, cookies, `${baseDomain}账号`);
    }
  };
}

export async function renameAccount(siteId, accountId, newName) {
  const accountsBySite = await getAccountsBySite();
  const siteAccounts = accountsBySite[siteId] || {};
  if (siteAccounts[accountId]) {
    siteAccounts[accountId].displayName = newName;
    siteAccounts[accountId].uname = newName;
    accountsBySite[siteId] = siteAccounts;
    await persistAccountsBySite(accountsBySite);
  }
}

export function getSite(siteId) {
  if (SITES[siteId]) return SITES[siteId];
  if (siteId && siteId.includes('.')) {
    return createDynamicSiteConfig(siteId, siteId);
  }
  return SITES.bilibili;
}

export function getSiteByUrl(url) {
  if (!url) return null;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    const hostname = parsedUrl.hostname;
    // 1. 尝试匹配预置站点
    const predefinedSite = Object.values(SITES).find(site =>
      site.urlPatterns.some(pattern => hostname === pattern || hostname.endsWith(`.${pattern}`))
    );
    if (predefinedSite) return predefinedSite;

    // 2. 动态生成站点配置
    const baseDomain = getBaseDomain(hostname);
    return createDynamicSiteConfig(baseDomain, hostname);
  } catch (error) {
    return null;
  }
}

export function normalizeAccount(siteId, account) {
  const raw = account.raw || account;
  const id = String(account.id || account.mid || raw.mid || raw.id || raw.email || "");
  const displayName = account.displayName || account.uname || raw.uname || raw.name || raw.email || "未知账号";
  const subtitle = account.subtitle || (account.mid || raw.mid ? `UID: ${account.mid || raw.mid}` : raw.email || `ID: ${id}`);
  const avatar = account.avatar || account.face || raw.face || raw.image || raw.picture || "";

  return {
    ...raw,
    ...account,
    siteId,
    id,
    mid: account.mid || raw.mid || id,
    displayName,
    uname: account.uname || raw.uname || displayName,
    subtitle,
    avatar,
    face: account.face || raw.face || avatar
  };
}

/**
 * 获取指定站点的所有 Cookie
 * @param {string} siteId - 站点 ID
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
export async function getSiteCookies(siteId = "bilibili") {
  const site = getSite(siteId);
  const cookieGroups = await Promise.all(site.cookieDomains.map(domain => getCookiesByDomain(domain)));
  const cookiesByKey = new Map();

  cookieGroups.flat().forEach(cookie => {
    const key = `${cookie.storeId || ""}|${cookie.domain}|${cookie.path}|${cookie.name}`;
    cookiesByKey.set(key, cookie);
  });

  return Array.from(cookiesByKey.values());
}

/**
 * 设置 Cookies 到浏览器
 * @param {string} siteId - 站点 ID
 * @param {chrome.cookies.Cookie[]} cookies - Cookie 对象数组
 */
export async function setSiteCookies(siteId = "bilibili", cookies = []) {
  await clearSiteCookies(siteId);

  const promises = cookies.map(cookie => {
    const cookieDetails = buildCookieSetDetails(cookie);

    return new Promise(resolve => {
      chrome.cookies.set(cookieDetails, result => {
        if (chrome.runtime.lastError) {
          console.error("Set cookie error:", chrome.runtime.lastError, cookie.name);
        }
        resolve(result);
      });
    });
  });

  await Promise.all(promises);
}

/**
 * 清除指定站点相关的所有 Cookies
 */
export async function clearSiteCookies(siteId = "bilibili") {
  const cookies = await getSiteCookies(siteId);
  const promises = cookies.map(cookie => {
    const details = {
      url: buildCookieUrl(cookie),
      name: cookie.name
    };
    if (cookie.storeId) details.storeId = cookie.storeId;

    return new Promise(resolve => {
      chrome.cookies.remove(details, () => {
        if (chrome.runtime.lastError) {
          console.error("Remove cookie error:", chrome.runtime.lastError, cookie.name);
        }
        resolve();
      });
    });
  });

  await Promise.all(promises);
}

/**
 * 调用当前站点 API 获取当前用户信息
 * @returns {Promise<Object|null>} 用户信息对象或 null
 */
export async function fetchUserInfo(siteId = "bilibili") {
  try {
    return await getSite(siteId).fetchUserInfo();
  } catch (error) {
    console.error("Fetch user info error:", error);
    return null;
  }
}

/**
 * 保存账号信息到 storage
 * @param {string} siteId - 站点 ID
 * @param {Object} account - 账号信息对象
 */
export async function saveAccount(siteId = "bilibili", account) {
  const accountsBySite = await getAccountsBySite();
  const siteAccounts = accountsBySite[siteId] || {};
  const normalizedAccount = normalizeAccount(siteId, account);

  siteAccounts[normalizedAccount.id] = {
    ...normalizedAccount,
    timestamp: Date.now()
  };

  accountsBySite[siteId] = siteAccounts;
  await persistAccountsBySite(accountsBySite);
  await recomputeSiteHasAccounts(siteId);
  // 刚保存的就是当前登录中的账号，记为活动账号
  await setActiveAccountId(siteId, normalizedAccount.id);
  return normalizedAccount.id;
}

/**
 * 从 storage 获取指定站点所有账号
 * @returns {Promise<Object>} 账号字典 { id: account }
 */
export async function getAccounts(siteId = "bilibili") {
  const accountsBySite = await getAccountsBySite();
  return accountsBySite[siteId] || {};
}

/**
 * 删除账号
 * @param {string} siteId - 站点 ID
 * @param {string} accountId - 账号 ID
 */
export async function deleteAccount(siteId = "bilibili", accountId) {
  const accountsBySite = await getAccountsBySite();
  const siteAccounts = accountsBySite[siteId] || {};
  if (siteAccounts[accountId]) {
    delete siteAccounts[accountId];
    accountsBySite[siteId] = siteAccounts;
    await persistAccountsBySite(accountsBySite);
    await recomputeSiteHasAccounts(siteId);
  }
}

/**
 * 尝试更新当前登录账号的 Cookies 到 storage
 * 用于在切换账号或清除 Cookies 前，保存最新的 Cookie 状态
 */
export async function updateCurrentAccountCookies(siteId = "bilibili") {
  try {
    const cookies = await getSiteCookies(siteId);
    const site = getSite(siteId);
    // 1) 优先用站点稳定的 cookie 字段识别「真实当前登录」（如 Bilibili 的 DedeUserID）
    let accountId = site.getCurrentAccountIdFromCookies?.(cookies) || null;
    // 2) 回退到本扩展记录的活动账号 —— 适合没有稳定 cookie 字段的站点（ChatGPT / 通用站点），
    //    其指纹会随 token 轮换漂移，直接用活动账号比用漂移指纹更可靠
    if (!accountId) {
      accountId = await getActiveAccountId(siteId);
    }
    // 3) 最后回退：调用站点用户信息接口
    if (!accountId) {
      const currentUser = await fetchUserInfo(siteId);
      accountId = currentUser?.id || null;
    }

    if (!accountId) return false;

    const accountsBySite = await getAccountsBySite();
    const siteAccounts = accountsBySite[siteId] || {};
    if (siteAccounts[accountId]) {
      siteAccounts[accountId].cookies = cookies;
      siteAccounts[accountId].timestamp = Date.now();
      accountsBySite[siteId] = siteAccounts;
      await persistAccountsBySite(accountsBySite);
      console.log(`[AutoSave] Updated cookies for ${siteId} account: ${accountId}`);
      return true;
    }
  } catch (error) {
    console.error("Auto update account failed:", error);
  }
  return false;
}

/**
 * 获取某站点当前活动账号 id（本扩展自己记录的「最近切到/添加的账号」）
 */
export async function getActiveAccountId(siteId) {
  const storage = await getStorage([ACTIVE_ACCOUNT_KEY]);
  return storage[ACTIVE_ACCOUNT_KEY]?.[siteId] || null;
}

/**
 * 设置/清除某站点当前活动账号 id
 */
export async function setActiveAccountId(siteId, accountId) {
  const storage = await getStorage([ACTIVE_ACCOUNT_KEY]);
  const map = storage[ACTIVE_ACCOUNT_KEY] || {};
  if (accountId) {
    map[siteId] = accountId;
  } else {
    delete map[siteId];
  }
  await setStorage({ [ACTIVE_ACCOUNT_KEY]: map });
}

/**
 * 切换到指定账号：先回写当前账号最新 cookie，再写入目标账号 cookie，并更新活动账号
 */
export async function switchToAccount(siteId = "bilibili", accountId) {
  if (!accountId) throw new Error("缺少目标账号 id");
  const accounts = await getAccounts(siteId);
  const target = accounts[accountId];
  if (!target) throw new Error("未找到目标账号");

  await updateCurrentAccountCookies(siteId);
  await setSiteCookies(siteId, target.cookies);
  await setActiveAccountId(siteId, accountId);
}

/**
 * 为登录新账号做准备：回写当前 cookie 后清除本地 cookie，并清空活动账号记录
 */
export async function prepareForNewLogin(siteId = "bilibili") {
  await updateCurrentAccountCookies(siteId);
  await clearSiteCookies(siteId);
  await setActiveAccountId(siteId, null);
}

// 兼容旧函数名
export const getBilibiliCookies = () => getSiteCookies("bilibili");
export const setBilibiliCookies = cookies => setSiteCookies("bilibili", cookies);
export const clearBilibiliCookies = () => clearSiteCookies("bilibili");

async function getAccountsBySite() {
  const storage = await getStorage([ACCOUNTS_BY_SITE_KEY, LEGACY_BILIBILI_ACCOUNTS_KEY]);
  const accountsBySite = storage[ACCOUNTS_BY_SITE_KEY] || {};
  const legacyAccounts = storage[LEGACY_BILIBILI_ACCOUNTS_KEY];

  if (legacyAccounts && !accountsBySite.bilibili) {
    accountsBySite.bilibili = {};
    Object.values(legacyAccounts).forEach(account => {
      const normalizedAccount = normalizeAccount("bilibili", account);
      accountsBySite.bilibili[normalizedAccount.id] = normalizedAccount;
    });
    await persistAccountsBySite(accountsBySite);
    // 同步 sitesWithAccounts，避免升级用户在 B 站看不到悬浮球
    if (Object.keys(accountsBySite.bilibili).length > 0) {
      const sa = await getStorage([SITES_WITH_ACCOUNTS_KEY]);
      const saMap = sa[SITES_WITH_ACCOUNTS_KEY] || {};
      saMap.bilibili = true;
      await setStorage({ [SITES_WITH_ACCOUNTS_KEY]: saMap });
    }
  }

  return accountsBySite;
}

function getCookiesByDomain(domain) {
  return new Promise(resolve => {
    // 先取非分区 cookie（所有版本都支持）
    chrome.cookies.getAll({ domain }, unpartitioned => {
      if (chrome.runtime.lastError) {
        console.error("getAll cookies error:", chrome.runtime.lastError);
        resolve(unpartitioned || []);
        return;
      }
      // 再尝试取分区 cookie（CHIPS，Chrome 119+）；旧版本会触发 lastError，忽略即可。
      // 去重交给 getSiteCookies 的 Map 处理，重复无害。
      try {
        chrome.cookies.getAll({ domain, partitionKey: {} }, partitioned => {
          if (chrome.runtime.lastError) {
            resolve(unpartitioned || []);
            return;
          }
          resolve([...(unpartitioned || []), ...(partitioned || [])]);
        });
      } catch (e) {
        resolve(unpartitioned || []);
      }
    });
  });
}

function buildCookieSetDetails(cookie) {
  const details = {
    url: buildCookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
    expirationDate: cookie.expirationDate
  };

  if (!cookie.hostOnly && !cookie.name.startsWith("__Host-")) {
    details.domain = cookie.domain;
  }
  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }

  Object.keys(details).forEach(key => {
    if (details[key] === undefined) delete details[key];
  });

  return details;
}

function buildCookieUrl(cookie) {
  const protocol = cookie.secure ? "https://" : "http://";
  const host = cookie.domain.replace(/^\./, "");
  const path = cookie.path || "/";
  return `${protocol}${host}${path}`;
}

function createCookieOnlyAccount(siteId, cookies, label) {
  if (!cookies || cookies.length === 0) return null;

  const fingerprintSource = cookies
    .filter(cookie => /session|auth|token|cf_clearance/i.test(cookie.name))
    .map(cookie => `${cookie.domain}|${cookie.path}|${cookie.name}|${cookie.value}`)
    .sort()
    .join("\n") || cookies
    .map(cookie => `${cookie.domain}|${cookie.path}|${cookie.name}`)
    .sort()
    .join("\n");

  if (!fingerprintSource) return null;

  const fingerprint = hashString(fingerprintSource);
  return normalizeAccount(siteId, {
    id: `${siteId}:${fingerprint}`,
    displayName: `${label} ${fingerprint.slice(-6).toUpperCase()}`,
    subtitle: "Cookie 本地识别",
    avatar: ""
  });
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Storage 辅助函数
function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}
