import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getBaseDomain,
  generateColorFromString,
  normalizeAccount,
  getSiteByUrl
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

test("getSiteByUrl 识别站点", () => {
  assert.equal(getSiteByUrl("https://www.bilibili.com").id, "bilibili");
  assert.equal(getSiteByUrl("https://chatgpt.com/c/abc").id, "chatgpt");
  assert.equal(getSiteByUrl("https://chat.openai.com/").id, "chatgpt");
  assert.equal(getSiteByUrl("https://www.example.com/path").id, "example.com");
  assert.equal(getSiteByUrl("chrome://extensions/"), null, "非 http(s) 不支持");
  assert.equal(getSiteByUrl(null), null);
});
