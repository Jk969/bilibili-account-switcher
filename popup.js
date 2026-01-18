import {
  getBilibiliCookies,
  setBilibiliCookies,
  clearBilibiliCookies,
  fetchUserInfo,
  saveAccount,
  getAccounts,
  deleteAccount
} from './utils.js';

// DOM 元素
const accountListEl = document.getElementById('accountList');
const addCurrentBtn = document.getElementById('addCurrentBtn');
const loginNewBtn = document.getElementById('loginNewBtn');
const refreshBtn = document.getElementById('refreshBtn');
const statusMsgEl = document.getElementById('statusMsg');

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await renderAccountList();
  
  // 检查当前 tab 是否是 B 站
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes('bilibili.com')) {
    addCurrentBtn.disabled = false;
    loginNewBtn.disabled = false;
  } else {
    addCurrentBtn.disabled = true;
    loginNewBtn.disabled = true;
    showStatus('请在 Bilibili 页面使用', 'error');
  }
});

// 事件监听
addCurrentBtn.addEventListener('click', handleAddAccount);
loginNewBtn.addEventListener('click', handleLoginNew);
refreshBtn.addEventListener('click', renderAccountList);

/**
 * 渲染账号列表
 */
async function renderAccountList() {
  const accounts = await getAccounts();
  const sortedAccounts = Object.values(accounts).sort((a, b) => b.timestamp - a.timestamp);
  
  // 获取当前正在使用的 mid (简单判断，通过 API 获取当前用户信息对比)
  let currentMid = null;
  const currentUser = await fetchUserInfo();
  if (currentUser) {
    currentMid = currentUser.mid;
  }

  accountListEl.innerHTML = '';

  if (sortedAccounts.length === 0) {
    accountListEl.innerHTML = '<div class="empty-tip">暂无账号，请登录B站后添加</div>';
    return;
  }

  sortedAccounts.forEach(account => {
    const el = createAccountElement(account, currentMid);
    accountListEl.appendChild(el);
  });
}

/**
 * 创建账号 DOM 元素
 */
function createAccountElement(account, currentMid) {
  const div = document.createElement('div');
  div.className = `account-item ${account.mid == currentMid ? 'active' : ''}`;
  
  div.innerHTML = `
    <img src="${account.face}" class="avatar" alt="avatar">
    <div class="info">
      <div class="name">${account.uname}</div>
      <div class="uid">UID: ${account.mid}</div>
    </div>
    <div class="actions">
      <button class="delete-btn" title="删除账号">×</button>
    </div>
  `;

  // 切换账号事件
  div.addEventListener('click', async (e) => {
    // 如果点击的是删除按钮，不触发切换
    if (e.target.classList.contains('delete-btn')) return;
    
    // 如果点击的是当前账号，不触发切换
    if (account.mid == currentMid) {
      showStatus('当前已经是该账号');
      return;
    }

    await switchAccount(account);
  });

  // 删除账号事件
  const deleteBtn = div.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`确定要删除账号 ${account.uname} 吗？`)) {
      await deleteAccount(account.mid);
      await renderAccountList();
      showStatus('账号已删除');
    }
  });

  return div;
}

/**
 * 处理添加当前账号
 */
async function handleAddAccount() {
  showStatus('正在获取用户信息...');
  const userInfo = await fetchUserInfo();
  
  if (!userInfo) {
    showStatus('获取用户信息失败，请确保已登录 B 站', 'error');
    return;
  }

  const cookies = await getBilibiliCookies();
  if (!cookies || cookies.length === 0) {
    showStatus('未检测到 Cookies，请先登录', 'error');
    return;
  }

  const accountData = {
    ...userInfo,
    cookies: cookies
  };

  await saveAccount(accountData);
  await renderAccountList();
  showStatus('账号添加成功', 'success');
}

/**
 * 切换账号
 */
async function switchAccount(account) {
  showStatus(`正在切换到 ${account.uname}...`);
  try {
    await setBilibiliCookies(account.cookies);
    
    // 刷新当前页面
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.includes('bilibili.com')) {
      chrome.tabs.reload(tab.id);
    }
    
    // 重新渲染列表（稍作延迟等待页面刷新/cookie生效）
    setTimeout(() => {
      renderAccountList();
      showStatus(`已切换到 ${account.uname}`, 'success');
    }, 1000);
    
  } catch (error) {
    console.error(error);
    showStatus('切换失败', 'error');
  }
}

/**
 * 处理登录新账号
 * 原理：清除本地 Cookie，使浏览器处于未登录状态，但不调用 B 站退出接口
 */
async function handleLoginNew() {
  if (confirm('确定要清除本地状态以登录新账号吗？\n（注意：这不会导致旧账号失效）')) {
    await clearBilibiliCookies();
    
    // 刷新页面
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.includes('bilibili.com')) {
      chrome.tabs.reload(tab.id);
    }
    
    await renderAccountList();
    showStatus('本地状态已清除，请在网页登录新账号', 'success');
  }
}

/**
 * 显示状态信息
 */
function showStatus(msg, type = 'info') {
  statusMsgEl.textContent = msg;
  statusMsgEl.className = 'status-msg';
  if (type === 'success') statusMsgEl.classList.add('status-success');
  if (type === 'error') statusMsgEl.classList.add('status-error');
  
  // 3秒后清除
  setTimeout(() => {
    statusMsgEl.textContent = '';
    statusMsgEl.className = 'status-msg';
  }, 3000);
}
