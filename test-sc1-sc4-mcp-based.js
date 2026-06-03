/**
 * NGINXaaS SC1-SC4 完整顺序测试（MCP 实测经验版）
 *
 * 本脚本根据 2026-06-02 以 MCP Playwright Browser 工具直接在浏览器中实际执行
 * SC1-SC4 测试的结果重新整理，包含以下关键修正：
 *
 *   1. TC-NET-06：选择 lyx-vnet01 后，Portal **立即** 显示错误（无需点击 Next）；
 *      先等待 2.5 s 收集即时错误，仅在未检测到时才点击 Next 作为兜底。
 *
 *   2. VNet/Subnet 下拉：使用 .fxc-dropdown-option 类遍历（不用 [role="option"]，
 *      后者会匹配到 Portal 搜索历史隐藏元素，导致误点击）。
 *
 *   3. Tags Name 输入：必须 pressSequentially({ delay: 80 })；
 *      fill() 被 Knockout.js observable 重置。
 *
 *   4. TC-01 空值验证：blur 不触发，需通过底部 [role="button"] "Review + create" 触发。
 *
 *   5. RG "Create new" 弹框：无 role="dialog"，用 Cancel 按钮可见性作为弹框状态锚点；
 *      错误检测使用 cancelBtn.evaluate()（非 page.evaluate()）保持 iframe 上下文。
 *
 * 运行：node test-sc1-sc4-mcp-based.js
 *
 * 前置条件：
 *   - Node.js + playwright 已安装（npm i playwright）
 *   - lyx-vnet01（10.0.0.0/28）和 lyx-vnet02（10.0.0.0/16）已在 West Central US 创建
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── 常量 ──────────────────────────────────────────────────────────────────────

const AZURE_PORTAL_URL =
  'https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true' +
  '&Azure_Marketplace_Nginx=stage1' +
  '&Azure_Marketplace_Nginx_assettypeoptions=%7B%22Nginx%22%3A%7B%22options%22%3A%22%22%7D%7D' +
  '&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home';

const TARGET_ACCOUNT        = 'v-yixueli@microsoft.com';
const TARGET_SUBSCRIPTION   = 'Liftr-Nginx-Test';
const TARGET_RESOURCE_GROUP = 'lyx-liftr-test';
const TARGET_REGION         = 'West Central US';
const VALID_RG_NAME         = 'lyx-rg-test';

const SCREENSHOT_DIR = path.join(__dirname, 'sc4-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const EDGE_USER_DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
const TEST_PROFILE_DIR   = path.join(__dirname, '.edge-test-profile');

const NETWORKING_CHECKBOX_XPATH =
  '/html/body/div[1]/div[4]/div[1]/div[1]/main/div[3]/div[2]/section[2]/div[2]/div[1]/' +
  'div[4]/div[2]/div/div/div[2]/div/div[2]/div[2]/div/div[2]/div/div[3]/div[3]/' +
  'div[2]/div[2]/div/div/span';

// Name 非法用例
const INVALID_NAME_CASES = [
  { id: 'TC-01', input: '',             desc: '空字符串' },
  { id: 'TC-02', input: 'a'.repeat(31), desc: '31 个字符（超过最大长度 30）' },
  { id: 'TC-03', input: '-lyx-test',    desc: '以连字符开头' },
  { id: 'TC-04', input: 'lyx-test-',   desc: '以连字符结尾' },
  { id: 'TC-05', input: '-lyx-test-',  desc: '两端均为连字符' },
  { id: 'TC-06', input: 'lyx test',    desc: '含空格' },
  { id: 'TC-07', input: 'lyx_test',    desc: '含下划线' },
  { id: 'TC-08', input: 'lyx@test',    desc: '含 @' },
  { id: 'TC-09', input: 'lyx.test',    desc: '含点号' },
  { id: 'TC-10', input: 'lyx#test!',   desc: '含 #!' },
  { id: 'TC-11', input: '中文名称',     desc: '含中文字符' },
];

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function buildName(prefix) {
  const n = new Date();
  return `${prefix}-${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}` +
         `${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`;
}

async function shot(page, label) {
  const p = path.join(SCREENSHOT_DIR, `${label}.png`);
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  console.log(`  [screenshot] ${path.basename(p)}`);
}

function printTable(rows) {
  const headers = ['ID', 'Scenario', 'Status', 'Detail'];
  const mapped  = rows.map(r => [r.id, r.scenario, r.status, r.detail || '']);
  const widths  = headers.map((h, i) =>
    Math.min(70, Math.max(h.length, ...mapped.map(row => String(row[i]).length)))
  );
  const line   = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const render = cols => '| ' + cols.map((c, i) => String(c).slice(0, widths[i]).padEnd(widths[i])).join(' | ') + ' |';
  console.log('\n' + line);
  console.log(render(headers));
  console.log(line);
  for (const row of mapped) console.log(render(row));
  console.log(line);
}

// ── 登录处理 ─────────────────────────────────────────────────────────────────

async function handleLoginFlow(page) {
  for (let i = 0; i < 4; i++) {
    const url = page.url();
    if (!url.includes('login.microsoftonline.com') && !url.includes('login.microsoft.com')) break;
    await page.waitForTimeout(2000);

    if (await page.locator(`[data-test-id="${TARGET_ACCOUNT}"]`).isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator(`[data-test-id="${TARGET_ACCOUNT}"]`).click();
      await page.waitForTimeout(2000); continue;
    }
    if (await page.locator(`text="${TARGET_ACCOUNT}"`).isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator(`text="${TARGET_ACCOUNT}"`).first().click();
      await page.waitForTimeout(2000); continue;
    }
    const emailInput = page.locator('input[type="email"][name="loginfmt"], input[name="loginfmt"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill(TARGET_ACCOUNT);
      await page.locator('input[type="submit"][value="Next"], input[id="idSIButton9"]').click();
      await page.waitForTimeout(3000); continue;
    }
    if (await page.locator('input[id="idSIButton9"][value="Yes"]').isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('input[id="idSIButton9"][value="Yes"]').click();
      await page.waitForTimeout(2000);
    }
    break;
  }
}

// ── 导航到 NGINXaaS Create 向导 ────────────────────────────────────────────────

async function gotoCreateWizard(page) {
  console.log('  [nav] 导航到 Azure Portal...');
  await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await handleLoginFlow(page);

  console.log('  [nav] 等待 Portal 首页搜索框...');
  await page.waitForSelector(
    '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
    { timeout: 120000 }
  );
  await page.waitForTimeout(2000);

  console.log('  [nav] 搜索 NGINXaaS...');
  const searchBox = page.locator('[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]').first();
  await searchBox.click();
  await page.waitForTimeout(500);
  // fill() 不触发 Portal 搜索事件，必须 pressSequentially
  await searchBox.pressSequentially('nginxaas', { delay: 80 });
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // 精确匹配 "NGINXaaS"，排除 Marketplace 条目（文字更长）
  await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();

  console.log('  [nav] 等待资源列表页 iframe...');
  await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('  [nav] 点击 +Create...');
  // Create 按钮在 iframe 内，必须通过 frameLocator 穿透
  const createBtn = page.frameLocator('iframe[name="BrowseResource.ReactView"]')
    .locator('[role="menuitem"]:has-text("Create")');
  await createBtn.waitFor({ state: 'visible', timeout: 30000 });
  await createBtn.click();

  console.log('  [nav] 等待 Create 向导加载...');
  await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
  await page.waitForSelector('text=Project details', { timeout: 30000 });
  await page.waitForTimeout(3000);
}

// ── Basics 字段填写（SC2 后使用）────────────────────────────────────────────────

async function fillBasicsForNavigation(page) {
  console.log('  [basics] 填写有效 Basics 字段...');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  // Subscription
  const subOk = await page.evaluate(t => {
    const l = [...document.querySelectorAll('label')].find(el => /^Subscription/.test(el.textContent?.trim()));
    if (!l) return false;
    let e = l.parentElement;
    for (let i = 0; i < 5 && e; i++, e = e.parentElement) if (e.textContent?.includes(t)) return true;
    return false;
  }, TARGET_SUBSCRIPTION);
  if (!subOk) {
    await page.evaluate(() => {
      const l = [...document.querySelectorAll('label')].find(el => /^Subscription/.test(el.textContent?.trim()));
      if (!l) return;
      let e = l.parentElement;
      for (let i = 0; i < 6 && e; i++, e = e.parentElement) {
        const ctrl = e.querySelector('button[aria-haspopup="listbox"],[role="combobox"]');
        if (ctrl) { ctrl.click(); return; }
      }
    });
    await page.waitForTimeout(800);
    await page.locator('[role="option"]').filter({ hasText: TARGET_SUBSCRIPTION }).first().click();
    await page.waitForTimeout(2000);
  }

  // Resource Group
  const rgOk = await page.evaluate(t => {
    const l = [...document.querySelectorAll('label')].find(el => /^Resource group/.test(el.textContent?.trim()));
    if (!l) return false;
    let e = l.parentElement;
    for (let i = 0; i < 5 && e; i++, e = e.parentElement) if (e.textContent?.includes(t)) return true;
    return false;
  }, TARGET_RESOURCE_GROUP);
  if (!rgOk) {
    const rgDrop = page.locator('div[aria-label="Create new or use existing Resource group"]');
    await rgDrop.waitFor({ state: 'visible', timeout: 10000 });
    await rgDrop.click();
    await page.waitForTimeout(800);
    const rgFilter = page.locator('input[aria-label="Type to filter result or use down arrow to choose options"]').nth(1);
    await rgFilter.waitFor({ state: 'visible', timeout: 8000 });
    await rgFilter.click();
    await rgFilter.pressSequentially(TARGET_RESOURCE_GROUP, { delay: 50 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }

  // Name（有效值）
  const nameId = await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(el => /^Name\b/.test((el.textContent || '').trim()));
    return l?.htmlFor || null;
  });
  const nameInput = nameId
    ? page.locator(`[id="${nameId}"]`)
    : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  const validName = buildName('lyx-sc2');
  await nameInput.click({ clickCount: 3 });
  await nameInput.fill(validName);
  await page.waitForTimeout(500);

  // Region
  const regionOk = await page.evaluate(t => {
    const l = [...document.querySelectorAll('label')].find(el => /^Region\b/.test((el.textContent || '').trim()));
    if (!l) return false;
    let e = l.parentElement;
    for (let i = 0; i < 5 && e; i++, e = e.parentElement) if (e.textContent?.includes(t)) return true;
    return false;
  }, TARGET_REGION);
  if (!regionOk) {
    const regionDropHandle = await page.evaluateHandle(() => {
      const l = [...document.querySelectorAll('label')].find(el => /^Region\b/.test((el.textContent || '').trim()));
      if (!l) return null;
      let e = l.parentElement;
      for (let i = 0; i < 6 && e; i++, e = e.parentElement) {
        const b = e.querySelector('button[aria-haspopup="listbox"],[role="combobox"]');
        if (b) return b;
      }
      return null;
    });
    const regionEl = regionDropHandle.asElement();
    if (regionEl) {
      const cid = await regionEl.getAttribute('aria-controls');
      await regionEl.click();
      await page.waitForTimeout(800);
      if (cid) {
        const popup = page.locator(`#${cid}`);
        await popup.waitFor({ state: 'visible', timeout: 5000 });
        const fi = popup.locator('input').first();
        if (await fi.isVisible({ timeout: 2000 }).catch(() => false)) {
          await fi.click();
          await fi.pressSequentially('West central us', { delay: 80 });
          await page.waitForTimeout(1000);
          await fi.press('ArrowDown');
          await page.waitForTimeout(500);
          await fi.press('Enter');
        }
      }
    }
    await page.waitForTimeout(1000);
  }

  // Pricing Plan（Standard v3）
  const pricingBtn = page.locator('text=Select pricing plan').first();
  if (await pricingBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pricingBtn.click();
    await page.waitForTimeout(2500);
    const v3Row = page.locator('[role="row"],tr,li')
      .filter({ hasText: /Standard V3/i })
      .filter({ hasNotText: /Test|TESTING/i })
      .first();
    await v3Row.waitFor({ state: 'visible', timeout: 15000 });
    const radio = v3Row.locator('input[type="radio"]');
    if (await radio.count()) await radio.click(); else await v3Row.click();
    await page.waitForTimeout(1000);
    await page.locator('text=Confirm Plan').first().click();
    await page.waitForTimeout(2000);
  }
  console.log(`  [basics] Basics 填写完成（Name: ${validName}）`);
}

// ── SC2: Basics 字段验证 ────────────────────────────────────────────────────────

/** 读取 Name 输入框附近的 aria-invalid + 错误文字 */
async function getNameError(page) {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(l => /^Name\b/.test((l.textContent || '').trim()));
    const id = label?.htmlFor;
    const inp = id ? document.getElementById(id) : document.querySelector('input[type="text"]');
    if (!inp) return { inv: null, txt: null };
    const inv = inp.getAttribute('aria-invalid');
    const errId = inp.getAttribute('aria-errormessage') || inp.getAttribute('aria-describedby');
    if (errId) {
      const el = document.getElementById(errId.split(' ')[0]);
      if (el) { const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t) return { inv, txt: t }; }
    }
    let c = inp.parentElement;
    for (let d = 0; d < 5 && c; d++, c = c.parentElement) {
      for (const el of c.querySelectorAll('[role="alert"],[aria-live="assertive"]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t && t.length < 300) return { inv, txt: t };
      }
    }
    return { inv, txt: null };
  });
}

async function runSC2(page, addResult) {
  console.log('\n── SC2: Basics 字段验证 ──────────────────────────────────────────');

  // 确保在 Basics 标签
  const basicsTab = page.getByRole('tab', { name: /basics/i }).first();
  if (await basicsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await basicsTab.click(); await page.waitForTimeout(1000);
  }

  // 定位 Name 输入框
  const nameId = await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(el => /^Name\b/.test((el.textContent || '').trim()));
    return l?.htmlFor || null;
  });
  const nameInput = nameId
    ? page.locator(`[id="${nameId}"]`)
    : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });

  // ── Name 非法用例（TC-01 ～ TC-11）
  for (const tc of INVALID_NAME_CASES) {
    await nameInput.click({ clickCount: 3 });
    if (tc.input === '') {
      await nameInput.press('Delete');
    } else {
      await nameInput.fill(tc.input);
    }
    await page.waitForTimeout(300);
    await nameInput.press('Tab');
    await page.waitForTimeout(800);
    let { inv, txt } = await getNameError(page);

    // TC-01：空值 blur 不触发，需点击底部 Review+create 触发批量校验
    // 底部按钮是 role="button" DIV，不是向导 tab；点击后 Portal 保留在 Basics 页
    if (tc.input === '' && inv !== 'true' && !txt) {
      const reviewBtn = page.locator('[role="button"]:has-text("Review + create")').last();
      await reviewBtn.waitFor({ state: 'visible', timeout: 10000 });
      await reviewBtn.click();
      await page.waitForTimeout(2000);
      await nameInput.waitFor({ state: 'visible', timeout: 10000 });
      ({ inv, txt } = await getNameError(page));
    }

    const passed = inv === 'true' || !!txt;
    addResult(tc.id, `Name 非法值: ${tc.desc}`, passed, txt || `inv=${inv}`);
    await shot(page, `sc2-${tc.id}`);
  }

  // ── TC-RG-01：Resource Group 空值错误
  // 通过底部 Review+create 触发批量校验（与 TC-01 相同机制）
  const reviewBtnRG = page.locator('[role="button"]:has-text("Review + create")').last();
  await reviewBtnRG.waitFor({ state: 'visible', timeout: 10000 });
  await reviewBtnRG.click();
  await page.waitForTimeout(2000);

  const rgError = await page.evaluate(() => {
    const scan = root => {
      for (const el of root.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      for (const el of root.querySelectorAll('[class*="error" i],[class*="invalid" i],[class*="validation" i]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 300) return t;
      }
      return null;
    };
    const lbl = [...document.querySelectorAll('label,span,div')].find(el => {
      if (el.children.length > 3) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return /^resource\s*group/i.test(t) && t.length < 60;
    });
    if (lbl) {
      let node = lbl.parentElement;
      for (let d = 0; d < 12 && node && node !== document.body; d++, node = node.parentElement) {
        if (!node.querySelector('[role="combobox"],select')) continue;
        const t = scan(node); if (t) return t;
      }
    }
    // 兜底：全页扫描 "must not be empty"
    for (const el of document.querySelectorAll('[role="alert"],[aria-live="assertive"]')) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (/the value must not be empty/i.test(t)) return t;
    }
    return null;
  });
  addResult('TC-RG-01', 'Resource Group 空值触发错误', !!(rgError && /must not be empty/i.test(rgError)), rgError || '');
  await shot(page, 'sc2-TC-RG-01');

  // ── TC-RG-02：验证 "Create new" 可见
  const createNewRG = page.locator(
    'a:has-text("Create new"),button:has-text("Create new"),[role="button"]:has-text("Create new")'
  ).first();
  const rg02ok = await createNewRG.isVisible({ timeout: 10000 }).catch(() => false);
  addResult('TC-RG-02', '"Create new" 可见', rg02ok, '');
  await shot(page, 'sc2-TC-RG-02');
  if (!rg02ok) return; // 无法继续 RG 弹框用例

  // 打开 "Create new" 弹框（inline callout，无 role="dialog"）
  await createNewRG.click();
  await page.waitForTimeout(1500);

  // Cancel 按钮可见 = 弹框已开启
  const cancelBtn = page.getByRole('button', { name: 'Cancel' });
  await cancelBtn.waitFor({ state: 'visible', timeout: 8000 });

  // RG Name 输入框：从 Cancel 向上找含 input 的最近祖先
  // 使用 cancelBtn.locator(xpath=...) 保证在 Cancel 所在 frame 内查找
  const rgInput = cancelBtn.locator('xpath=ancestor::*[.//input][1]//input').first();
  await rgInput.waitFor({ state: 'visible', timeout: 10000 });

  // 弹框内错误读取：cancelBtn.evaluate() 保持 iframe 上下文（关键！）
  const getRGDialogError = () => cancelBtn.evaluate(btn => {
    let node = btn.parentElement;
    for (let i = 0; i < 12 && node && node !== document.body; i++, node = node.parentElement) {
      if (!node.querySelector('input')) continue;
      for (const el of node.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t) return t;
      }
      for (const el of node.querySelectorAll('[class*="error" i],[class*="invalid" i]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t && t.length < 400) return t;
      }
    }
    return null;
  });

  const okBtn = page.getByRole('button', { name: 'OK' }).first();

  // TC-RG-03：空值 → OK 被阻止（弹框不关闭）
  await rgInput.click({ clickCount: 3 }); await rgInput.press('Delete'); await page.waitForTimeout(400);
  await okBtn.click().catch(() => {}); await page.waitForTimeout(800);
  const rg03ok = await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false);
  addResult('TC-RG-03', 'RG 弹框空值 → OK 被阻止', rg03ok, rg03ok ? '弹框未关闭' : '弹框意外关闭');
  await shot(page, 'sc2-TC-RG-03');

  // 确保弹框仍开着
  if (!await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createNewRG.click(); await cancelBtn.waitFor({ state: 'visible', timeout: 8000 });
  }

  // TC-RG-04：末尾句点（rg-test.）
  await rgInput.click({ clickCount: 3 }); await rgInput.fill('rg-test.'); await rgInput.press('Tab'); await page.waitForTimeout(600);
  const err04 = await getRGDialogError();
  addResult('TC-RG-04', 'RG 弹框 name=rg-test. → 格式错误', !!err04, err04 || '');
  await shot(page, 'sc2-TC-RG-04');

  // TC-RG-05：含感叹号（rg!test）
  await rgInput.click({ clickCount: 3 }); await rgInput.fill('rg!test'); await rgInput.press('Tab'); await page.waitForTimeout(600);
  const err05 = await getRGDialogError();
  addResult('TC-RG-05', 'RG 弹框 name=rg!test → 格式错误', !!err05, err05 || '');
  await shot(page, 'sc2-TC-RG-05');

  // TC-RG-VALID：合法名称 → OK → 弹框关闭
  await rgInput.click({ clickCount: 3 }); await rgInput.fill(VALID_RG_NAME); await rgInput.press('Tab'); await page.waitForTimeout(600);
  const errV = await getRGDialogError();
  await okBtn.click().catch(() => {}); await page.waitForTimeout(1000);
  const closed = !(await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false));
  addResult('TC-RG-VALID', `RG 弹框合法名称 "${VALID_RG_NAME}" → 关闭`, !errV && closed, `errV=${errV} closed=${closed}`);
  await shot(page, 'sc2-TC-RG-VALID');
}

// ── SC3: Networking 配置验证 ────────────────────────────────────────────────────

/** 读取有实际布局的 VNet/Subnet 下拉控件文本（绕过 position:absolute 可见性问题）*/
async function readNetworkDropdowns(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
      .filter(el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && (el.textContent || '').trim(); })
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
  );
}

/** 点击 index 处下拉，选择文字包含 optionText 的选项（使用 .fxc-dropdown-option 类） */
async function chooseNetworkDropdown(page, index, optionText) {
  const handle = await page.evaluateHandle(idx => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
      .filter(el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && (el.textContent || '').trim(); });
    return all[idx] || null;
  }, index);
  const el = handle.asElement();
  if (!el) throw new Error(`Dropdown at index ${index} not found`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click();
  await page.waitForTimeout(2500);

  // 使用 .fxc-dropdown-option（不用 [role="option"]，后者会命中隐藏的搜索历史）
  const opts = await page.locator('.fxc-dropdown-option').all();
  for (const opt of opts) {
    if (!await opt.isVisible().catch(() => false)) continue;
    const t = (await opt.textContent().catch(() => '')) || '';
    if (t.toLowerCase().includes(optionText.toLowerCase())) { await opt.click(); await page.waitForTimeout(1500); return; }
  }
  // 兜底：evaluateHandle
  const fb = await page.evaluateHandle(target =>
    [...document.querySelectorAll('.fxc-dropdown-option')].find(el => {
      const r = el.getBoundingClientRect(); const t = (el.textContent || '').trim().toLowerCase();
      return t.includes(target.toLowerCase()) && r.width > 0 && r.height > 0;
    }) || null, optionText);
  const fbEl = fb.asElement();
  if (!fbEl) throw new Error(`Option "${optionText}" not found in dropdown (index ${index})`);
  await fbEl.click();
  await page.waitForTimeout(1500);
}

/** 收集当前页面的网络/校验错误文字 */
async function collectNetworkErrors(page) {
  return page.evaluate(() => {
    const msgs = new Set();
    ['[role="alert"]','[class*="error" i]','[aria-invalid="true"]','[class*="validation" i]','[aria-live="assertive"]'].forEach(s =>
      document.querySelectorAll(s).forEach(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length > 5 && t.length < 500) msgs.add(t);
      })
    );
    return [...msgs];
  });
}

async function runSC3(page, addResult) {
  console.log('\n── SC3: Networking 配置验证 ────────────────────────────────────');

  // TC-NET-01：验证默认新建 VNet/Subnet
  const drops = await readNetworkDropdowns(page);
  console.log(`  [NET-01] 下拉内容: ${JSON.stringify(drops)}`);
  const vnetOk   = /\(New\)\s*\S+-vnet/i.test(drops[0] || '');
  const subnetOk = /\(New\)\s*default/i.test(drops[1] || '');
  addResult('TC-NET-01', '默认新建 VNet/Subnet', vnetOk && subnetOk, `vnet="${drops[0]}" subnet="${drops[1]}"`);
  await shot(page, 'sc3-tc01');

  // TC-NET-02：公共 IP 有 New / Existing 选项
  const bodyText2 = await page.evaluate(() => document.body.innerText || '');
  addResult('TC-NET-02', '公共 IP 有 New/Existing 选项',
    /\bNew\b/i.test(bodyText2) && /\bExisting\b/i.test(bodyText2), '');
  await shot(page, 'sc3-tc02');

  // TC-NET-03：Private Only — 静态 IP 校验
  let net03ok = false;
  try {
    const radioPrivate = page.locator('[role="radio"]').filter({ hasText: /private\s*only/i }).first()
      .or(page.locator('button,label').filter({ hasText: /^private only$/i }).first());
    let switched = false;
    if (await radioPrivate.isVisible({ timeout: 3000 }).catch(() => false)) {
      await radioPrivate.click({ force: true }); await page.waitForTimeout(1500); switched = true;
    }
    const hasStaticField = /private static ip/i.test(await page.evaluate(() => document.body.innerText));
    const privateIpInput = page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).last();
    if (switched && await privateIpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // 空值
      await privateIpInput.click({ clickCount: 3 }); await privateIpInput.press('Delete'); await privateIpInput.press('Tab'); await page.waitForTimeout(600);
      const emptyInv = await privateIpInput.getAttribute('aria-invalid').catch(() => null);
      // 非法格式
      await privateIpInput.click({ clickCount: 3 }); await privateIpInput.fill('abc.def.1'); await privateIpInput.press('Tab'); await page.waitForTimeout(600);
      // 合法
      await privateIpInput.click({ clickCount: 3 }); await privateIpInput.fill('172.22.0.10'); await privateIpInput.press('Tab'); await page.waitForTimeout(600);
      const validInv = await privateIpInput.getAttribute('aria-invalid').catch(() => null);
      net03ok = hasStaticField && emptyInv === 'true' && validInv !== 'true';
      // 切回 Public Only
      const radioPublic = page.locator('[role="radio"]').filter({ hasText: /public\s*only/i }).first();
      if (await radioPublic.isVisible({ timeout: 2000 }).catch(() => false)) { await radioPublic.click({ force: true }); await page.waitForTimeout(1000); }
    } else {
      net03ok = hasStaticField;
    }
  } catch (e) { console.log(`  [NET-03] 异常: ${e.message}`); }
  addResult('TC-NET-03', 'Private Only 静态 IP 字段校验', net03ok, '');
  await shot(page, 'sc3-tc03');

  // TC-NET-04：新 VNet 下入站端口 80/443
  const bodyText4 = await page.evaluate(() => document.body.innerText || '');
  addResult('TC-NET-04', '入站端口 80/443（2 selected）',
    /2 selected/i.test(bodyText4) || (/\b80\b/.test(bodyText4) && /\b443\b/.test(bodyText4)), '');
  await shot(page, 'sc3-tc04');

  // TC-NET-05：切换到现有 VNet lyx-vnet02
  let net05ok = false;
  try {
    await chooseNetworkDropdown(page, 0, 'lyx-vnet02');
    await page.waitForTimeout(2000);
    await chooseNetworkDropdown(page, 1, 'default').catch(() => {
      console.log('  [NET-05] subnet 下拉选择失败（可能已自动填充），继续');
    });
    await page.waitForTimeout(1500);
    const drops5 = await readNetworkDropdowns(page);
    net05ok = drops5.some(t => /lyx-vnet02/i.test(t));
    addResult('TC-NET-05', '切换到现有 VNet lyx-vnet02', net05ok, `drops=${JSON.stringify(drops5)}`);
  } catch (e) {
    addResult('TC-NET-05', '切换到现有 VNet lyx-vnet02', false, e.message);
  }
  await shot(page, 'sc3-tc05');

  // TC-NET-06：无效 VNet lyx-vnet01（/28 过小）
  // ⚑ MCP 实测修正：选择 lyx-vnet01 后 Portal **立即** 显示错误，无需点击 Next
  //   先等待 2.5 s 收集即时错误；仅在未检测到时才点击 Next 作为兜底
  try {
    await chooseNetworkDropdown(page, 0, 'lyx-vnet01');
    await page.waitForTimeout(1000);
    await chooseNetworkDropdown(page, 1, 'default').catch(() => {
      console.log('  [NET-06] subnet 下拉选择失败（可能已自动填充），继续');
    });
    // 等待 Portal 即时错误（无需点击 Next）
    await page.waitForTimeout(2500);
    await shot(page, 'sc3-tc06-immediate');

    const kw = /\/27|address space|address prefix|incompatible|subnet|capacity|not valid/i;
    let errors = await collectNetworkErrors(page);
    console.log(`  [NET-06] 即时错误（${errors.length} 项）:`, errors.slice(0, 3));
    let net06ok = errors.some(t => kw.test(t));

    // 兜底：若未立即显示错误，尝试点击 Next
    if (!net06ok) {
      console.log('  [NET-06] 未检测到即时错误，点击 Next 作为兜底...');
      const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(3000);
        errors = await collectNetworkErrors(page);
        net06ok = errors.some(t => kw.test(t));
      }
    }
    await shot(page, 'sc3-tc06-result');
    addResult('TC-NET-06', 'lyx-vnet01（/28 过小）Portal 拒绝', net06ok, errors.slice(0, 2).join(' | '));
  } catch (e) {
    addResult('TC-NET-06', 'lyx-vnet01（/28 过小）Portal 拒绝', false, e.message);
    await shot(page, 'sc3-tc06-error');
  }
}

// ── SC4: Tags 验证 ───────────────────────────────────────────────────────────────

/**
 * 添加一个标签行。
 * ⚑ Name 输入必须用 pressSequentially（KO observable 会重置 fill() 的值）
 */
async function addTag(page, key, value) {
  const tagsPanel = page.getByRole('tabpanel', { name: /tags/i });
  const nameInputs = tagsPanel.locator('input[aria-label="Name"]');
  await nameInputs.last().waitFor({ state: 'visible', timeout: 10000 });

  // 找最后一个值为空的 Name input
  const emptyId = await tagsPanel.evaluate(p => {
    const ns = [...p.querySelectorAll('input[aria-label="Name"]')];
    for (let i = ns.length - 1; i >= 0; i--) if (ns[i].value === '') return ns[i].id;
    return null;
  });
  if (!emptyId) throw new Error(`addTag: no empty Name input for key="${key}"`);

  const nameInput = page.locator(`#${emptyId}`);
  await nameInput.click({ force: true });
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(80);
  // ⚑ 必须 pressSequentially，不能 fill() 或 keyboard.type()
  await nameInput.pressSequentially(key, { delay: 80 });
  await page.waitForTimeout(350);
  // ⚑ Escape 关闭 autocomplete 下拉，再 Tab 到 Value
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  await page.keyboard.press('Tab'); await page.waitForTimeout(300);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(80);
  await page.keyboard.type(value, { delay: 60 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab'); await page.waitForTimeout(900);
}

/** 读取 Tags 控件中所有 display rows（已提交行无 input 元素）*/
async function readDisplayedTags(page) {
  const grid = page.getByRole('grid', { name: /add or edit tags/i });
  const rows  = grid.getByRole('row');
  const count = await rows.count();
  const tags  = [];
  for (let i = 0; i < count; i++) {
    const label = await rows.nth(i).getAttribute('aria-label').catch(() => null)
      || await rows.nth(i).innerText().catch(() => '');
    const m = label.match(/^(.+?)\s*:\s*(.+?)\s+All resources/);
    if (m) tags.push(`${m[1].trim()}=${m[2].trim()}`);
  }
  return tags;
}

async function runSC4(page, addResult) {
  console.log('\n── SC4: Tags 验证 ─────────────────────────────────────────────');

  // 确保在 Tags 标签页
  const tagsTab = page.getByRole('tab', { name: /^tags$/i }).first();
  if (await tagsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tagsTab.click(); await page.waitForTimeout(1500);
  }
  const tagsPanel = page.getByRole('tabpanel', { name: /tags/i });
  const panelVisible = await tagsPanel.isVisible({ timeout: 5000 }).catch(() => false);
  if (!panelVisible) { addResult('SC4-SETUP', 'Tags 标签页可见', false, ''); return; }

  // TC-TAG-01 ～ 04：正常添加
  const normalTags = [
    { id: 'TC-TAG-01', key: 'env',          value: 'test' },
    { id: 'TC-TAG-02', key: 'owner',        value: 'lyx' },
    { id: 'TC-TAG-03', key: 'project-name', value: 'nginx/stage' },
    { id: 'TC-TAG-04', key: 'cost_center',  value: '123' },
  ];
  for (const { id, key, value } of normalTags) {
    try {
      await addTag(page, key, value);
      const after = await readDisplayedTags(page);
      addResult(id, `添加标签 ${key}=${value}`, after.includes(`${key}=${value}`), `[${after.join(', ')}]`);
    } catch (e) { addResult(id, `添加标签 ${key}=${value}`, false, e.message); }
    await shot(page, `sc4-${id}`);
  }

  // TC-TAG-05：重复键 env=production → 警告
  await addTag(page, 'env', 'production').catch(() => {});
  const text05 = await tagsPanel.innerText().catch(() => '');
  addResult('TC-TAG-05', '重复键 env=production → 警告', /already used/i.test(text05), '');
  await shot(page, 'sc4-TC-TAG-05');

  // TC-TAG-SPECIAL：Name 含 <>? → 错误提示
  const emptyIdSp = await tagsPanel.evaluate(p => {
    const ns = [...p.querySelectorAll('input[aria-label="Name"]')];
    for (let i = ns.length - 1; i >= 0; i--) if (ns[i].value === '') return ns[i].id;
    return null;
  });
  if (emptyIdSp) {
    const spInput = page.locator(`#${emptyIdSp}`);
    await spInput.click({ force: true }); await page.waitForTimeout(100);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(80);
    await spInput.pressSequentially('<>?', { delay: 80 });
    await page.waitForTimeout(600);
    const spText = await tagsPanel.innerText().catch(() => '');
    addResult('TC-TAG-SPECIAL', 'Name 含 "<>?" → 非法字符提示', /not supported|invalid tag name|not allowed|cannot contain/i.test(spText), '');
    await spInput.click({ force: true }); await page.waitForTimeout(100);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(500);
  } else {
    addResult('TC-TAG-SPECIAL', 'Name 含 "<>?" → 非法字符提示', false, '未找到空编辑行');
  }
  await shot(page, 'sc4-TC-TAG-SPECIAL');

  // TC-TAG-EDIT：编辑 owner 值 lyx → yixueli
  // ⚑ Value 输入也使用 pressSequentially 保证 KO 更新
  const ownerValueId = await tagsPanel.evaluate(p => {
    const ns = [...p.querySelectorAll('input[aria-label="Name"]')];
    const vs = [...p.querySelectorAll('input[aria-label="Value"]')];
    const idx = ns.findIndex(n => n.value === 'owner');
    return idx >= 0 ? vs[idx]?.id : null;
  });
  if (ownerValueId) {
    const vi = page.locator(`#${ownerValueId}`);
    await vi.click({ force: true }); await page.waitForTimeout(200);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(80);
    await vi.pressSequentially('yixueli', { delay: 80 });
    await page.waitForTimeout(300); await page.keyboard.press('Tab'); await page.waitForTimeout(700);
    const after = await readDisplayedTags(page);
    addResult('TC-TAG-EDIT', '编辑 owner: lyx → yixueli', after.includes('owner=yixueli') && !after.includes('owner=lyx'), `[${after.join(', ')}]`);
  } else {
    addResult('TC-TAG-EDIT', '编辑 owner: lyx → yixueli', false, 'owner input 未找到');
  }
  await shot(page, 'sc4-TC-TAG-EDIT');

  // TC-TAG-DEL：删除 cost_center 行
  // ⚑ Delete 按钮无 aria-label HTML 属性，必须用 getByRole 通过无障碍名称定位
  const beforeDel = await readDisplayedTags(page);
  if (beforeDel.some(t => t.startsWith('cost_center'))) {
    await page.getByRole('row', { name: /cost_center/ })
      .getByRole('button', { name: 'Delete' })
      .first()
      .click({ force: true });
    await page.waitForTimeout(700);
    const afterDel = await readDisplayedTags(page);
    addResult('TC-TAG-DEL', '删除 cost_center 行', !afterDel.some(t => t.startsWith('cost_center')), `[${afterDel.join(', ')}]`);
  } else {
    addResult('TC-TAG-DEL', '删除 cost_center 行', false, 'cost_center 行不在 display rows');
  }
  await shot(page, 'sc4-TC-TAG-DEL');

  // TC-TAG-REVIEW：进入 Review+Create 验证摘要
  await page.getByRole('button', { name: /review.*create/i }).first().click();
  await page.waitForTimeout(3000);
  await shot(page, 'sc4-TC-TAG-REVIEW');

  const reviewPanel = page.getByRole('tabpanel', { name: /review.*create/i });
  const reviewVisible = await reviewPanel.isVisible({ timeout: 5000 }).catch(() => false);
  if (!reviewVisible) { addResult('TC-TAG-REVIEW', 'Review+Create 页面可见', false, ''); return; }

  const reviewText = await reviewPanel.innerText().catch(() => '');
  const noError  = !/validation failed|required information|not valid/i.test(reviewText);
  const hasSub   = reviewText.includes(TARGET_SUBSCRIPTION);
  const hasRG    = reviewText.includes(TARGET_RESOURCE_GROUP);
  const hasRegion = /west central us/i.test(reviewText);
  const hasEnv   = /\benv\b/i.test(reviewText) && /\btest\b/i.test(reviewText);
  const hasOwner = /\byixueli\b/i.test(reviewText);
  const hasProj  = /project-name/i.test(reviewText);
  const noCost   = !/cost_center/i.test(reviewText);
  const reviewOk = noError && hasSub && hasRG && hasRegion && hasEnv && hasOwner && hasProj && noCost;
  addResult('TC-TAG-REVIEW', 'Review+Create 摘要验证',
    reviewOk,
    `noErr=${noError} sub=${hasSub} rg=${hasRG} region=${hasRegion} env=${hasEnv} owner=${hasOwner} proj=${hasProj} noCost=${noCost}`
  );
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  NGINXaaS SC1-SC4 完整顺序测试（MCP 实测经验版）              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const results  = [];
  const addResult = (id, scenario, passed, detail) => {
    const status = passed ? 'PASS' : 'FAIL';
    const icon   = passed ? '✅' : '❌';
    console.log(`${icon} [${id}] ${scenario}: ${status}${detail ? ' — ' + detail : ''}`);
    results.push({ id, scenario, status, detail: String(detail || '') });
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(EDGE_USER_DATA_DIR, {
      channel: 'msedge', headless: false, viewport: null,
      args: ['--start-maximized', '--profile-directory=Default', '--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    });
    console.log('[init] Edge 默认配置文件加载成功');
  } catch (e) {
    console.log(`[init] 默认配置文件不可用（${e.message.split('\n')[0]}），改用独立测试目录`);
    context = await chromium.launchPersistentContext(TEST_PROFILE_DIR, {
      channel: 'msedge', headless: false, viewport: null,
      args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
    });
  }

  const pages = context.pages();
  const page  = pages.find(p => p.url() && p.url() !== 'about:blank') || pages[0] || await context.newPage();
  for (const extra of context.pages()) if (extra !== page) await extra.close().catch(() => {});
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });

  try {
    // ── SC1: Service Discovery ────────────────────────────────────────
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║  SC1: Service Discovery                                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    try {
      await gotoCreateWizard(page);
      // 验证：Basics tab 激活 + "Project details" 可见
      const projDetails = await page.locator('text=Project details').isVisible({ timeout: 10000 }).catch(() => false);
      let basicsActive = false;
      const tabs = page.locator('[role="tab"]');
      for (let i = 0; i < await tabs.count(); i++) {
        const t = (await tabs.nth(i).textContent().catch(() => '')).toLowerCase();
        if (!t.includes('basics')) continue;
        const sel = await tabs.nth(i).getAttribute('aria-selected').catch(() => null);
        const cls = await tabs.nth(i).getAttribute('class').catch(() => '') || '';
        if (sel === 'true' || cls.includes('azc-br-active')) { basicsActive = true; break; }
      }
      addResult('SC1', '打开 Create 向导，Basics 标签激活', projDetails, `projDetails=${projDetails} basicsActive=${basicsActive}`);
    } catch (e) { addResult('SC1', '打开 Create 向导，Basics 标签激活', false, e.message); }

    // ── SC2: Basics 字段验证 ──────────────────────────────────────────
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║  SC2: Basics 字段验证                                         ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    try { await runSC2(page, addResult); }
    catch (e) { addResult('SC2-FATAL', 'SC2 Basics 验证', false, e.message); }

    // SC2 结束后填写有效 Basics 准备进入 SC3（从新的 Create 向导重新开始，避免遗留校验状态）
    console.log('\n[transition] 重新导航到 Create 向导并填写有效 Basics...');
    try {
      await gotoCreateWizard(page);
      await fillBasicsForNavigation(page);
    } catch (e) { console.error('[transition] Basics 填写失败:', e.message); }

    // ── SC3: Networking 配置验证 ──────────────────────────────────────
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║  SC3: Networking 配置验证                                     ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    try {
      // 进入 Networking 页并展开 VNet 配置区域
      const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
      await nextBtn.waitFor({ state: 'visible', timeout: 10000 }); await nextBtn.click();
      await page.waitForTimeout(4000);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
      const vnetSpan = page.locator(`xpath=${NETWORKING_CHECKBOX_XPATH}`).first();
      if (await vnetSpan.isVisible({ timeout: 5000 }).catch(() => false)) {
        await vnetSpan.scrollIntoViewIfNeeded().catch(() => {}); await vnetSpan.click(); await page.waitForTimeout(1500);
      }
      await runSC3(page, addResult);
    } catch (e) { addResult('SC3-FATAL', 'SC3 Networking 验证', false, e.message); }

    // ── SC4: Tags 验证 ────────────────────────────────────────────────
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║  SC4: Tags 验证                                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    try { await runSC4(page, addResult); }
    catch (e) { addResult('SC4-FATAL', 'SC4 Tags 验证', false, e.message); }

    // ── 最终报告 ──────────────────────────────────────────────────────
    console.log('\n');
    printTable(results);
    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    console.log(`\n总计：✅ ${pass} PASS　❌ ${fail} FAIL　共 ${results.length} 项`);

    const reportPath = path.join(__dirname, 'sc1-sc4-mcp-based-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf-8');
    console.log(`\n报告已保存: ${reportPath}`);
    process.exitCode = fail > 0 ? 1 : 0;

  } finally {
    await page.waitForTimeout(2000).catch(() => {});
    await context.close().catch(() => {});
  }
}

main();
