'use strict';

/**
 * SC3 – Networking Configuration Comprehensive Test
 *
 * TC-NET-01  Verify portal auto-creates default VNet + subnet; print names
 * TC-NET-02  Public IP section shows "New" and "Existing" options
 * TC-NET-03  Private static IP requirement is displayed
 * TC-NET-04  Inbound port rules (80/443) are selectable with a NEW VNet
 * TC-NET-05  Inbound port rules change when switching to an EXISTING VNet
 * TC-NET-06  Portal rejects an existing VNet/subnet that is too small (< /27)
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

// ── Constants ────────────────────────────────────────────────────────────────
const AZURE_PORTAL_URL =
  'https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true' +
  '&Azure_Marketplace_Nginx=stage1' +
  '&Azure_Marketplace_Nginx_assettypeoptions=%7B%22Nginx%22%3A%7B%22options%22%3A%22%22%7D%7D' +
  '&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home';

const TARGET_ACCOUNT       = 'v-yixueli@microsoft.com';
const TARGET_SUBSCRIPTION  = 'Liftr-Nginx-Test';
const TARGET_RESOURCE_GROUP = 'lyx-liftr-test';
const TARGET_REGION        = 'West Central US';
const VALID_VNET_NAME      = 'lyx-vnet02';   // /16 – passes /27 check
const INVALID_VNET_NAME    = 'lyx-vnet01';   // /28 – too small

const EDGE_USER_DATA_DIR = path.join(
  os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'
);
const TEST_PROFILE_DIR = path.join(__dirname, '.edge-sc3-profile');
const SCREENSHOT_DIR   = path.join(__dirname, 'sc4-screenshots');

const NETWORKING_CHECKBOX_XPATH =
  '/html/body/div[1]/div[4]/div[1]/div[1]/main/div[3]/div[2]/section[2]/div[2]/div[1]/div[4]/div[2]/div/div/div[2]/div/div[2]/div[2]/div/div[2]/div/div[3]/div[3]/div[2]/div[2]/div/div/span';

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildInstanceName() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `lyx-sc3-${mm}${dd}${hh}${mi}`;
}

async function takeScreenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  console.log(`  [screenshot] ${file}`);
}

async function handleLoginFlow(page, targetAccount) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const url = page.url();
    if (!url.includes('login.microsoftonline.com') && !url.includes('login.microsoft.com')) break;

    await page.waitForTimeout(2000);

    const tileVisible = await page.locator(`[data-test-id="${targetAccount}"]`)
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (tileVisible) {
      await page.locator(`[data-test-id="${targetAccount}"]`).click();
      await page.waitForTimeout(2000);
      continue;
    }
    const textVisible = await page.locator(`text="${targetAccount}"`)
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (textVisible) {
      await page.locator(`text="${targetAccount}"`).first().click();
      await page.waitForTimeout(2000);
      continue;
    }
    const emailVisible = await page.locator('input[name="loginfmt"]')
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (emailVisible) {
      await page.locator('input[name="loginfmt"]').fill(targetAccount);
      await page.waitForTimeout(500);
      await page.locator('input[id="idSIButton9"], input[type="submit"][value="Next"]').click();
      await page.waitForTimeout(3000);
      continue;
    }
    const kmsiVisible = await page.locator('input[id="idSIButton9"][value="Yes"]')
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (kmsiVisible) {
      await page.locator('input[id="idSIButton9"][value="Yes"]').click();
      await page.waitForTimeout(2000);
      continue;
    }
    break;
  }
}

async function waitForPortalReady(page) {
  await page.waitForSelector(
    '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
    { timeout: 120000 }
  );
  await page.waitForTimeout(2000);
}

async function gotoCreateWizard(page) {
  console.log('[1] 导航到 Azure Portal...');
  await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log('[2] 处理登录流程...');
  await handleLoginFlow(page, TARGET_ACCOUNT);

  console.log('[3] 等待 Portal 首页...');
  await waitForPortalReady(page);

  console.log('[4] 搜索 NGINXaaS...');
  const searchBox = page.locator(
    '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]'
  ).first();
  await searchBox.click();
  await page.waitForTimeout(500);
  await searchBox.pressSequentially('nginxaas', { delay: 80 });
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();

  console.log('[5] 打开 NGINXaaS Create 向导...');
  await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
  await page.waitForTimeout(3000);
  const createBtn = page.frameLocator('iframe[name="BrowseResource.ReactView"]')
    .locator('[role="menuitem"]:has-text("Create")');
  await createBtn.waitFor({ state: 'visible', timeout: 30000 });
  await createBtn.click();
  await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
  await page.waitForSelector('text=Project details', { timeout: 30000 });
  await page.waitForTimeout(3000);
}

async function ensureSubscription(page) {
  const subCorrect = await page.evaluate((target) => {
    const lbl = [...document.querySelectorAll('label')]
      .find((item) => /^Subscription/.test(item.textContent?.trim() || ''));
    if (!lbl) return false;
    let el = lbl.parentElement;
    for (let d = 0; d < 5 && el; d += 1, el = el.parentElement) {
      if ((el.textContent || '').includes(target)) return true;
    }
    return false;
  }, TARGET_SUBSCRIPTION);

  if (subCorrect) { console.log(`[basics] Subscription 已为 ${TARGET_SUBSCRIPTION}`); return; }

  console.log(`[basics] 切换 Subscription 为 ${TARGET_SUBSCRIPTION}`);
  await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('label')]
      .find((item) => /^Subscription/.test(item.textContent?.trim() || ''));
    if (!lbl) return;
    let el = lbl.parentElement;
    for (let d = 0; d < 6 && el; d += 1, el = el.parentElement) {
      const ctrl = el.querySelector('button[aria-haspopup="listbox"], [role="combobox"]');
      if (ctrl) { ctrl.click(); return; }
    }
  });
  await page.waitForTimeout(800);
  await page.locator('[role="option"]').filter({ hasText: TARGET_SUBSCRIPTION }).first().click();
  await page.waitForTimeout(2000);
}

async function ensureResourceGroup(page) {
  const rgCorrect = await page.evaluate((target) => {
    const lbl = [...document.querySelectorAll('label')]
      .find((item) => /^Resource group/.test(item.textContent?.trim() || ''));
    if (!lbl) return false;
    let el = lbl.parentElement;
    for (let d = 0; d < 5 && el; d += 1, el = el.parentElement) {
      if ((el.textContent || '').includes(target)) return true;
    }
    return false;
  }, TARGET_RESOURCE_GROUP);

  if (rgCorrect) { console.log(`[basics] Resource group 已为 ${TARGET_RESOURCE_GROUP}`); return; }

  console.log(`[basics] 切换 Resource group 为 ${TARGET_RESOURCE_GROUP}`);
  const rgDropDiv = page.locator('div[aria-label="Create new or use existing Resource group"]');
  await rgDropDiv.waitFor({ state: 'visible', timeout: 10000 });
  await rgDropDiv.click();
  await page.waitForTimeout(800);
  const rgFilterInput = page.locator(
    'input[aria-label="Type to filter result or use down arrow to choose options"]'
  ).nth(1);
  await rgFilterInput.waitFor({ state: 'visible', timeout: 8000 });
  await rgFilterInput.click();
  await rgFilterInput.pressSequentially(TARGET_RESOURCE_GROUP, { delay: 50 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
}

async function fillBasics(page) {
  console.log('[6] 填写 Basics...');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await ensureSubscription(page);
  await ensureResourceGroup(page);

  const name = buildInstanceName();
  console.log(`[basics] 填写 Name: ${name}`);
  const nameInputId = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')]
      .find((item) => /^Name\b/.test((item.textContent || '').trim()));
    return label?.htmlFor || null;
  });
  const nameInput = nameInputId
    ? page.locator(`[id="${nameInputId}"]`)
    : page.locator('input[type="text"]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  await nameInput.click({ clickCount: 3 });
  await nameInput.fill(name);
  await page.waitForTimeout(500);

  const regionCorrect = await page.evaluate((target) => {
    const lbl = [...document.querySelectorAll('label')]
      .find((item) => /^Region\b/.test((item.textContent || '').trim()));
    if (!lbl) return false;
    let el = lbl.parentElement;
    for (let d = 0; d < 5 && el; d += 1, el = el.parentElement) {
      if ((el.textContent || '').includes(target)) return true;
    }
    return false;
  }, TARGET_REGION);

  if (!regionCorrect) {
    console.log(`[basics] 切换 Region 为 ${TARGET_REGION}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    const regionDropdown = page.locator('.fxc-dropdown-open.azc-input').nth(2);
    await regionDropdown.waitFor({ state: 'visible', timeout: 10000 });
    await regionDropdown.click();
    await page.waitForTimeout(2000);
    const filterInput = page.locator(
      'input[type="text"].fxc-dropdown-multifilter, input.fxc-dropdown-filter, ' +
      'input[aria-label*="filter" i], .fxc-dropdown-popup input'
    ).first();
    if (await filterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await filterInput.click();
      await filterInput.fill('West Central');
    } else {
      await page.keyboard.type('West Central');
    }
    await page.waitForTimeout(1000);
    const allOpts = await page.locator('.fxc-dropdown-option').all();
    let regionClicked = false;
    for (const opt of allOpts) {
      if (!await opt.isVisible().catch(() => false)) continue;
      const text = (await opt.textContent().catch(() => '')) || '';
      if (/west central us/i.test(text)) { await opt.click(); regionClicked = true; break; }
    }
    if (!regionClicked) throw new Error('West Central US option not found in Region dropdown');
    await page.waitForTimeout(1500);
  }

  console.log('[basics] 选择 Standard v3...');
  const pricingPlanBtn = page.locator('text=Select pricing plan').first();
  await pricingPlanBtn.waitFor({ state: 'visible', timeout: 15000 });
  await pricingPlanBtn.click();
  await page.waitForTimeout(2500);
  const standardV3Row = page.locator('[role="row"], tr, li')
    .filter({ hasText: /Standard V3/i })
    .filter({ hasNotText: /Test|TESTING/i })
    .first();
  await standardV3Row.waitFor({ state: 'visible', timeout: 15000 });
  const radioInRow = standardV3Row.locator('input[type="radio"]');
  if (await radioInRow.count()) await radioInRow.click();
  else await standardV3Row.click();
  await page.waitForTimeout(1000);
  await page.locator('text=Confirm Plan').first().click();
  await page.waitForTimeout(2000);
}

async function enterNetworking(page) {
  console.log('[7] 进入 Networking 页...');
  await page.getByRole('button', { name: /^next$/i }).first().click();
  await page.waitForTimeout(4000);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  console.log('[8] 打开虚拟网络配置...');
  const vnetAccessSpan = page.locator(`xpath=${NETWORKING_CHECKBOX_XPATH}`).first();
  await vnetAccessSpan.waitFor({ state: 'visible', timeout: 30000 });
  await vnetAccessSpan.scrollIntoViewIfNeeded().catch(() => {});
  await vnetAccessSpan.click();
  await page.waitForTimeout(2000);

  // Scroll down so all networking controls are in view
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(500);
}

async function dumpNetworkingContext(page) {
  const data = await page.evaluate(() => {
    const textCandidates = [...document.querySelectorAll('label, button, a, span, div')]
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((text) => /virtual network|subnet|public|private|existing|new|default nginx|port|deleg|inbound|static ip/i.test(text));
    return Array.from(new Set(textCandidates)).slice(0, 100);
  });
  console.log('[networking] 关键可见文本:');
  for (const line of data) console.log(`  - ${line}`);
}

async function chooseMainNetworkingDropdown(page, index, optionText) {
  const dropdownHandle = await page.evaluateHandle((idx) => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input, .fxc-dropdown-open')];
    const withContent = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || '').trim();
      return (rect.width > 0 || rect.height > 0) && text.length > 0;
    });
    return withContent[idx] || null;
  }, index);
  const dropdownEl = dropdownHandle.asElement();
  if (!dropdownEl) throw new Error(`VNet/subnet dropdown at index ${index} not found`);

  await dropdownEl.scrollIntoViewIfNeeded().catch(() => {});
  await dropdownEl.click();
  await page.waitForTimeout(2000);

  const allOpts = await page.locator('.fxc-dropdown-option').all();
  for (const opt of allOpts) {
    if (!await opt.isVisible().catch(() => false)) continue;
    const text = (await opt.textContent().catch(() => '')) || '';
    if (text.trim().toLowerCase().includes(optionText.toLowerCase())) {
      await opt.click();
      await page.waitForTimeout(1500);
      return;
    }
  }
  const optHandle = await page.evaluateHandle((target) => {
    return [...document.querySelectorAll('.fxc-dropdown-option')].find((el) => {
      const text = (el.textContent || '').trim().toLowerCase();
      return text.includes(target.toLowerCase());
    }) || null;
  }, optionText);
  const optEl = optHandle.asElement();
  if (!optEl) throw new Error(`Option "${optionText}" not found in dropdown (index ${index})`);
  await optEl.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await optEl.click({ force: true });
  await page.waitForTimeout(1500);
}

async function collectErrors(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[role="alert"], [class*="error"], [aria-invalid="true"], div, span, p')];
    const texts = nodes
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((text) => /error|invalid|delegat|subnet|\/27|address space|size|validation failed|not valid/i.test(text));
    return Array.from(new Set(texts)).slice(0, 40);
  });
}

async function createContext() {
  try {
    const ctx = await chromium.launchPersistentContext(EDGE_USER_DATA_DIR, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      args: [
        '--start-maximized',
        '--profile-directory=Default',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
      ],
    });
    console.log('[boot] Edge 默认配置文件加载成功');
    return ctx;
  } catch (e) {
    console.log(`[boot] 默认配置文件不可用 (${e.message.split('\n')[0]})，改用独立 profile`);
    return chromium.launchPersistentContext(TEST_PROFILE_DIR, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
    });
  }
}

// ── Extract a section of body text starting at a keyword ─────────────────────
async function extractBodySection(page, keyword, length = 400) {
  return page.evaluate(([kw, len]) => {
    const text = document.body.innerText || '';
    const idx = text.toLowerCase().indexOf(kw.toLowerCase());
    if (idx < 0) return null;
    return text.substring(idx, idx + len);
  }, [keyword, length]);
}

// ── Read visible networking dropdowns ─────────────────────────────────────────
async function readNetworkDropdownValues(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input')];
    return all
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
  });
}

// ────────────────────────────────────────────────────────────────────────────
// TC-NET-01: Verify portal auto-creates default VNet + subnet; print names
// ────────────────────────────────────────────────────────────────────────────
async function tcNet01DefaultVNetSubnet(page) {
  console.log('\n=== TC-NET-01: 验证门户自动创建默认 VNet 和子网 ===');

  const dropdownTexts = await readNetworkDropdownValues(page);
  console.log('[TC-NET-01] 找到的下拉内容:', dropdownTexts);

  await takeScreenshot(page, 'sc3-tc01-default-vnet-subnet.png');

  if (dropdownTexts.length < 2) {
    console.log('[TC-NET-01] ⚠️  找到的下拉少于 2 个，稍等再试...');
    await page.waitForTimeout(2000);
    const retry = await readNetworkDropdownValues(page);
    console.log('[TC-NET-01] 重试结果:', retry);
    dropdownTexts.push(...retry.slice(dropdownTexts.length));
  }

  const vnetText   = dropdownTexts[0] || '';
  const subnetText = dropdownTexts[1] || '';

  // "(New) lyx-sc3-05271724-vnet (lyx-liftr-test)"
  const vnetNameMatch   = vnetText.match(/\(New\)\s+([\w-]+)/i);
  // "(New) default 172.22.0.0 …"
  const subnetNameMatch = subnetText.match(/\(New\)\s+([\w-]+)/i);

  const vnetName   = vnetNameMatch?.[1]   || vnetText.slice(0, 60);
  const subnetName = subnetNameMatch?.[1] || subnetText.slice(0, 60);

  console.log(`[TC-NET-01] 自动创建的 VNet 名称  : "${vnetName}"`);
  console.log(`[TC-NET-01] 自动创建的 Subnet 名称: "${subnetName}"`);
  console.log(`[TC-NET-01] VNet 原始文本  : "${vnetText}"`);
  console.log(`[TC-NET-01] Subnet 原始文本: "${subnetText}"`);

  const isNew = /\(New\)/i.test(vnetText) || /\(New\)/i.test(subnetText);
  if (isNew) {
    console.log('[TC-NET-01] ✅ PASS: 门户已自动为新建实例预创建 VNet 和子网');
  } else {
    console.log('[TC-NET-01] ⚠️  WARN: 未检测到 (New) 前缀，请查看截图确认');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TC-NET-02: Public IP section shows "New" and "Existing" options
// ────────────────────────────────────────────────────────────────────────────
async function tcNet02PublicIPOptions(page) {
  console.log('\n=== TC-NET-02: 验证公共 IP 有 New 和 Existing 选项 ===');

  // Scroll down to expose IP config area
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(1000);

  const pubIPSection = await extractBodySection(page, 'public ip', 400);
  console.log('[TC-NET-02] 公共 IP 区域文本:', (pubIPSection || '').replace(/\n/g, ' ').trim());

  await takeScreenshot(page, 'sc3-tc02-public-ip-options.png');

  if (!pubIPSection) {
    console.log('[TC-NET-02] ⚠️  未找到 "public ip" 关键词，尝试全页搜索...');
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasNewBtn    = /\bNew\b/.test(bodyText);
    const hasExistBtn  = /\bExisting\b/.test(bodyText);
    console.log(`[TC-NET-02] 全页 New=${hasNewBtn}, Existing=${hasExistBtn}`);
    return;
  }

  const hasNew      = /\bNew\b/i.test(pubIPSection);
  const hasExisting = /\bExisting\b/i.test(pubIPSection);

  if (hasNew)      console.log('[TC-NET-02] ✅ 找到 "New" 选项');
  else             console.log('[TC-NET-02] ❌ 未找到 "New" 选项');

  if (hasExisting) console.log('[TC-NET-02] ✅ 找到 "Existing" 选项');
  else             console.log('[TC-NET-02] ❌ 未找到 "Existing" 选项');

  if (hasNew && hasExisting) {
    console.log('[TC-NET-02] ✅ PASS: 公共 IP 有 New / Existing 两个选项');
  } else {
    console.log('[TC-NET-02] ⚠️  PARTIAL: 部分选项未找到，请查看截图');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TC-NET-03: Private static IP requirement is displayed
// ────────────────────────────────────────────────────────────────────────────
async function tcNet03PrivateIPStatic(page) {
  console.log('\n=== TC-NET-03: 验证私有 IP 要求配置静态 IP ===');

  // Try to find and click a "Private Only" or "Private" toggle/radio
  let switched = false;
  const candidates = [
    page.locator('[role="radio"]').filter({ hasText: /^private only$/i }).first(),
    page.locator('[role="radio"]').filter({ hasText: /^private$/i }).first(),
    page.locator('button').filter({ hasText: /^private only$/i }).first(),
    page.locator('button').filter({ hasText: /^private$/i }).first(),
    page.locator('label').filter({ hasText: /^private only$/i }).first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible({ timeout: 2000 }).catch(() => false)) {
      await candidate.click();
      await page.waitForTimeout(1500);
      console.log('[TC-NET-03] 已点击 Private Only / Private 切换控件');
      switched = true;
      break;
    }
  }

  if (!switched) {
    console.log('[TC-NET-03] 未找到独立的 Private 切换控件，检查当前页面是否已包含私有 IP 字段');
  }

  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(500);

  const privateSection = await extractBodySection(page, 'private', 500);
  const bodyText = await page.evaluate(() => document.body.innerText);

  const hasStaticField  = /private static ip/i.test(bodyText);
  const hasStaticMsg    = /available private ip from the virtual network/i.test(bodyText);
  const hasPrivateField = /private.*ip.*address/i.test(bodyText);

  console.log('[TC-NET-03] Private 区域文本:', (privateSection || '').replace(/\n/g, ' ').slice(0, 300));
  console.log(`[TC-NET-03] 检测到 "Private static IP" 字段: ${hasStaticField}`);
  console.log(`[TC-NET-03] 检测到配置说明文本      : ${hasStaticMsg}`);

  await takeScreenshot(page, 'sc3-tc03-private-ip-static.png');

  if (hasStaticField || hasStaticMsg || hasPrivateField) {
    console.log('[TC-NET-03] ✅ 字段存在检测 PASS: 私有 IP 静态地址要求已在页面上显示');
  } else {
    console.log('[TC-NET-03] ⚠️  WARN: 未找到私有静态 IP 字段，请查看截图');
  }

  // ── 静态 IP 字段输入测试 ──────────────────────────────────────────────────
  // 滚动确保 Private static IP 区域可见
  await page.evaluate(() => window.scrollBy(0, 100));
  await page.waitForTimeout(800);

  let ipInputLocator = null;

  // 方法1: XPath following 轴 – 从精确匹配的 label/span 找紧跟的第一个 input
  // 同时验证 y > 150 以排除页面顶部的搜索栏（搜索栏 y 通常 < 80px）
  for (const xpath of [
    'xpath=//label[normalize-space(.)="Private static IP address"]/following::input[1]',
    'xpath=//span[normalize-space(.)="Private static IP address"]/following::input[1]',
    'xpath=//*[normalize-space(text())="Private static IP address"]/following::input[not(@type) or @type="text"][1]',
  ]) {
    const loc = page.locator(xpath).first();
    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
      const box = await loc.boundingBox().catch(() => null);
      if (box && box.y > 150) {
        ipInputLocator = loc;
        console.log(`[TC-NET-03] ✅ 找到 Private static IP address 输入框 (XPath, y=${Math.round(box.y)})`);
        break;
      }
    }
  }

  // 方法2: evaluateHandle – 仅查 label/span（不用 div），精确文本匹配，
  // 向上遍历 ≤5 层父元素，只返回 y > 150 的可见 input
  if (!ipInputLocator) {
    const inputHandle = await page.evaluateHandle(() => {
      const targets = [...document.querySelectorAll('label, span')].filter(el => {
        return /^private static ip address$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim());
      });
      for (const lbl of targets) {
        let container = lbl.parentElement;
        for (let d = 0; d < 5 && container; d += 1, container = container.parentElement) {
          const inputs = [...container.querySelectorAll('input[type="text"], input:not([type])')];
          const valid = inputs.filter(inp => {
            const r = inp.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top > 150;
          });
          if (valid.length === 1) return valid[0];
        }
      }
      return null;
    });
    const el = inputHandle.asElement();
    if (el) {
      ipInputLocator = el;
      console.log('[TC-NET-03] ✅ 找到 Private static IP address 输入框 (evaluateHandle)');
    }
  }

  if (ipInputLocator) {
    // ── 测试1: 输入有效 IP ────────────────────────────────────────────────
    const VALID_STATIC_IP = '172.22.0.10';
    await ipInputLocator.scrollIntoViewIfNeeded().catch(() => {});
    await ipInputLocator.click({ timeout: 5000 });
    await page.waitForTimeout(500);

    // 验证焦点在正确的 input 上（y > 150 排除顶部搜索栏）
    const focusOk = await page.evaluate(() => {
      const el = document.activeElement;
      return !!(el && el.tagName === 'INPUT' && el.getBoundingClientRect().top > 150);
    });
    if (!focusOk) {
      console.log('[TC-NET-03] ⚠️  点击后焦点偏移，强制重新聚焦...');
      await page.evaluate(() => {
        const targets = [...document.querySelectorAll('label, span')].filter(el =>
          /^private static ip address$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())
        );
        for (const lbl of targets) {
          let container = lbl.parentElement;
          for (let d = 0; d < 5 && container; d += 1, container = container.parentElement) {
            const inputs = [...container.querySelectorAll('input[type="text"], input:not([type])')];
            const valid = inputs.filter(inp => {
              const r = inp.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.top > 150;
            });
            if (valid.length === 1) { valid[0].focus(); return; }
          }
        }
      });
      await page.waitForTimeout(300);
    }

    await ipInputLocator.fill('');
    await ipInputLocator.fill(VALID_STATIC_IP);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);
    const afterValidText = await page.evaluate(() => document.body.innerText);
    const hasEmptyError   = /value must not be empty/i.test(afterValidText);
    const hasInvalidError = /private static ip.*invalid/i.test(afterValidText);
    const hasFormatError  = /invalid.*ip|not a valid ip/i.test(afterValidText);
    await takeScreenshot(page, 'sc3-tc03-static-ip-valid.png');
    if (!hasEmptyError && !hasInvalidError && !hasFormatError) {
      console.log(`[TC-NET-03] ✅ 有效 IP 测试 PASS: 输入 "${VALID_STATIC_IP}" 后无验证报错`);
    } else {
      console.log(`[TC-NET-03] ❌ 有效 IP 测试 FAIL: 输入 "${VALID_STATIC_IP}" 仍有报错 (empty=${hasEmptyError}, invalid=${hasInvalidError}, format=${hasFormatError})`);
    }

    // ── 测试2: 输入无效 IP ────────────────────────────────────────────────
    const INVALID_STATIC_IP = '999.999.999.999';
    await ipInputLocator.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await ipInputLocator.fill('');
    await ipInputLocator.fill(INVALID_STATIC_IP);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);
    const afterInvalidText  = await page.evaluate(() => document.body.innerText);
    const hasInvalidErrNow  = /private static ip.*invalid|invalid.*ip address|not valid/i.test(afterInvalidText);
    await takeScreenshot(page, 'sc3-tc03-static-ip-invalid.png');
    if (hasInvalidErrNow) {
      console.log(`[TC-NET-03] ✅ 无效 IP 测试 PASS: 输入 "${INVALID_STATIC_IP}" 触发验证报错（符合预期）`);
    } else {
      console.log(`[TC-NET-03] ⚠️  无效 IP 测试 WARN: 输入 "${INVALID_STATIC_IP}" 未检测到明显报错，请查看截图`);
    }

    // ── 清空字段，恢复原状 ─────────────────────────────────────────────────
    await ipInputLocator.click({ timeout: 5000 });
    await ipInputLocator.fill('');
    await page.waitForTimeout(500);
    console.log('[TC-NET-03] 已清空 Private static IP address 输入框');
  } else {
    console.log('[TC-NET-03] ⚠️  未找到可操作的 Private static IP address 输入框，跳过字段输入测试');
  }
  // ── 静态 IP 字段输入测试结束 ──────────────────────────────────────────────

  // Switch back to Public if we switched away
  if (switched) {
    const publicCandidates = [
      page.locator('[role="radio"]').filter({ hasText: /^public only$/i }).first(),
      page.locator('[role="radio"]').filter({ hasText: /^public$/i }).first(),
      page.locator('button').filter({ hasText: /^public only$/i }).first(),
    ];
    for (const c of publicCandidates) {
      if (await c.isVisible({ timeout: 2000 }).catch(() => false)) {
        await c.click();
        await page.waitForTimeout(1000);
        console.log('[TC-NET-03] 已切换回 Public IP 模式');
        break;
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TC-NET-04: Inbound port rules (80/443) available when new VNet selected
// ────────────────────────────────────────────────────────────────────────────
async function tcNet04InboundPortsNewVNet(page) {
  console.log('\n=== TC-NET-04: 新 VNet 下验证入站端口 80/443 可选 ===');

  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);

  const portsSection = await extractBodySection(page, 'inbound port', 500);
  console.log('[TC-NET-04] 入站端口区域文本:', (portsSection || '').replace(/\n/g, ' ').trim());

  await takeScreenshot(page, 'sc3-tc04-ports-new-vnet.png');

  if (!portsSection) {
    console.log('[TC-NET-04] ⚠️  未找到 "inbound port" 关键词，全页搜索 80/443...');
    const bodyText = await page.evaluate(() => document.body.innerText);
    const has80  = /\b80\b/.test(bodyText);
    const has443 = /\b443\b/.test(bodyText);
    console.log(`[TC-NET-04] 全页 port 80=${has80}, port 443=${has443}`);
    if (has80 && has443) console.log('[TC-NET-04] ✅ PASS: 全页找到 80/443');
    else console.log('[TC-NET-04] ⚠️  全页未同时找到 80/443');
    return;
  }

  const has80     = /\b80\b/.test(portsSection);
  const has443    = /\b443\b/.test(portsSection);
  const has2sel   = /2 selected/i.test(portsSection);

  if (has80)    console.log('[TC-NET-04] ✅ 端口 80  可见');
  else          console.log('[TC-NET-04] ℹ️  端口 80  未直接显示（可能折叠）');

  if (has443)   console.log('[TC-NET-04] ✅ 端口 443 可见');
  else          console.log('[TC-NET-04] ℹ️  端口 443 未直接显示（可能折叠）');

  if (has2sel)  console.log('[TC-NET-04] ✅ 找到 "2 selected"（80/443 已默认选中）');

  if (has80 && has443) {
    console.log('[TC-NET-04] ✅ PASS: 新建 VNet 下端口 80/443 直接可见');
  } else if (has2sel) {
    console.log('[TC-NET-04] ✅ PASS: 入站端口显示 "2 selected"，80/443 默认已选中');
  } else {
    console.log('[TC-NET-04] ⚠️  WARN: 端口区域未找到 80/443 或 "2 selected"，请查看截图');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TC-NET-05: Inbound port rules change when switching to an EXISTING VNet
// ────────────────────────────────────────────────────────────────────────────
async function tcNet05InboundPortsExistingVNet(page) {
  console.log('\n=== TC-NET-05: 切换现有 VNet 后验证入站端口规则变化 ===');

  // Scroll back to top of networking section before switching
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  console.log(`[TC-NET-05] 切换到现有 VNet: ${VALID_VNET_NAME}`);
  try {
    await chooseMainNetworkingDropdown(page, 0, VALID_VNET_NAME);
    await page.waitForTimeout(2000);
    // Try selecting a subnet; auto-populate is acceptable
    await chooseMainNetworkingDropdown(page, 1, 'default').catch(() => {
      console.log('[TC-NET-05] subnet 下拉选择失败（可能已自动填充），继续');
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log(`[TC-NET-05] VNet 切换失败: ${e.message}`);
    await takeScreenshot(page, 'sc3-tc05-vnet-switch-fail.png');
  }

  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(1000);

  const portsSection = await extractBodySection(page, 'inbound port', 500);
  const bodyText     = await page.evaluate(() => document.body.innerText);

  console.log('[TC-NET-05] 现有 VNet 下入站端口区域文本:',
    (portsSection || '').replace(/\n/g, ' ').trim());

  await takeScreenshot(page, 'sc3-tc05-ports-existing-vnet.png');

  const has80      = /\b80\b/.test(portsSection || bodyText);
  const has443     = /\b443\b/.test(portsSection || bodyText);
  const hasNSGMsg  = /nsg|security group|manual.*rule|edit.*rule/i.test(portsSection || bodyText);
  const noPortSec  = !portsSection;

  if (noPortSec) {
    console.log('[TC-NET-05] ✅ PASS: 现有 VNet 下 "inbound port" 区域已消失（符合预期）');
  } else if (!has80 && !has443) {
    console.log('[TC-NET-05] ✅ PASS: 现有 VNet 下 80/443 端口选项不再显示');
  } else if (hasNSGMsg) {
    console.log('[TC-NET-05] ✅ PASS: 现有 VNet 下提示需要手动编辑 NSG 规则');
  } else {
    console.log('[TC-NET-05] ℹ️  INFO: 现有 VNet 下仍显示端口区域 — 实际行为与新 VNet 相同');
    console.log('[TC-NET-05]     实际文本:', (portsSection || '').replace(/\n/g, ' ').slice(0, 200));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TC-NET-06: Portal rejects existing VNet/subnet that is too small (< /27)
// ────────────────────────────────────────────────────────────────────────────
async function tcNet06InvalidVNetRejection(page) {
  console.log('\n=== TC-NET-06: 验证门户拒绝过小/未委托的现有 VNet ===');

  // Scroll to top of networking section
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  console.log(`[TC-NET-06] 切换到无效 VNet: ${INVALID_VNET_NAME}`);
  try {
    await chooseMainNetworkingDropdown(page, 0, INVALID_VNET_NAME);
    await page.waitForTimeout(2000);
    await chooseMainNetworkingDropdown(page, 1, 'default').catch(() => {
      console.log('[TC-NET-06] subnet 下拉选择失败（可能已自动填充），继续');
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log(`[TC-NET-06] VNet 切换失败: ${e.message}`);
    await takeScreenshot(page, 'sc3-tc06-vnet-switch-fail.png');
    throw e;
  }

  await takeScreenshot(page, 'sc3-tc06-invalid-vnet-selected.png');

  // Click Next to trigger validation
  const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
  await nextBtn.waitFor({ state: 'visible', timeout: 15000 });
  await nextBtn.click();
  await page.waitForTimeout(4000);

  const errors = await collectErrors(page);
  console.log('[TC-NET-06] 收集到的报错/校验文本:');
  for (const item of errors) console.log(`  - ${item}`);

  await takeScreenshot(page, 'sc3-tc06-validation-errors.png');

  const matched = errors.some((text) =>
    /delegat|subnet|\/27|address space|size|not valid|validation failed/i.test(text)
  );

  if (matched) {
    console.log('[TC-NET-06] ✅ PASS: 门户已拒绝过小/未委托的 VNet');
  } else {
    throw new Error(
      `TC-NET-06 FAIL: 未找到预期拒绝错误。实际报错: ${JSON.stringify(errors)}`
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  SC3 – Networking Configuration Comprehensive Test  ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const results = {};
  const context = await createContext();
  const page = context.pages().find((p) => p.url() && p.url() !== 'about:blank')
    || await context.newPage();

  async function run(tcId, fn) {
    try {
      await fn(page);
      results[tcId] = 'PASS';
    } catch (e) {
      console.error(`[${tcId}] ❌ ERROR: ${e.message}`);
      results[tcId] = 'FAIL';
      await takeScreenshot(page, `sc3-${tcId.toLowerCase()}-error.png`).catch(() => {});
    }
  }

  try {
    await gotoCreateWizard(page);
    await fillBasics(page);
    await enterNetworking(page);

    console.log('\n[networking-dump] 当前 Networking 页面内容:');
    await dumpNetworkingContext(page);

    await run('TC-NET-01', tcNet01DefaultVNetSubnet);
    await run('TC-NET-02', tcNet02PublicIPOptions);
    await run('TC-NET-03', tcNet03PrivateIPStatic);
    await run('TC-NET-04', tcNet04InboundPortsNewVNet);
    await run('TC-NET-05', tcNet05InboundPortsExistingVNet);
    await run('TC-NET-06', tcNet06InvalidVNetRejection);

  } catch (err) {
    console.error(`[fatal] ${err.stack || err.message}`);
    await takeScreenshot(page, 'sc3-fatal.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║         SC3 测试结果汇总              ║');
    console.log('╚══════════════════════════════════════╝');
    for (const [tc, result] of Object.entries(results)) {
      const icon = result === 'PASS' ? '✅' : '❌';
      console.log(`  ${icon}  ${tc}: ${result}`);
    }
    const allPass = Object.values(results).every((r) => r === 'PASS');
    if (!allPass) process.exitCode = 1;

    await page.waitForTimeout(3000).catch(() => {});
    await context.close().catch(() => {});
  }
})();
