import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getBaseDomain,
  generateColorFromString,
  normalizeAccount,
  getSiteByUrl,
  createDynamicSiteConfig,
  createCookieOnlyAccount
} from "../utils.js";

test("getBaseDomain 解析主域名", () => {
  assert.equal(getBaseDomain("www.bilibili.com"), "bilibili.com");
  assert.equal(getBaseDomain("bilibili.com"), "bilibili.com");
  assert.equal(getBaseDomain("api.bilibili.com"), "bilibili.com");
  assert.equal(getBaseDomain("www.example.com.cn"), "example.com.cn");
  assert.equal(getBaseDomain("sub.www.example.co.uk"), "example.co.uk");
  assert.equal(getBaseDomain("192.168.1.1"), "192.168.1.1");
  assert.equal(getBaseDomain("localhost"), "localhost");
  assert.equal(getBaseDomain(""), "");
  // 更多公共后缀
  assert.equal(getBaseDomain("a.b.example.gov.cn"), "example.gov.cn");
  assert.equal(getBaseDomain("shop.example.co.jp"), "example.co.jp");
});

test("generateColorFromString 返回稳定的 HSL 颜色", () => {
  const c = generateColorFromString("example.com");
  assert.match(c, /^hsl\(\d+, 70%, 40%\)$/);
  assert.equal(c, generateColorFromString("example.com"), "相同输入应得到相同输出");
  assert.notEqual(c, generateColorFromString("other.com"));
});

test("normalizeAccount 归一化账号字段", () => {
  const a = normalizeAccount("bilibili", { id: 123, displayName: "Alice" });
  assert.equal(a.id, "123", "id 应转为字符串");
  assert.equal(a.displayName, "Alice");
  assert.equal(a.siteId, "bilibili");

  const noId = normalizeAccount("bilibili", {});
  assert.equal(noId.id, "");
  assert.equal(noId.displayName, "未知账号");

  // 兼容 bilibili nav 接口返回的 raw 结构
  const nav = normalizeAccount("bilibili", { raw: { mid: 42, uname: "Bob" } });
  assert.equal(nav.id, "42");
  assert.equal(nav.displayName, "Bob");
});

test("normalizeAccount 处理 ChatGPT 风格字段", () => {
  const u = normalizeAccount("chatgpt", {
    id: "user-abc",
    name: "Alice",
    email: "a@b.com",
    image: "https://img/x.png"
  });
  assert.equal(u.id, "user-abc");
  assert.equal(u.displayName, "Alice");
  assert.equal(u.avatar, "https://img/x.png");
});

test("getSiteByUrl 识别站点", () => {
  assert.equal(getSiteByUrl("https://www.bilibili.com").id, "bilibili");
  assert.equal(getSiteByUrl("https://chatgpt.com/c/abc").id, "chatgpt");
  assert.equal(getSiteByUrl("https://chat.openai.com/").id, "chatgpt");
  assert.equal(getSiteByUrl("https://www.example.com/path").id, "example.com");
  assert.equal(getSiteByUrl("chrome://extensions/"), null, "非 http(s) 不支持");
  assert.equal(getSiteByUrl(null), null);
  assert.equal(getSiteByUrl(""), null);
  assert.equal(getSiteByUrl("ftp://x.com/"), null, "ftp 不支持");
});

test("createDynamicSiteConfig 生成可切换的站点配置", () => {
  const cfg = createDynamicSiteConfig("example.com", "shop.example.com");
  assert.equal(cfg.id, "example.com");
  assert.deepEqual(cfg.urlPatterns, ["example.com"]);
  assert.deepEqual(cfg.cookieDomains, ["example.com"]);
  assert.ok(cfg.accentColor.startsWith("hsl("));
});

test("getSiteByUrl 对未登录/无 cookie 站点也返回配置（不抛错）", () => {
  // 仅校验不抛错，fetchUserInfo 在无 cookie 时返回 null 由具体环境决定
  const site = getSiteByUrl("https://random.example.org");
  assert.ok(site, "任意 http(s) 站点都应生成配置");
  assert.equal(typeof site.fetchUserInfo, "function");
});

test("normalizeAccount subtitle 分支", () => {
  // 有 mid → UID: mid
  const withMid = normalizeAccount("bilibili", { id: "1", mid: 999 });
  assert.equal(withMid.subtitle, "UID: 999");
  // 有 email 无 mid → email
  const withEmail = normalizeAccount("chatgpt", { id: "x", email: "a@b.com" });
  assert.equal(withEmail.subtitle, "a@b.com");
  // 都没有 → ID: id
  const bare = normalizeAccount("x", { id: "abc" });
  assert.equal(bare.subtitle, "ID: abc");
  // 显式 subtitle 优先
  const explicit = normalizeAccount("x", { id: "1", subtitle: "自定义" });
  assert.equal(explicit.subtitle, "自定义");
});

test("动态站点 cookie 指纹稳定性（不随 token value 变化）", async () => {
  const site = createDynamicSiteConfig("example.com", "example.com");
  assert.deepEqual(site.cookieDomains, ["example.com"]);
});

test("createCookieOnlyAccount 指纹不含 value：同一账号 token 轮换后 id 不变", () => {
  const mkCookies = (sessionValue) => ([
    { domain: "example.com", path: "/", name: "session", value: sessionValue, secure: true, httpOnly: true },
    { domain: "example.com", path: "/", name: "other", value: "x" }
  ]);
  const a = createCookieOnlyAccount("example.com", mkCookies("token-v1"), "Example");
  const b = createCookieOnlyAccount("example.com", mkCookies("token-v2-rotated"), "Example");
  assert.ok(a && b, "有会话 cookie 时应生成账号");
  assert.equal(a.id, b.id, "value 轮换后 id 必须保持不变，否则会重复添加");
  assert.equal(a.displayName, b.displayName);
});

test("createCookieOnlyAccount 无 cookie 返回 null", () => {
  assert.equal(createCookieOnlyAccount("x", [], "L"), null);
  assert.equal(createCookieOnlyAccount("x", null, "L"), null);
});

test("createCookieOnlyAccount 无会话 cookie 时用全部 cookie 生成指纹", () => {
  const cookies = [
    { domain: "x.com", path: "/", name: "pref", value: "1" },
    { domain: "x.com", path: "/", name: "theme", value: "dark" }
  ];
  const acc = createCookieOnlyAccount("x.com", cookies, "X");
  assert.ok(acc);
  assert.ok(acc.id.startsWith("x.com:"));
});
