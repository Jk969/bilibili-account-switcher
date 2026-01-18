// 注入悬浮窗 HTML
const floatHTML = `
<div class="bili-switcher-float" id="biliSwitcherFloat">
  <div class="bili-switcher-icon" id="biliSwitcherIcon" title="切换账号">
    切
  </div>
  <div class="bili-switcher-panel" id="biliSwitcherPanel">
    <div class="bili-switcher-header">
      <span>账号切换</span>
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

// 初始化 UI
const container = document.createElement('div');
container.innerHTML = floatHTML;
document.body.appendChild(container);

// DOM 元素
const floatEl = document.getElementById('biliSwitcherFloat');
const iconEl = document.getElementById('biliSwitcherIcon');
const panelEl = document.getElementById('biliSwitcherPanel');
const listEl = document.getElementById('biliSwitcherList');
const closeBtn = document.getElementById('biliSwitcherClose');
const addBtn = document.getElementById('biliSwitcherAdd');
const newBtn = document.getElementById('biliSwitcherNew');

// 状态
let isDragging = false;
let startX, startY, initialRight, initialBottom;

// 事件监听
iconEl.addEventListener('click', togglePanel);
closeBtn.addEventListener('click', togglePanel);
addBtn.addEventListener('click', handleAddAccount);
newBtn.addEventListener('click', handleLoginNew);

// 拖拽逻辑 (简单实现，支持拖拽悬浮球)
iconEl.addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', drag);
document.addEventListener('mouseup', stopDrag);

function startDrag(e) {
  if (e.target !== iconEl) return;
  isDragging = true;
  const rect = floatEl.getBoundingClientRect();
  
  // 记录初始位置
  startX = e.clientX;
  startY = e.clientY;
  
  // 计算 right 和 bottom 的初始值
  const style = window.getComputedStyle(floatEl);
  initialRight = parseInt(style.right);
  initialBottom = parseInt(style.bottom);
  
  // 防止点击事件触发
  iconEl.style.cursor = 'grabbing';
}

function drag(e) {
  if (!isDragging) return;
  e.preventDefault();
  
  const dx = startX - e.clientX; // 向左移动 dx 为正 -> right 增加
  const dy = startY - e.clientY; // 向上移动 dy 为正 -> bottom 增加
  
  floatEl.style.right = `${initialRight + dx}px`;
  floatEl.style.bottom = `${initialBottom + dy}px`;
}

function stopDrag() {
  isDragging = false;
  iconEl.style.cursor = 'pointer';
}

// 切换面板显示
async function togglePanel() {
  if (isDragging) return; // 如果刚才在拖拽，则不触发展开
  
  const isShow = panelEl.classList.contains('show');
  if (isShow) {
    panelEl.classList.remove('show');
  } else {
    await renderList();
    panelEl.classList.add('show');
  }
}

// 与 Background 通信的辅助函数
function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      resolve(response);
    });
  });
}

// 渲染列表
async function renderList() {
  const { data: accounts } = await sendMessage('GET_ACCOUNTS');
  const { data: currentUser } = await sendMessage('GET_USER_INFO');
  
  listEl.innerHTML = '';
  
  if (!accounts || Object.keys(accounts).length === 0) {
    listEl.innerHTML = '<div style="padding:10px;text-align:center;color:#999;font-size:12px;">暂无账号</div>';
    return;
  }
  
  const sortedAccounts = Object.values(accounts).sort((a, b) => b.timestamp - a.timestamp);
  const currentMid = currentUser ? currentUser.mid : null;
  
  sortedAccounts.forEach(account => {
    const item = document.createElement('div');
    item.className = `bili-switcher-item ${account.mid == currentMid ? 'active' : ''}`;
    item.innerHTML = `
      <img src="${account.face}" class="bili-switcher-avatar">
      <div class="bili-switcher-info">
        <div class="bili-switcher-name">${account.uname}</div>
        <div class="bili-switcher-uid">UID: ${account.mid}</div>
      </div>
    `;
    
    item.addEventListener('click', () => switchAccount(account, currentMid));
    listEl.appendChild(item);
  });
}

// 切换账号
async function switchAccount(account, currentMid) {
  if (account.mid == currentMid) return;
  
  if (confirm(`确定切换到 ${account.uname} 吗？`)) {
    await sendMessage('SWITCH_ACCOUNT', { account });
    location.reload();
  }
}

// 添加当前账号
async function handleAddAccount() {
  const response = await sendMessage('ADD_ACCOUNT');
  if (response.success) {
    alert('账号添加成功！');
    renderList();
  } else {
    alert('添加失败：' + (response.error || '未登录或网络错误'));
  }
}

// 登录新账号
async function handleLoginNew() {
  if (confirm('确定要清除本地状态以登录新账号吗？\n（不会导致旧账号失效）')) {
    await sendMessage('LOGIN_NEW');
    location.reload();
  }
}
