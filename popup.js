import {
  deleteAccount,
  fetchUserInfo,
  getAccounts,
  getSiteByUrl,
  getSiteCookies,
  saveAccount,
  renameAccount,
  switchToAccount,
  prepareForNewLogin,
  getActiveAccountId
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
// 防止并发切换 / 添加（popup 重开即重置）
let isBusy = false;

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

document.getElementById("exportBtn").addEventListener("click", exportAccounts);
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", importAccounts);

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
 * 拉取当前登录账号 id 并缓存。
 * 优先用站点用户信息接口（最准确）；接口失败/未登录时回退到本扩展记录的活动账号，
 * 这样在弱网下仍能正确高亮上次切换的账号。
 */
async function loadCurrentAccountId() {
  if (!currentSite) {
    cachedCurrentAccountId = null;
    return;
  }
  const currentUser = await fetchUserInfo(currentSite.id);
  if (currentUser) {
    cachedCurrentAccountId = currentUser.id;
    return;
  }
  // 回退：扩展记录的活动账号
  cachedCurrentAccountId = await getActiveAccountId(currentSite.id);
}

/**
 * 渲染账号列表
 */
async function renderAccountList() {
  accountListEl.innerHTML = "";

  if (!currentSite) {
    updateSiteBanner(null, 0);
    accountListEl.innerHTML = '<div class="empty-tip">当前页面暂不支持</div>';
    return;
  }

  const accounts = await getAccounts(currentSite.id);
  const sortedAccounts = Object.values(accounts).sort((a, b) => b.timestamp - a.timestamp);

  updateSiteBanner(currentSite, sortedAccounts.length);

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
 * 更新站点信息条（域名 + 账号数量）
 */
function updateSiteBanner(site, count) {
  const banner = document.getElementById("siteBanner");
  const hostEl = document.getElementById("siteHost");
  const countEl = document.getElementById("siteCount");
  if (!site) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "flex";
  hostEl.textContent = currentTab ? safeHostname(currentTab.url) : site.id;
  countEl.textContent = `${count} 个账号`;
  hostEl.title = hostEl.textContent;
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

/**
 * 切换/登录新账号后，刷新同站其他标签页，使多 tab 登录态一致。
 * @param {number} excludeTabId 当前 tab（已单独 reload，这里跳过）
 */
function reloadSameSiteTabs(excludeTabId) {
  if (!currentSite) return;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id === excludeTabId) continue;
      const site = getSiteByUrl(tab.url);
      if (site && site.id === currentSite.id) {
        chrome.tabs.reload(tab.id, () => void chrome.runtime.lastError);
      }
    }
  });
}

/**
 * 创建账号 DOM 元素
 */
function createAccountElement(account, currentAccountId) {
  const div = document.createElement("div");
  div.className = `account-item ${account.id == currentAccountId ? "active" : ""}`;
  div.dataset.accountId = account.id;

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
    input.maxLength = 40;

    const originalName = name.textContent;
    name.replaceWith(input);
    input.focus();
    input.select();

    // 防止 Enter 与 blur 重复触发 finishEdit（重复 rename）
    let finished = false;
    const finishEdit = async (save) => {
      if (finished) return;
      finished = true;
      div.classList.remove("editing");
      const val = input.value.trim();
      if (save && val && val !== originalName) {
        try {
          await renameAccount(currentSite.id, account.id, val);
          account.displayName = val;
          account.uname = val;
          name.textContent = val;
          // 同步更新字母兜底头像（若当前是字母头像）
          const fallbackEl = div.querySelector(".avatar-fallback");
          if (fallbackEl) {
            fallbackEl.textContent = val.trim().charAt(0).toUpperCase();
          }
        } catch (err) {
          showStatus("重命名失败：" + (err.message || ""), "error");
        }
      }
      input.replaceWith(name);
    };

    input.addEventListener("keydown", async evt => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        await finishEdit(true);
      } else if (evt.key === "Escape") {
        await finishEdit(false);
      }
    });

    input.addEventListener("blur", async () => {
      await finishEdit(true);
    });
  });

  // 删除账号事件（自定义二次确认）
  deleteBtn.addEventListener("click", async e => {
    e.stopPropagation();
    const nameStr = account.displayName || account.uname;
    if (await customConfirm(`确定删除账号「${nameStr}」吗？该操作不可撤销。`)) {
      await deleteAccount(currentSite.id, account.id);
      // 若删除的是当前高亮账号，清缓存以便正确取消高亮
      if (cachedCurrentAccountId === account.id) cachedCurrentAccountId = null;
      await renderAccountList();
      showStatus("账号已删除", "success");
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
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    // 加载失败 → 替换为字母兜底头像，避免裂图
    img.addEventListener("error", () => {
      const fb = document.createElement("div");
      fb.className = "avatar avatar-fallback";
      fb.textContent = (account.displayName || account.uname || "?").trim().charAt(0).toUpperCase();
      img.replaceWith(fb);
    });
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
  if (!currentSite || isBusy) return;
  isBusy = true;
  setFooterBusy(true);
  showStatus("正在获取用户信息...");
  try {
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

    // 重复添加提示：同 id 账号已存在时确认是否覆盖（刷新其 cookie）
    const existing = await getAccounts(currentSite.id);
    if (existing[userInfo.id]) {
      const ok = await customConfirm(`账号「${userInfo.displayName || userInfo.id}」已存在，是否更新其 Cookie？`);
      if (!ok) {
        showStatus("已取消");
        return;
      }
    }

    const accountData = {
      ...userInfo,
      cookies
    };

    await saveAccount(currentSite.id, accountData);
    cachedCurrentAccountId = userInfo.id; // 刚保存的即当前登录账号
    await renderAccountList();
    showStatus("账号添加成功", "success");
  } catch (err) {
    showStatus("添加失败：" + (err.message || ""), "error");
  } finally {
    isBusy = false;
    setFooterBusy(false);
  }
}

/**
 * 切换账号
 */
async function switchAccount(account) {
  if (isBusy) return;
  isBusy = true;
  setFooterBusy(true);
  showStatus(`正在切换到 ${account.displayName || account.uname}...`);
  try {
    await switchToAccount(currentSite.id, account.id);
    cachedCurrentAccountId = account.id; // 切换后浏览器即为目标账号

    // 标记当前活动项
    document.querySelectorAll(".account-item").forEach(el => el.classList.remove("active"));
    const targetEl = document.querySelector(`.account-item[data-account-id="${CSS.escape(account.id)}"]`);
    if (targetEl) targetEl.classList.add("active");

    showStatus(`已切换到 ${account.displayName || account.uname}，正在刷新页面…`, "success");
    // 刷新当前页，并同步刷新同站其他标签页，避免多 tab 仍是旧账号
    if (currentTab?.id) {
      chrome.tabs.reload(currentTab.id);
      reloadSameSiteTabs(currentTab.id);
    }
  } catch (error) {
    console.error(error);
    showStatus(`切换失败：${error.message || ""}`, "error");
  } finally {
    isBusy = false;
    setFooterBusy(false);
  }
}

/**
 * 处理登录新账号
 * 原理：清除本地 Cookie，使浏览器处于未登录状态，但不调用站点退出接口
 */
async function handleLoginNew() {
  if (!currentSite || isBusy) return;
  const ok = await customConfirm("确定要清除本地状态以登录新账号吗？\n（注意：这不会导致旧账号失效）");
  if (!ok) return;

  isBusy = true;
  setFooterBusy(true);
  try {
    await prepareForNewLogin(currentSite.id);
    cachedCurrentAccountId = null; // 本地状态已清空

    if (currentTab?.id) {
      chrome.tabs.reload(currentTab.id);
      reloadSameSiteTabs(currentTab.id);
    }
    await renderAccountList();
    showStatus("本地状态已清除，请在网页登录新账号", "success");
  } catch (err) {
    showStatus("操作失败：" + (err.message || ""), "error");
  } finally {
    isBusy = false;
    setFooterBusy(false);
  }
}

/**
 * 切换底部按钮的 busy 状态（防重复点击 + loading 视觉反馈）
 */
function setFooterBusy(busy) {
  addCurrentBtn.disabled = busy;
  loginNewBtn.disabled = busy;
  refreshBtn.disabled = busy;
}

/**
 * 自定义确认弹窗（替代原生 confirm，在受限环境更稳定，且与 popup 风格统一）
 * @returns {Promise<boolean>}
 */
function customConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg"></div>
        <div class="confirm-actions">
          <button class="secondary-btn" data-act="cancel">取消</button>
          <button class="primary-btn" data-act="ok">确定</button>
        </div>
      </div>
    `;
    overlay.querySelector(".confirm-msg").textContent = message;
    document.body.appendChild(overlay);

    const done = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('[data-act="ok"]').addEventListener("click", () => done(true));
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => done(false));
    overlay.addEventListener("click", e => {
      if (e.target === overlay) done(false);
    });
  });
}

/**
 * 显示状态信息
 */
function showStatus(msg, type = "info") {
  statusMsgEl.textContent = msg;
  statusMsgEl.className = "status-msg";
  if (type === "success") statusMsgEl.classList.add("status-success");
  if (type === "error") statusMsgEl.classList.add("status-error");

  // 错误信息停留更久（5s），让用户来得及看清原因；普通/成功 3s
  const duration = type === "error" ? 5000 : 3000;
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => {
    statusMsgEl.textContent = "";
    statusMsgEl.className = "status-msg";
  }, duration);
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

/**
 * 导出全部账号数据为 JSON 文件（用于备份/迁移）
 */
async function exportAccounts() {
  try {
    const data = await chrome.storage.local.get("accountsBySite");
    const payload = {
      app: "web-account-switcher",
      version: 1,
      exportedAt: new Date().toISOString(),
      accountsBySite: data.accountsBySite || {}
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `account-switcher-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus("已导出账号备份", "success");
  } catch (err) {
    showStatus("导出失败：" + (err.message || ""), "error");
  }
}

/**
 * 从 JSON 文件导入账号数据（合并：同 id 覆盖）
 */
async function importAccounts(e) {
  const file = e.target.files?.[0];
  e.target.value = ""; // 允许重复选择同一文件
  if (!file) return;

  const ok = await customConfirm(`确定从「${file.name}」导入账号吗？\n同名账号将被覆盖。`);
  if (!ok) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.app !== "web-account-switcher" || !parsed.accountsBySite) {
      showStatus("文件格式不正确", "error");
      return;
    }
    // 合并：读取现有数据，按 siteId / accountId 覆盖
    const existing = await chrome.storage.local.get("accountsBySite");
    const merged = existing.accountsBySite || {};
    for (const [siteId, accounts] of Object.entries(parsed.accountsBySite)) {
      merged[siteId] = { ...(merged[siteId] || {}), ...accounts };
    }
    merged.schemaVersion = 1;
    await chrome.storage.local.set({ accountsBySite: merged });

    // 重算 sitesWithAccounts
    const saMap = {};
    for (const siteId of Object.keys(merged)) {
      if (siteId === "schemaVersion") continue;
      if (merged[siteId] && Object.keys(merged[siteId]).length > 0) saMap[siteId] = true;
    }
    await chrome.storage.local.set({ sitesWithAccounts: saMap });

    await renderAccountList();
    showStatus("导入成功", "success");
  } catch (err) {
    showStatus("导入失败：" + (err.message || ""), "error");
  }
}
