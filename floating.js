let currentSite = null;

// MV3 content script 无法 import ES module，这里内联一份最小站点识别逻辑，
// 仅用于初始化时判断「是否显示悬浮球」，避免每个页面都发消息唤醒 service worker。
// siteId 与 utils.js 的 getSiteByUrl 保持一致：predefined 用 SITES key，其余用 baseDomain。
const KNOWN_SITES = [
  { id: "bilibili", patterns: ["bilibili.com"], shortName: "B站", accentColor: "#00a1d6" },
  { id: "chatgpt", patterns: ["chatgpt.com", "chat.openai.com"], shortName: "ChatGPT", accentColor: "#10a37f" }
];

function getBaseDomain(hostname) {
  if (!hostname) return "";
  const parts = hostname.split('.');
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return hostname;
  const tldSuffixes = [
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'com.hk', 'org.hk', 'co.uk', 'org.uk', 'co.jp', 'ne.jp',
    'com.tw', 'org.tw', 'edu.tw', 'org.mo', 'com.mo'
  ];
  let baseDomainIndex = parts.length - 2;
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join('.');
    if (tldSuffixes.includes(lastTwo)) baseDomainIndex = parts.length - 3;
  }
  if (baseDomainIndex < 0) baseDomainIndex = 0;
  return parts.slice(baseDomainIndex).join('.');
}

function generateColorFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 40%)`;
}

function resolveSiteByHost(hostname) {
  for (const site of KNOWN_SITES) {
    if (site.patterns.some(p => hostname === p || hostname.endsWith("." + p))) {
      return { id: site.id, shortName: site.shortName, accentColor: site.accentColor };
    }
  }
  const base = getBaseDomain(hostname);
  if (!base) return null;
  return { id: base, shortName: base, accentColor: generateColorFromString(base) };
}

// 初始化：仅用本地主机名 + storage（UI 开关 / sitesWithAccounts）判断是否显示，
// 全程不发送消息、不唤醒 service worker；账号列表/用户信息等仅在用户打开面板时才拉取。
// 受限页面（chrome://、edge://、PDF、应用商店、about:blank 等）没有 document.body / 不允许注入，
// 整个初始化包进 try/catch，避免单页报错冒泡到控制台。
(function init() {
  try {
    // 部分受限页面 document.body 可能为 null，或无权访问
    if (!document.body || document.contentType === "application/pdf") return;
    const site = resolveSiteByHost(location.hostname);
    if (!site) return;
    currentSite = site;

    chrome.storage.local.get(
      ["hideFloatingSites", "globalDisableFloating", "floatPosition", "sitesWithAccounts"],
      (result) => {
        try {
          if (chrome.runtime.lastError) return;
          if (result.globalDisableFloating) return;
          if (result.hideFloatingSites && result.hideFloatingSites[currentSite.id]) return;

          const hasAccounts = !!(result.sitesWithAccounts && result.sitesWithAccounts[currentSite.id]);
          // 没有账号记录默认不显示，避免打扰
          if (!hasAccounts) return;

          initFloatingWidget(result.floatPosition);
        } catch (e) {
          console.warn("[账号切换] 悬浮球初始化失败:", e);
        }
      }
    );
  } catch (e) {
    // 静默：受限页面注入失败属于预期
  }
})();

let floatEl, iconEl, panelEl, listEl, closeBtn, addBtn, newBtn, reloadBtn, statusEl;
let isDragging = false;
let didDrag = false; // 本次 mousedown 后是否真的发生了拖动（超过阈值）
let isSwitching = false; // 防止并发切换
let startX, startY, initialRight, initialBottom;
const DRAG_THRESHOLD = 5; // 像素，小于该距离视为点击

// 悬浮球图标文字：站点首字母（大写），回退到「切」
function iconLabel() {
  const name = (currentSite?.shortName || "切").trim();
  return name.charAt(0).toUpperCase();
}

function initFloatingWidget(savedPosition) {
  const floatHTML = `
  <div class="bili-switcher-float" id="biliSwitcherFloat" style="--switcher-accent-color:${currentSite.accentColor}">
    <div class="bili-switcher-icon" id="biliSwitcherIcon" title="${escapeHtml(currentSite.shortName)}账号切换">
      ${escapeHtml(iconLabel())}
    </div>
    <div class="bili-switcher-panel" id="biliSwitcherPanel">
      <div class="bili-switcher-header">
        <span>${escapeHtml(currentSite.shortName + "账号切换")}</span>
        <span class="bili-switcher-close" id="biliSwitcherClose" title="关闭">×</span>
      </div>
      <div class="bili-switcher-list" id="biliSwitcherList">
        <!-- 账号列表 -->
      </div>
      <div class="bili-switcher-status" id="biliSwitcherStatus"></div>
      <div class="bili-switcher-footer">
        <button class="bili-switcher-btn bili-switcher-btn-primary" id="biliSwitcherAdd">添加当前</button>
        <button class="bili-switcher-btn bili-switcher-btn-secondary" id="biliSwitcherNew">登录新号</button>
        <button class="bili-switcher-btn bili-switcher-btn-icon" id="biliSwitcherReload" title="刷新当前页">↻</button>
        <button class="bili-switcher-btn bili-switcher-btn-icon" id="biliSwitcherHide" title="在本站隐藏悬浮球">👁</button>
      </div>
    </div>
  </div>
  `;

  const container = document.createElement("div");
  container.innerHTML = floatHTML;
  document.body.appendChild(container);

  // 获取 DOM
  floatEl = document.getElementById("biliSwitcherFloat");
  iconEl = document.getElementById("biliSwitcherIcon");
  panelEl = document.getElementById("biliSwitcherPanel");
  listEl = document.getElementById("biliSwitcherList");
  closeBtn = document.getElementById("biliSwitcherClose");
  addBtn = document.getElementById("biliSwitcherAdd");
  newBtn = document.getElementById("biliSwitcherNew");
  reloadBtn = document.getElementById("biliSwitcherReload");
  statusEl = document.getElementById("biliSwitcherStatus");
  const hideBtn = document.getElementById("biliSwitcherHide");

  // 恢复上次拖拽位置（限制在视口内）
  if (savedPosition) {
    applyPosition(savedPosition);
  }

  // 事件监听
  iconEl.addEventListener("click", togglePanel);
  closeBtn.addEventListener("click", () => hidePanel());
  addBtn.addEventListener("click", handleAddAccount);
  newBtn.addEventListener("click", handleLoginNew);
  reloadBtn.addEventListener("click", () => location.reload());
  hideBtn.addEventListener("click", hideFloatingOnThisSite);

  // 点击面板外部关闭（仅面板打开时生效）
  document.addEventListener("click", handleOutsideClick, true);

  // 拖拽逻辑
  iconEl.addEventListener("mousedown", startDrag);
  document.addEventListener("mousemove", drag);
  document.addEventListener("mouseup", stopDrag);

  // 窗口尺寸变化时，把悬浮球拉回视口
  window.addEventListener("resize", () => {
    if (!floatEl) return;
    const style = window.getComputedStyle(floatEl);
    applyPosition({
      right: parseInt(style.right) || 0,
      bottom: parseInt(style.bottom) || 0
    });
  });

  // 接收来自 background 的快捷键命令（Alt+Shift+S）
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "TOGGLE_FLOATING") {
      // 若悬浮球被隐藏（display:none），则强制显示；否则切换面板
      if (floatEl.style.display === "none") {
        floatEl.style.display = "";
        togglePanel();
      } else if (panelEl.classList.contains("show")) {
        hidePanel();
      } else {
        togglePanel();
      }
    }
    return false;
  });
}

function handleOutsideClick(e) {
  if (!panelEl || !panelEl.classList.contains("show")) return;
  // 点击落在悬浮球或面板内则不处理
  if (floatEl.contains(e.target)) return;
  // 若有确认弹窗正在等待，先让用户处理它，不关闭面板
  if (floatEl.querySelector(".bili-switcher-confirm")) return;
  hidePanel();
}

function hidePanel() {
  if (panelEl) panelEl.classList.remove("show");
}

function applyPosition(pos) {
  const size = 48;
  const maxRight = Math.max(0, window.innerWidth - size);
  const maxBottom = Math.max(0, window.innerHeight - size);
  const right = Math.min(Math.max(0, pos.right || 0), maxRight);
  const bottom = Math.min(Math.max(0, pos.bottom || 0), maxBottom);
  floatEl.style.right = `${right}px`;
  floatEl.style.bottom = `${bottom}px`;
}

function startDrag(e) {
  if (e.target !== iconEl) return;
  isDragging = true;
  didDrag = false;

  startX = e.clientX;
  startY = e.clientY;

  const style = window.getComputedStyle(floatEl);
  initialRight = parseInt(style.right) || 0;
  initialBottom = parseInt(style.bottom) || 0;

  iconEl.style.cursor = "grabbing";
}

function drag(e) {
  if (!isDragging) return;

  const dx = startX - e.clientX;
  const dy = startY - e.clientY;

  // 未超过阈值时不进入拖动，避免误判点击
  if (!didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  didDrag = true;

  e.preventDefault();
  floatEl.style.right = `${initialRight + dx}px`;
  floatEl.style.bottom = `${initialBottom + dy}px`;
}

function stopDrag() {
  if (!isDragging) return;
  isDragging = false;
  iconEl.style.cursor = "pointer";

  // 真正拖动过才持久化位置
  if (didDrag) {
    const style = window.getComputedStyle(floatEl);
    chrome.storage.local.set({
      floatPosition: {
        right: parseInt(style.right) || 0,
        bottom: parseInt(style.bottom) || 0
      }
    });
  }
}

async function togglePanel() {
  // 若刚结束一次拖动，吞掉本次 click，不切换面板
  if (didDrag) {
    didDrag = false;
    return;
  }

  const isShow = panelEl.classList.contains("show");
  if (isShow) {
    hidePanel();
  } else {
    panelEl.classList.add("show");
    // 打开后再渲染，避免渲染期间面板迟迟不出现的视觉延迟
    renderList();
  }
}

// 与 Background 通信的辅助函数
// 注意：context invalidated（扩展更新/重载）时 callback 仍会触发且 lastError 非空，
// 必须显式处理，否则 Promise 永不 resolve，导致整个面板交互卡死。
function sendMessage(type, payload = {}) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type, siteId: currentSite.id, ...payload }, response => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message || "扩展连接已断开，请刷新页面" });
          return;
        }
        resolve(response);
      });
    } catch (e) {
      // 扩展上下文失效时 sendMessage 会直接抛异常
      resolve({ success: false, error: "扩展已重新加载，请刷新页面后重试" });
    }
  });
}

// 渲染列表
async function renderList() {
  // 先给个 loading 占位，避免面板空白看起来卡死
  listEl.innerHTML = '<div class="bili-switcher-empty">加载中…</div>';

  // 两个请求互不依赖，并行拉取以减少面板等待时间
  const [accountsRes, currentUserRes] = await Promise.all([
    sendMessage("GET_ACCOUNTS"),
    sendMessage("GET_USER_INFO")
  ]);
  const accounts = accountsRes?.data;
  const currentUser = currentUserRes?.data;

  listEl.innerHTML = "";

  if (!accounts || Object.keys(accounts).length === 0) {
    listEl.innerHTML = '<div class="bili-switcher-empty">暂无账号，点「添加当前」</div>';
    return;
  }

  const sortedAccounts = Object.values(accounts).sort((a, b) => b.timestamp - a.timestamp);
  const currentAccountId = currentUser ? currentUser.id : null;

  sortedAccounts.forEach(account => {
    const item = document.createElement("div");
    item.className = `bili-switcher-item ${account.id == currentAccountId ? "active" : ""}`;
    
    const avatarHTML = renderAvatar(account);
    const infoHTML = `
      <div class="bili-switcher-info">
        <div class="bili-switcher-name">${escapeHtml(account.displayName || account.uname || "未知账号")}</div>
        <div class="bili-switcher-uid">${escapeHtml(account.subtitle || `ID: ${account.id}`)}</div>
      </div>
    `;
    const actionsHTML = `
      <div class="bili-switcher-actions">
        <button class="bili-switcher-edit-btn" title="修改账号名称">✎</button>
        <button class="bili-switcher-delete-btn" title="删除账号">×</button>
      </div>
    `;

    item.innerHTML = avatarHTML + infoHTML + actionsHTML;

    const nameEl = item.querySelector(".bili-switcher-name");
    const editBtn = item.querySelector(".bili-switcher-edit-btn");
    const deleteBtn = item.querySelector(".bili-switcher-delete-btn");
    
    // 切换账号事件
    item.addEventListener("click", (e) => {
      if (item.classList.contains("editing") || e.target.closest("button")) return;
      switchAccount(account, currentAccountId);
    });
    
    // 编辑事件
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      if (item.classList.contains("editing")) return;
      item.classList.add("editing");

      const input = document.createElement("input");
      input.type = "text";
      input.className = "bili-switcher-edit-input";
      input.value = account.displayName || account.uname || "未知账号";

      const originalName = nameEl.textContent;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      // 防止 Enter 触发 finishEdit 后，紧接着 blur 又触发一次（重复 rename）
      let finished = false;
      const finishEdit = async (save) => {
        if (finished) return;
        finished = true;
        item.classList.remove("editing");
        const val = input.value.trim();
        if (save && val && val !== originalName) {
          account.displayName = val;
          account.uname = val;
          const res = await sendMessage("RENAME_ACCOUNT", { accountId: account.id, newName: val });
          if (res && res.success) {
            nameEl.textContent = val;

            // 同步字母头像（仅当当前是字母兜底头像时才更新）
            const avatarFallbackEl = item.querySelector(".bili-switcher-avatar-fallback");
            if (avatarFallbackEl) {
              avatarFallbackEl.textContent = val.trim().charAt(0).toUpperCase();
            }
          } else {
            showStatus("重命名失败：" + (res?.error || "未知错误"), "error");
          }
        }
        input.replaceWith(nameEl);
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

    // 删除账号事件（自定义二次确认，避免原生 confirm 在部分环境被禁/不一致）
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = account.displayName || account.uname;
      if (await confirmInPanel(`确定删除账号「${name}」吗？该操作不可撤销。`)) {
        const res = await sendMessage("DELETE_ACCOUNT", { accountId: account.id });
        if (res && res.success) {
          showStatus("账号已删除", "success");
          await renderList();
        } else {
          showStatus("删除失败：" + (res?.error || "未知错误"), "error");
        }
      }
    });

    listEl.appendChild(item);
  });

  // 头像加载失败 → 换成字母兜底，避免裂图
  listEl.querySelectorAll("img.bili-switcher-avatar").forEach(img => {
    img.addEventListener("error", () => {
      const fb = document.createElement("div");
      fb.className = "bili-switcher-avatar bili-switcher-avatar-fallback";
      fb.textContent = img.getAttribute("data-fallback") || "?";
      img.replaceWith(fb);
    });
  });
}

function renderAvatar(account) {
  const avatarUrl = account.avatar || account.face;
  const fallbackLetter = escapeHtml((account.displayName || account.uname || "?").trim().charAt(0).toUpperCase());
  // 仅放行 http(s) 协议，避免 data:/javascript: 等被注入到 <img src>
  if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
    // onerror 兜底字母存在 data-fallback，由 renderList 统一绑定 onerror 处理，避免内联引号转义问题
    return `<img src="${escapeHtml(avatarUrl)}" class="bili-switcher-avatar" alt="avatar" referrerpolicy="no-referrer" loading="lazy" data-fallback="${fallbackLetter}">`;
  }

  return `<div class="bili-switcher-avatar bili-switcher-avatar-fallback">${fallbackLetter}</div>`;
}

// 切换账号
async function switchAccount(account, currentAccountId) {
  if (account.id == currentAccountId) return;
  // 防止并发切换：切换过程中（写 cookie → reload）禁止再次触发
  if (isSwitching) return;
  isSwitching = true;

  showStatus(`正在切换到 ${account.displayName || account.uname}...`);
  // 仅传 accountId，cookie 由 background 自行从 storage 取，不经过页面上下文
  const res = await sendMessage("SWITCH_ACCOUNT", { accountId: account.id });
  if (res && res.success) {
    location.reload();
  } else {
    isSwitching = false;
    showStatus("切换失败：" + (res?.error || "未知错误"), "error");
  }
}

/**
 * 在当前站点隐藏悬浮球（写入 hideFloatingSites，与 popup 设置共用同一开关）
 */
async function hideFloatingOnThisSite() {
  if (await confirmInPanel(`在「${currentSite.shortName}」隐藏悬浮球？\n可在扩展弹窗的设置中重新开启。`)) {
    try {
      const result = await chrome.storage.local.get("hideFloatingSites");
      const hideSites = result.hideFloatingSites || {};
      hideSites[currentSite.id] = true;
      await chrome.storage.local.set({ hideFloatingSites: hideSites });
      // 直接移除悬浮球，无需刷新
      if (floatEl) floatEl.remove();
    } catch (e) {
      showStatus("操作失败", "error");
    }
  }
}

// 添加当前账号
async function handleAddAccount() {
  if (isSwitching) return; // 复用切换锁，防止添加期间重复点击
  isSwitching = true;
  addBtn.disabled = true;
  showStatus("正在添加当前账号…");
  try {
    const response = await sendMessage("ADD_ACCOUNT");
    if (response && response.success) {
      showStatus("账号添加成功", "success");
      await renderList();
    } else {
      showStatus("添加失败：" + (response?.error || "未登录或网络错误"), "error");
    }
  } finally {
    isSwitching = false;
    addBtn.disabled = false;
  }
}

// 面板内状态提示（替代 alert）
function showStatus(msg, type = "info") {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = "bili-switcher-status" +
    (type === "success" ? " success" : type === "error" ? " error" : "");
  clearTimeout(showStatus._t);
  // 错误信息停留更久（4s），其余 2.5s
  const duration = type === "error" ? 4000 : 2500;
  showStatus._t = setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "bili-switcher-status";
  }, duration);
}

// 登录新账号
async function handleLoginNew() {
  if (await confirmInPanel("确定清除本地状态以登录新账号吗？（不会导致旧账号失效）")) {
    showStatus("正在清除本地状态…");
    const res = await sendMessage("LOGIN_NEW");
    if (res && res.success) {
      location.reload();
    } else {
      showStatus("操作失败：" + (res?.error || "未知错误"), "error");
    }
  }
}

/**
 * 面板内自定义确认弹窗（替代原生 confirm）。
 * 在受限 CSP 或 confirm 被禁用环境也能稳定工作，且与面板风格统一。
 * @returns {Promise<boolean>}
 */
function confirmInPanel(message) {
  return new Promise(resolve => {
    if (!floatEl) return resolve(false);
    // 若已有确认框，先移除
    const existing = floatEl.querySelector(".bili-switcher-confirm");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "bili-switcher-confirm";
    overlay.innerHTML = `
      <div class="bili-switcher-confirm-box">
        <div class="bili-switcher-confirm-msg">${escapeHtml(message)}</div>
        <div class="bili-switcher-confirm-actions">
          <button class="bili-switcher-btn bili-switcher-btn-secondary" data-act="cancel">取消</button>
          <button class="bili-switcher-btn bili-switcher-btn-primary" data-act="ok">确定</button>
        </div>
      </div>
    `;
    floatEl.appendChild(overlay);

    const done = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('[data-act="ok"]').addEventListener("click", () => done(true));
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => done(false));
    // 点遮罩空白处 = 取消
    overlay.addEventListener("click", e => {
      if (e.target === overlay) done(false);
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
