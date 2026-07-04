import {
  deleteAccount,
  fetchUserInfo,
  getAccounts,
  getSiteByUrl,
  getSiteCookies,
  saveAccount,
  renameAccount,
  switchToAccount,
  prepareForNewLogin
} from "./utils.js";

// DOM 元素
const titleEl = document.getElementById("popupTitle");
const accountListEl = document.getElementById("accountList");
const addCurrentBtn = document.getElementById("addCurrentBtn");
const loginNewBtn = document.getElementById("loginNewBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusMsgEl = document.getElementById("statusMsg");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const globalFloatingToggle = document.getElementById("globalFloatingToggle");
const siteFloatingToggle = document.getElementById("siteFloatingToggle");

let currentSite = null;
let currentTab = null;
// 当前登录账号 id 缓存：打开 popup 时拉取一次，避免每次渲染都打用户信息接口
let cachedCurrentAccountId = null;

// 初始化
document.addEventListener("DOMContentLoaded", async () => {
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentSite = getSiteByUrl(currentTab?.url);

  applySiteState();
  await loadCurrentAccountId();
  await renderAccountList();
});

// 事件监听
addCurrentBtn.addEventListener("click", handleAddAccount);
loginNewBtn.addEventListener("click", handleLoginNew);
refreshBtn.addEventListener("click", async () => {
  await loadCurrentAccountId();
  await renderAccountList();
});

settingsBtn.addEventListener("click", openSettings);
settingsCloseBtn.addEventListener("click", closeSettings);
globalFloatingToggle.addEventListener("change", handleGlobalToggle);
siteFloatingToggle.addEventListener("change", handleSiteToggle);

function applySiteState() {
  if (!currentSite) {
    titleEl.textContent = "账号切换器";
    addCurrentBtn.disabled = true;
    loginNewBtn.disabled = true;
    showStatus("请在有效的网页上使用", "error");
    return;
  }

  titleEl.textContent = `${currentSite.shortName}账号切换器`;
  document.documentElement.style.setProperty("--accent-color", currentSite.accentColor);
  addCurrentBtn.disabled = false;
  loginNewBtn.disabled = false;
}

/**
 * 拉取当前登录账号 id 并缓存
 */
async function loadCurrentAccountId() {
  if (!currentSite) {
    cachedCurrentAccountId = null;
    return;
  }
  const currentUser = await fetchUserInfo(currentSite.id);
  cachedCurrentAccountId = currentUser ? currentUser.id : null;
}

/**
 * 渲染账号列表
 */
async function renderAccountList() {
  accountListEl.innerHTML = "";

  if (!currentSite) {
    accountListEl.innerHTML = '<div class="empty-tip">当前页面暂不支持</div>';
    return;
  }

  const accounts = await getAccounts(currentSite.id);
  const sortedAccounts = Object.values(accounts).sort((a, b) => b.timestamp - a.timestamp);

  const currentAccountId = cachedCurrentAccountId;

  if (sortedAccounts.length === 0) {
    accountListEl.innerHTML = `<div class="empty-tip">${currentSite.emptyTip}</div>`;
    return;
  }

  sortedAccounts.forEach(account => {
    const el = createAccountElement(account, currentAccountId);
    accountListEl.appendChild(el);
  });
}

/**
 * 创建账号 DOM 元素
 */
function createAccountElement(account, currentAccountId) {
  const div = document.createElement("div");
  div.className = `account-item ${account.id == currentAccountId ? "active" : ""}`;

  const avatar = createAvatarElement(account);
  const info = document.createElement("div");
  info.className = "info";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = account.displayName || account.uname || "未知账号";

  const uid = document.createElement("div");
  uid.className = "uid";
  uid.textContent = account.subtitle || `ID: ${account.id}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn";
  editBtn.title = "修改账号名称";
  editBtn.innerHTML = "✎";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.title = "删除账号";
  deleteBtn.textContent = "×";

  info.append(name, uid);
  actions.append(editBtn, deleteBtn);
  div.append(avatar, info, actions);

  // 切换账号事件
  div.addEventListener("click", async e => {
    // 如果是在编辑中或点击了按钮，不触发切换
    if (div.classList.contains("editing") || e.target.closest("button")) return;

    if (account.id == currentAccountId) {
      showStatus("当前已经是该账号");
      return;
    }

    await switchAccount(account);
  });

  // 编辑账号名称事件
  editBtn.addEventListener("click", e => {
    e.stopPropagation();
    
    if (div.classList.contains("editing")) return;
    div.classList.add("editing");
    
    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-name-input";
    input.value = account.displayName || account.uname || "未知账号";
    
    const originalName = name.textContent;
    name.replaceWith(input);
    input.focus();
    input.select();
    
    const finishEdit = async (save) => {
      div.classList.remove("editing");
      const val = input.value.trim();
      if (save && val && val !== originalName) {
        account.displayName = val;
        account.uname = val;
        await renameAccount(currentSite.id, account.id, val);
        name.textContent = val;
        
        // 同步更新字母头像
        const avatarEl = div.querySelector(".avatar-fallback");
        if (avatarEl) {
          avatarEl.textContent = val.trim().charAt(0).toUpperCase();
        }
      }
      input.replaceWith(name);
    };
    
    input.addEventListener("keydown", async evt => {
      if (evt.key === "Enter") {
        await finishEdit(true);
      } else if (evt.key === "Escape") {
        await finishEdit(false);
      }
    });
    
    input.addEventListener("blur", async () => {
      await finishEdit(true);
    });
  });

  // 删除账号事件
  deleteBtn.addEventListener("click", async e => {
    e.stopPropagation();
    if (confirm(`确定要删除账号 ${account.displayName || account.uname} 吗？`)) {
      await deleteAccount(currentSite.id, account.id);
      await renderAccountList();
      showStatus("账号已删除");
    }
  });

  return div;
}

function createAvatarElement(account) {
  const avatarUrl = account.avatar || account.face;
  // 仅放行 http(s) 协议，避免 data:/javascript: 等被注入到 <img src>
  if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.className = "avatar";
    img.alt = "avatar";
    return img;
  }

  const fallback = document.createElement("div");
  fallback.className = "avatar avatar-fallback";
  fallback.textContent = (account.displayName || account.uname || "?").trim().charAt(0).toUpperCase();
  return fallback;
}

/**
 * 处理添加当前账号
 */
async function handleAddAccount() {
  if (!currentSite) return;

  showStatus("正在获取用户信息...");
  const userInfo = await fetchUserInfo(currentSite.id);

  if (!userInfo) {
    showStatus(`获取用户信息失败，请确保已登录 ${currentSite.shortName}`, "error");
    return;
  }

  const cookies = await getSiteCookies(currentSite.id);
  if (!cookies || cookies.length === 0) {
    showStatus("未检测到 Cookies，请先登录", "error");
    return;
  }

  const accountData = {
    ...userInfo,
    cookies
  };

  await saveAccount(currentSite.id, accountData);
  await renderAccountList();
  showStatus("账号添加成功", "success");
}

/**
 * 切换账号
 */
async function switchAccount(account) {
  showStatus(`正在切换到 ${account.displayName || account.uname}...`);
  try {
    await switchToAccount(currentSite.id, account.id);
    cachedCurrentAccountId = account.id; // 切换后浏览器即为目标账号

    showStatus(`已切换到 ${account.displayName || account.uname}`, "success");
    // 刷新页面；popup 通常会随之关闭，故不再用延迟重渲染
    if (currentTab?.id) chrome.tabs.reload(currentTab.id);
  } catch (error) {
    console.error(error);
    showStatus(`切换失败：${error.message || ""}`, "error");
  }
}

/**
 * 处理登录新账号
 * 原理：清除本地 Cookie，使浏览器处于未登录状态，但不调用站点退出接口
 */
async function handleLoginNew() {
  if (!currentSite) return;

  if (confirm("确定要清除本地状态以登录新账号吗？\n（注意：这不会导致旧账号失效）")) {
    await prepareForNewLogin(currentSite.id);
    cachedCurrentAccountId = null; // 本地状态已清空

    if (currentTab?.id) chrome.tabs.reload(currentTab.id);
    await renderAccountList();
    showStatus("本地状态已清除，请在网页登录新账号", "success");
  }
}

/**
 * 显示状态信息
 */
function showStatus(msg, type = "info") {
  statusMsgEl.textContent = msg;
  statusMsgEl.className = "status-msg";
  if (type === "success") statusMsgEl.classList.add("status-success");
  if (type === "error") statusMsgEl.classList.add("status-error");

  // 3秒后清除
  setTimeout(() => {
    statusMsgEl.textContent = "";
    statusMsgEl.className = "status-msg";
  }, 3000);
}

// 设置控制
async function openSettings() {
  const settings = await chrome.storage.local.get(["globalDisableFloating", "hideFloatingSites"]);
  globalFloatingToggle.checked = !settings.globalDisableFloating;
  
  if (currentSite) {
    siteFloatingToggle.disabled = false;
    const hideSites = settings.hideFloatingSites || {};
    siteFloatingToggle.checked = !hideSites[currentSite.id];
  } else {
    siteFloatingToggle.disabled = true;
    siteFloatingToggle.checked = false;
  }
  
  settingsPanel.style.display = "flex";
  accountListEl.style.display = "none";
  document.querySelector("footer").style.display = "none";
}

function closeSettings() {
  settingsPanel.style.display = "none";
  accountListEl.style.display = "block";
  document.querySelector("footer").style.display = "flex";
}

async function handleGlobalToggle() {
  await chrome.storage.local.set({ globalDisableFloating: !globalFloatingToggle.checked });
}

async function handleSiteToggle() {
  if (!currentSite) return;
  const settings = await chrome.storage.local.get("hideFloatingSites");
  const hideSites = settings.hideFloatingSites || {};
  hideSites[currentSite.id] = !siteFloatingToggle.checked;
  await chrome.storage.local.set({ hideFloatingSites: hideSites });
}
