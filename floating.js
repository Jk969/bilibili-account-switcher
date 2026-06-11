let currentSite = null;

function getBaseDomain(hostname) {
  if (!hostname) return "";
  const parts = hostname.split('.');
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

// 初始化检查
chrome.runtime.sendMessage({ type: "GET_CURRENT_SITE_CONFIG" }, (response) => {
  if (!response || !response.success || !response.data) {
    return;
  }
  
  currentSite = response.data;
  
  // 检查是否显示悬浮窗
  chrome.storage.local.get(["accountsBySite", "hideFloatingSites", "globalDisableFloating"], (result) => {
    if (result.globalDisableFloating) return;
    
    // 如果设置中隐藏了该站点，不显示
    if (result.hideFloatingSites && result.hideFloatingSites[currentSite.id]) return;

    const accounts = result.accountsBySite?.[currentSite.id] || {};
    const hasAccounts = Object.keys(accounts).length > 0;

    // 如果该站点没有账号记录，默认不显示悬浮球，避免打扰
    if (!hasAccounts) return;

    initFloatingWidget();
  });
});

let floatEl, iconEl, panelEl, listEl, closeBtn, addBtn, newBtn;
let isDragging = false;
let startX, startY, initialRight, initialBottom;

function initFloatingWidget() {
  const floatHTML = `
  <div class="bili-switcher-float" id="biliSwitcherFloat" style="--switcher-accent-color:${currentSite.accentColor}">
    <div class="bili-switcher-icon" id="biliSwitcherIcon" title="切换账号">
      切
    </div>
    <div class="bili-switcher-panel" id="biliSwitcherPanel">
      <div class="bili-switcher-header">
        <span>${currentSite.shortName}账号切换</span>
        <span class="bili-switcher-close" id="biliSwitcherClose">×</span>
      </div>
      <div class="bili-switcher-list" id="biliSwitcherList">
        <!-- 账号列表 -->
      </div>
      <div class="bili-switcher-footer">
        <button class="bili-switcher-btn bili-switcher-btn-primary" id="biliSwitcherAdd">添加当前</button>
        <button class="bili-switcher-btn bili-switcher-btn-secondary" id="biliSwitcherNew">登录新号</button>
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

  // 事件监听
  iconEl.addEventListener("click", togglePanel);
  closeBtn.addEventListener("click", togglePanel);
  addBtn.addEventListener("click", handleAddAccount);
  newBtn.addEventListener("click", handleLoginNew);

  // 拖拽逻辑
  iconEl.addEventListener("mousedown", startDrag);
  document.addEventListener("mousemove", drag);
  document.addEventListener("mouseup", stopDrag);
}

function startDrag(e) {
  if (e.target !== iconEl) return;
  isDragging = true;

  startX = e.clientX;
  startY = e.clientY;

  const style = window.getComputedStyle(floatEl);
  initialRight = parseInt(style.right);
  initialBottom = parseInt(style.bottom);

  iconEl.style.cursor = "grabbing";
}

function drag(e) {
  if (!isDragging) return;
  e.preventDefault();

  const dx = startX - e.clientX;
  const dy = startY - e.clientY;

  floatEl.style.right = `${initialRight + dx}px`;
  floatEl.style.bottom = `${initialBottom + dy}px`;
}

function stopDrag() {
  isDragging = false;
  iconEl.style.cursor = "pointer";
}

async function togglePanel() {
  if (isDragging) return;

  const isShow = panelEl.classList.contains("show");
  if (isShow) {
    panelEl.classList.remove("show");
  } else {
    await renderList();
    panelEl.classList.add("show");
  }
}

// 与 Background 通信的辅助函数
function sendMessage(type, payload = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, siteId: currentSite.id, ...payload }, response => {
      resolve(response);
    });
  });
}

// 渲染列表
async function renderList() {
  const { data: accounts } = await sendMessage("GET_ACCOUNTS");
  const { data: currentUser } = await sendMessage("GET_USER_INFO");

  listEl.innerHTML = "";

  if (!accounts || Object.keys(accounts).length === 0) {
    listEl.innerHTML = '<div class="bili-switcher-empty">暂无账号</div>';
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
      </div>
    `;
    
    item.innerHTML = avatarHTML + infoHTML + actionsHTML;
    
    const nameEl = item.querySelector(".bili-switcher-name");
    const editBtn = item.querySelector(".bili-switcher-edit-btn");
    
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
      
      const finishEdit = async (save) => {
        item.classList.remove("editing");
        const val = input.value.trim();
        if (save && val && val !== originalName) {
          account.displayName = val;
          account.uname = val;
          await sendMessage("RENAME_ACCOUNT", { accountId: account.id, newName: val });
          nameEl.textContent = val;
          
          // 同步字母头像
          const avatarFallbackEl = item.querySelector(".bili-switcher-avatar-fallback");
          if (avatarFallbackEl) {
            avatarFallbackEl.textContent = val.trim().charAt(0).toUpperCase();
          }
        }
        input.replaceWith(nameEl);
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
    
    listEl.appendChild(item);
  });
}

function renderAvatar(account) {
  const avatarUrl = account.avatar || account.face;
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" class="bili-switcher-avatar" alt="avatar">`;
  }

  const name = account.displayName || account.uname || "?";
  return `<div class="bili-switcher-avatar bili-switcher-avatar-fallback">${escapeHtml(name.trim().charAt(0).toUpperCase())}</div>`;
}

// 切换账号
async function switchAccount(account, currentAccountId) {
  if (account.id == currentAccountId) return;

  if (confirm(`确定切换到 ${account.displayName || account.uname} 吗？`)) {
    await sendMessage("SWITCH_ACCOUNT", { account });
    location.reload();
  }
}

// 添加当前账号
async function handleAddAccount() {
  const response = await sendMessage("ADD_ACCOUNT");
  if (response.success) {
    alert("账号添加成功！");
    renderList();
  } else {
    alert("添加失败：" + (response.error || "未登录或网络错误"));
  }
}

// 登录新账号
async function handleLoginNew() {
  if (confirm("确定要清除本地状态以登录新账号吗？\n（不会导致旧账号失效）")) {
    await sendMessage("LOGIN_NEW");
    location.reload();
  }
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
