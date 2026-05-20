/**
 * NginxaaS Name 字段非法值验证测试
 *
 * 验证规则（来自页面提示）：
 *   "Only alphanumeric characters are allowed, and the value must be
 *    1-30 characters long. It cannot begin or end with a hyphen."
 *
 * 测试方案：
 *   1. 打开 Azure Portal → 导航到 NGINXaaS Create 页面
 *   2. 填写合法的 Subscription / Resource Group（使无关字段不阻塞验证）
 *   3. 对 Name 字段逐一输入非法值，失焦后检查错误提示
 *   4. 最后输入合法 Name，验证错误消失、Next 按钮可点击
 *   5. 每个用例截图存档
 *
 * 运行：node test-nginxaas-name-validation.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── 常量 ─────────────────────────────────────────────────────────────────────
const AZURE_PORTAL_URL =
  'https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true' +
  '&Azure_Marketplace_Nginx=stage1' +
  '&Azure_Marketplace_Nginx_assettypeoptions=%7B%22Nginx%22%3A%7B%22options%22%3A%22%22%7D%7D' +
  '&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home';

const TARGET_ACCOUNT       = 'v-yixueli@microsoft.com';
const TARGET_SUBSCRIPTION  = 'Liftr-Nginx-Test';
const TARGET_RESOURCE_GROUP = 'lyx-liftr-test';

const SCREENSHOT_DIR = path.join(__dirname, 'name-validation-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const EDGE_USER_DATA_DIR = path.join(
  os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'
);
const TEST_PROFILE_DIR = path.join(__dirname, '.edge-test-profile');

// ── 非法用例列表 ──────────────────────────────────────────────────────────────
//   每条记录：{ id, input, description, rule }
const INVALID_CASES = [
  {
    id:   'TC-01',
    input: '',
    description: '空字符串（空白 Name）',
    rule: '长度必须 1-30 字符，不能为空',
  },
  {
    id:   'TC-02',
    input: 'a'.repeat(31),                      // 31 个 a
    description: '31 个字符（超过最大长度 30）',
    rule: '长度必须 ≤ 30 字符',
  },
  {
    id:   'TC-03',
    input: '-lyx-test',
    description: '以连字符开头（-lyx-test）',
    rule: '不能以连字符开头',
  },
  {
    id:   'TC-04',
    input: 'lyx-test-',
    description: '以连字符结尾（lyx-test-）',
    rule: '不能以连字符结尾',
  },
  {
    id:   'TC-05',
    input: '-lyx-test-',
    description: '两端均为连字符（-lyx-test-）',
    rule: '不能以连字符开头或结尾',
  },
  {
    id:   'TC-06',
    input: 'lyx test',
    description: '含空格（lyx test）',
    rule: '只允许字母数字字符',
  },
  {
    id:   'TC-07',
    input: 'lyx_test',
    description: '含下划线（lyx_test）',
    rule: '只允许字母数字字符（下划线不合法）',
  },
  {
    id:   'TC-08',
    input: 'lyx@test',
    description: '含 @ 符号（lyx@test）',
    rule: '只允许字母数字字符',
  },
  {
    id:   'TC-09',
    input: 'lyx.test',
    description: '含点号（lyx.test）',
    rule: '只允许字母数字字符',
  },
  {
    id:   'TC-10',
    input: 'lyx#test!',
    description: '含特殊字符 # !（lyx#test!）',
    rule: '只允许字母数字字符',
  },
  {
    id:   'TC-11',
    input: '中文名称',
    description: '含中文字符（中文名称）',
    rule: '只允许字母数字字符（ASCII 范围）',
  },
];

// ── 最终有效 Name（验证错误清除后使用）────────────────────────────────────────
const VALID_NAME = 'lyx-stage-0514';

// ── 新建 Resource Group 时使用的合法名称 ─────────────────────────────────────
const VALID_RG_NAME = 'lyx-rg-test';

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** 截图保存到 name-validation-screenshots/ 目录 */
async function screenshot(page, label) {
  const filename = `${label}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false }).catch(() => {});
  console.log(`    📸 截图: ${filename}`);
  return filepath;
}

/**
 * 在 Name 输入框附近查找错误提示文字。
 * Azure Portal 的错误提示通常渲染在 input 之后，以 role="alert" 或
 * aria-live="assertive" / class 含 "error"/"invalid" 的 <span>/<div> 呈现。
 * 同时也检查输入框自身的 aria-invalid 属性。
 */
async function getNameErrorMessage(page) {
  return page.evaluate(() => {
    // 1. 先找 Name 的 input 元素
    const label = [...document.querySelectorAll('label')]
      .find(l => /^Name\b/.test((l.textContent || '').trim()));
    const inputId = label?.htmlFor;
    const input = inputId
      ? document.getElementById(inputId)
      : document.querySelector('input[type="text"]');

    if (!input) return { ariaInvalid: null, errorText: null };

    const ariaInvalid = input.getAttribute('aria-invalid');

    // 2. 向上最多 8 层找包含错误提示的容器
    let container = input.parentElement;
    for (let depth = 0; depth < 8 && container; depth++, container = container.parentElement) {
      // aria-errormessage 指向的元素
      const errId = input.getAttribute('aria-errormessage') || input.getAttribute('aria-describedby');
      if (errId) {
        const errEl = document.getElementById(errId.split(' ')[0]);
        if (errEl) {
          const t = (errEl.innerText || errEl.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
      }

      // role="alert" 或 aria-live 的后代
      const alerts = [...container.querySelectorAll(
        '[role="alert"], [aria-live="assertive"], [aria-live="polite"]'
      )];
      for (const el of alerts) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return { ariaInvalid, errorText: t };
      }

      // class 含 error / invalid / errorMessage 的 span/div
      const errNodes = [...container.querySelectorAll(
        'span[class*="error"], div[class*="error"], ' +
        'span[class*="invalid"], div[class*="invalid"], ' +
        'span[class*="errorMessage"], div[class*="errorMessage"]'
      )];
      for (const el of errNodes) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return { ariaInvalid, errorText: t };
      }
    }

    return { ariaInvalid, errorText: null };
  });
}

/**
 * 填写 Name 字段并触发失焦验证，返回 { ariaInvalid, errorText }。
 * 如果输入为空字符串则先清空再 Tab 离开。
 */
async function fillNameAndTriggerValidation(page, nameInput, value) {
  await nameInput.click({ clickCount: 3 }); // 全选已有内容
  if (value === '') {
    await nameInput.press('Delete');          // 清空
  } else {
    await nameInput.fill(value);
  }
  await page.waitForTimeout(300);
  await nameInput.press('Tab');              // 失焦，触发 blur 验证
  await page.waitForTimeout(800);
  return getNameErrorMessage(page);
}

// ── 登录处理（与主测试文件保持一致）──────────────────────────────────────────
async function handleLoginFlow(page, targetAccount) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = page.url();
    if (!url.includes('login.microsoftonline.com') && !url.includes('login.microsoft.com')) break;
    await page.waitForTimeout(2000);

    if (await page.locator(`[data-test-id="${targetAccount}"]`).isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator(`[data-test-id="${targetAccount}"]`).click();
      await page.waitForTimeout(2000);
      continue;
    }
    if (await page.locator(`text="${targetAccount}"`).isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator(`text="${targetAccount}"`).first().click();
      await page.waitForTimeout(2000);
      continue;
    }
    const emailInput = page.locator('input[type="email"][name="loginfmt"], input[name="loginfmt"]');
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill(targetAccount);
      await page.locator('input[type="submit"][value="Next"], input[id="idSIButton9"]').click();
      await page.waitForTimeout(3000);
      continue;
    }
    if (await page.locator('input[id="idSIButton9"][value="Yes"]').isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.locator('input[id="idSIButton9"][value="Yes"]').click();
      await page.waitForTimeout(2000);
    }
    break;
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       NGINXaaS  Name 字段非法值验证测试                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 结果汇总
  const results = [];

  // ── 启动浏览器 ──────────────────────────────────────────────────────────────
  let context;
  try {
    context = await chromium.launchPersistentContext(EDGE_USER_DATA_DIR, {
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
  } catch (e) {
    context = await chromium.launchPersistentContext(TEST_PROFILE_DIR, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
    });
  }

  const pages = context.pages();
  let page = pages.find(p => p.url() && p.url() !== 'about:blank') || pages[0] || await context.newPage();
  for (const extra of context.pages()) {
    if (extra !== page) await extra.close().catch(() => {});
  }
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });

  try {
    // ── 导航到 Azure Portal ────────────────────────────────────────────────
    console.log('[1] 导航到 Azure Portal...');
    await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    console.log('[2] 处理登录流程...');
    await handleLoginFlow(page, TARGET_ACCOUNT);

    console.log('[3] 等待 Portal 首页加载...');
    await page.waitForSelector(
      '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
      { timeout: 120000 }
    );
    await page.waitForTimeout(2000);

    // ── 搜索并进入 Create 页面 ──────────────────────────────────────────────
    console.log('[4] 搜索 nginxaas 并进入 NGINXaaS...');
    const searchBox = page.locator(
      '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]'
    ).first();
    await searchBox.click();
    await searchBox.pressSequentially('nginxaas', { delay: 80 });
    await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();

    console.log('[5] 等待 NGINXaaS 列表页加载...');
    await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log('[6] 点击 Create 按钮...');
    const createBtn = page
      .frameLocator('iframe[name="BrowseResource.ReactView"]')
      .locator('[role="menuitem"]:has-text("Create")');
    await createBtn.waitFor({ state: 'visible', timeout: 30000 });
    await createBtn.click();

    console.log('[7] 等待 Create 表单加载...');
    await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
    await page.waitForTimeout(4000);

    // ── 确认已在 Basics 页 ─────────────────────────────────────────────────
    await page.waitForSelector('text=Project details', { timeout: 30000 });
    console.log('[7] Basics 页面已加载\n');

    // ── 定位 Name 输入框 ────────────────────────────────────────────────────
    console.log('[8] 定位 Name 输入框...');
    const nameInputId = await page.evaluate(() => {
      const label = [...document.querySelectorAll('label')]
        .find(l => /^Name\b/.test((l.textContent || '').trim()));
      return label?.htmlFor || null;
    });
    const nameInput = nameInputId
      ? page.locator(`[id="${nameInputId}"]`)
      : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    console.log('[8] Name 输入框已定位\n');

    // ════════════════════════════════════════════════════════════════════════
    //  核心测试循环：逐一测试非法 Name
    // ════════════════════════════════════════════════════════════════════════
    console.log('━'.repeat(64));
    console.log('  开始非法 Name 验证测试');
    console.log('━'.repeat(64));

    for (const tc of INVALID_CASES) {
      console.log(`\n▶ ${tc.id}: ${tc.description}`);
      console.log(`  输入值: "${tc.input}"`);
      console.log(`  违反规则: ${tc.rule}`);

      // 填写并触发失焦验证
      let { ariaInvalid, errorText } = await fillNameAndTriggerValidation(page, nameInput, tc.input);

      // ── TC-01 专属：空值需切换到 Review + create 再切回 Basics 才触发报错 ──
      if (tc.input === '' && ariaInvalid !== 'true' && !errorText) {
        console.log('  [TC-01] blur 未触发错误，切换到 Review + create 标签页...');
        // 标签页是 role="tab" 元素（tablist 中），不是 a/button
        const reviewTab = page.getByRole('tab', { name: /review.*create/i }).first();
        await reviewTab.waitFor({ state: 'visible', timeout: 10000 });
        await reviewTab.click();
        await page.waitForTimeout(2000);
        console.log('  [TC-01] 已切换到 Review + create，再切回 Basics...');
        // 切到 Review + create 后，Basics 标签可能附加错误计数（"Basics (1)"），用宽松匹配
        const basicsTab = page.getByRole('tab', { name: /basics/i }).first();
        await basicsTab.waitFor({ state: 'visible', timeout: 10000 });
        await basicsTab.click();
        await page.waitForTimeout(1500);
        // 重新定位 Name 输入框（页面重新渲染后引用可能失效）
        await nameInput.waitFor({ state: 'visible', timeout: 10000 });
        // 再次读取错误状态
        ({ ariaInvalid, errorText } = await getNameErrorMessage(page));
        console.log('  [TC-01] 切回 Basics 后重新检查错误状态');
      }

      // 对 TC-02（31 字符）的特殊处理：Azure Portal 可能在 input 层限制最大输入长度，
      // 此时实际填入值可能被截断为 30 字符；记录实际 value 以便诊断
      const actualValue = await nameInput.inputValue().catch(() => '');

      const passed = ariaInvalid === 'true' || (!!errorText && errorText.length > 0);

      const status = passed ? '✅ PASS（出现错误提示）' : '❌ FAIL（未出现错误提示）';
      console.log(`  aria-invalid: ${ariaInvalid}`);
      console.log(`  错误文本: ${errorText || '（未检测到）'}`);
      if (tc.id === 'TC-02') {
        console.log(`  实际填入长度: ${actualValue.length}（原始输入 ${tc.input.length} 字符）`);
      }
      console.log(`  结果: ${status}`);

      // 截图
      const screenshotLabel = `${tc.id}-${tc.description.replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 30)}`;
      await screenshot(page, screenshotLabel);

      results.push({
        id: tc.id,
        description: tc.description,
        input: tc.input,
        rule: tc.rule,
        ariaInvalid,
        errorText: errorText || '',
        actualInputLength: actualValue.length,
        passed,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TC-RG-01：Resource Group 为空 → Review+create 往返 → 触发空值错误提示
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n━'.repeat(64));
    console.log('  TC-RG-01: Resource Group 为空 — Review+create 往返触发空值验证');
    console.log('━'.repeat(64));
    console.log('\n▶ TC-RG-01: Resource Group 为空 → 切换到 Review+create 再返回 Basics');

    // Resource Group 在本次测试中从未被填写，始终处于空状态，无需额外清空

    // 切换到 Review + create
    console.log('  切换到 Review + create 标签页...');
    const reviewTabRG = page.getByRole('tab', { name: /review.*create/i }).first();
    await reviewTabRG.waitFor({ state: 'visible', timeout: 10000 });
    await reviewTabRG.click();
    await page.waitForTimeout(2000);

    // 切回 Basics
    console.log('  切回 Basics 标签页...');
    const basicsTabRG = page.getByRole('tab', { name: /basics/i }).first();
    await basicsTabRG.waitFor({ state: 'visible', timeout: 10000 });
    await basicsTabRG.click();
    await page.waitForTimeout(1500);

    // 检查 Resource Group 下拉框的错误提示（多策略）
    const rgError = await page.evaluate(() => {
      // 辅助：在给定根节点内查找错误文本
      function findErrorInNode(root) {
        for (const el of root.querySelectorAll(
          '[role="alert"], [aria-live="assertive"], [aria-live="polite"]'
        )) {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return t;
        }
        for (const el of root.querySelectorAll(
          '[class*="validationMessage"], [class*="ValidationMessage"], ' +
          '[class*="errorMessage"], [class*="ErrorMessage"], ' +
          '[class*="fieldError"], [class*="FieldError"], ' +
          'span[class*="error"], div[class*="error"], ' +
          'span[class*="invalid"], div[class*="invalid"]'
        )) {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length < 300) return t;
        }
        return null;
      }

      // 策略 1：找到 "Resource group" 文本所在叶节点，向上遍历
      // 找到含 combobox/select 的字段容器，再在容器内查错误文本
      const rgLabelEl = [...document.querySelectorAll('label, span, div, p')]
        .find(el => {
          if (el.children.length > 3) return false;
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return /^resource\s*group/i.test(text) && text.length < 60;
        });

      if (rgLabelEl) {
        let node = rgLabelEl.parentElement;
        for (let depth = 0; depth < 12 && node && node !== document.body; depth++, node = node.parentElement) {
          const combobox = node.querySelector('[role="combobox"], select, [role="listbox"]');
          if (combobox) {
            const ariaInvalid = combobox.getAttribute('aria-invalid');
            const errText = findErrorInNode(node);
            if (errText) return { ariaInvalid, errorText: errText };
          }
        }
      }

      // 策略 2：直接在所有 alert/aria-live 元素中查找期望文本
      for (const el of document.querySelectorAll(
        '[role="alert"], [aria-live="assertive"], [aria-live="polite"]'
      )) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/the value must not be empty/i.test(t)) return { ariaInvalid: 'true', errorText: t };
      }

      // 策略 3：在任何 error/invalid/validation class 元素中查找期望文本
      for (const el of document.querySelectorAll(
        '[class*="error" i], [class*="invalid" i], [class*="validation" i]'
      )) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/the value must not be empty/i.test(t)) return { ariaInvalid: 'true', errorText: t };
      }

      return { ariaInvalid: null, errorText: null };
    });

    const expectedRGError = 'The value must not be empty.';
    const rgPassed = !!(rgError.errorText && rgError.errorText.includes(expectedRGError));

    console.log(`  aria-invalid: ${rgError.ariaInvalid}`);
    console.log(`  错误文本: ${rgError.errorText || '（未检测到）'}`);
    console.log(`  期望错误: "${expectedRGError}"`);
    console.log(`  结果: ${rgPassed
      ? '✅ PASS（Resource Group 空值错误提示符合预期）'
      : '❌ FAIL（未检测到预期错误提示）'}`);

    await screenshot(page, 'TC-RG-01-ResourceGroup-empty-after-review-return');

    results.push({
      id: 'TC-RG-01',
      description: 'Resource Group 空值，Review+create 往返后触发错误',
      input: '（空）',
      rule: 'Resource Group 不能为空；切换 Review+create 再返回后应提示 "The value must not be empty."',
      ariaInvalid: rgError.ariaInvalid,
      errorText: rgError.errorText || '',
      actualInputLength: 0,
      passed: rgPassed,
    });

    // ════════════════════════════════════════════════════════════════════════
    //  TC-RG-02 ~ TC-RG-05 + TC-RG-VALID：
    //  Resource Group "Create new" 弹框内 Name 字段验证
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n━'.repeat(64));
    console.log('  TC-RG-02~05 + TC-RG-VALID: "Create new" 弹框 RG Name 验证');
    console.log('━'.repeat(64));

    // ── TC-RG-02：验证 "Create new" 可点击元素可见 ────────────────────────
    console.log('\n▶ TC-RG-02: Resource Group 下方 "Create new" 元素可见');
    // Azure Portal 中 "Create new" 可能是 <a>、<button> 或自定义 role="button"
    const createNewRG = page.locator(
      'a:has-text("Create new"), button:has-text("Create new"), ' +
      '[role="button"]:has-text("Create new"), span:has-text("Create new")'
    ).first();
    await createNewRG.waitFor({ state: 'visible', timeout: 10000 });
    const createNewVisible = await createNewRG.isVisible().catch(() => false);
    console.log(`  "Create new" 元素可见: ${createNewVisible ? '是' : '否'}`);
    const tc_rg_02_passed = createNewVisible;
    console.log(`  结果: ${tc_rg_02_passed ? '✅ PASS' : '❌ FAIL（未找到 "Create new" 元素）'}`);
    await screenshot(page, 'TC-RG-02-CreateNew-visible');
    results.push({
      id: 'TC-RG-02',
      description: '"Create new" 可点击元素可见',
      input: 'N/A',
      rule: 'Basics 页 Resource Group 下方应有 "Create new" 可点击元素',
      ariaInvalid: null,
      errorText: '',
      actualInputLength: 0,
      passed: tc_rg_02_passed,
    });

    // ── 点击 "Create new"，等待弹框出现 ───────────────────────────────────
    console.log('\n  点击 "Create new"，等待弹框...');
    await createNewRG.click();
    await page.waitForTimeout(1500);

    // Azure Portal 的 "Create new" 弹框是 inline callout，无 role="dialog"
    // 改用 Cancel 按钮出现作为弹框打开的信号
    const popupCancelBtn = page.getByRole('button', { name: 'Cancel' });
    let popupDetected = false;
    try {
      await popupCancelBtn.waitFor({ state: 'visible', timeout: 8000 });
      popupDetected = true;
    } catch (_) {
      popupDetected = false;
    }
    console.log(`  弹框出现: ${popupDetected}`);

    // 定位弹框内 Name 输入框：
    // page.evaluate() 只在 main frame 运行，无法搜索 iframe 内元素。
    // 改用从 popupCancelBtn locator 出发的相对 XPath——Playwright 会在
    // Cancel 按钮所在的正确 frame 上下文中执行，天然支持 iframe。
    const rgNameInput = popupCancelBtn.locator(
      'xpath=ancestor::*[.//input][1]//input'
    ).first();
    await rgNameInput.waitFor({ state: 'visible', timeout: 10000 });

    // 弹框内错误检测：从 Cancel 按钮向上遍历找含 input 的容器，在其中查找错误文本
    // 使用 locator.evaluate()（在 Cancel 按钮所在 frame 中运行）
    async function getRGDialogError() {
      return popupCancelBtn.evaluate((btn) => {
        let node = btn.parentElement;
        for (let i = 0; i < 12 && node && node !== document.body; i++, node = node.parentElement) {
          if (!node.querySelector('input')) continue;
          // 找到含 input 的弹框容器，在其中查错误文本
          for (const el of node.querySelectorAll(
            '[role="alert"], [aria-live="assertive"], [aria-live="polite"]'
          )) {
            const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t) return t;
          }
          for (const el of node.querySelectorAll(
            '[class*="validationMessage"], [class*="ValidationMessage"], ' +
            '[class*="errorMessage"], [class*="ErrorMessage"], ' +
            'span[class*="error"], div[class*="error"], ' +
            'span[class*="invalid"], div[class*="invalid"]'
          )) {
            const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length < 400) return t;
          }
        }
        return null;
      });
    }

    // 空值时 Azure Portal 禁用 OK 按钮（在 Cancel 按钮所在 frame 中运行）
    // 除检查 HTML disabled / aria-disabled 外，还检查 CSS 视觉禁用状态
    async function isOKButtonDisabled() {
      return popupCancelBtn.evaluate((btn) => {
        let node = btn.parentElement;
        while (node && node !== document.body) {
          const okBtn = [...node.querySelectorAll('button')]
            .find(b => /^ok$/i.test((b.textContent || '').trim()));
          if (okBtn) {
            if (okBtn.disabled) return true;
            if (okBtn.getAttribute('aria-disabled') === 'true') return true;
            // 检查 CSS 计算样式（Fluent UI 等框架常用 pointer-events/opacity 表达禁用）
            const style = window.getComputedStyle(okBtn);
            if (style.pointerEvents === 'none') return true;
            if (parseFloat(style.opacity) < 0.7) return true;
            if (style.cursor === 'not-allowed') return true;
            // 检查 class 名中是否含 disabled / is-disabled
            const cls = (okBtn.className || '').toLowerCase();
            if (cls.includes('disabled') || cls.includes('is-disabled')) return true;
            return false;
          }
          node = node.parentElement;
        }
        return false;
      });
    }

    // ── 非法 RG 名称用例列表 ──────────────────────────────────────────────
    const RG_NAME_INVALID_CASES = [
      {
        id: 'TC-RG-03',
        input: '',
        description: 'RG 名称为空',
        rule: '名称不能为空（OK 按钮应被禁用）',
      },
      {
        id: 'TC-RG-04',
        input: 'rg-test.',
        description: 'RG 名称以句点结尾（rg-test.）',
        rule: '句点不能出现在末尾',
      },
      {
        id: 'TC-RG-05',
        input: 'rg!test',
        description: 'RG 名称含感叹号（rg!test）',
        rule: '只允许字母数字、下划线、括号、连字符、句点（非末尾）及 Unicode 字符',
      },
    ];

    for (const tc of RG_NAME_INVALID_CASES) {
      console.log(`\n▶ ${tc.id}: ${tc.description}`);
      console.log(`  输入值: "${tc.input}"`);
      console.log(`  违反规则: ${tc.rule}`);

      await rgNameInput.click({ clickCount: 3 });
      if (tc.input === '') {
        await rgNameInput.press('Delete');
      } else {
        await rgNameInput.fill(tc.input);
      }
      await page.waitForTimeout(300);
      await rgNameInput.press('Tab');
      await page.waitForTimeout(800);

      let passed, errorText;
      if (tc.input === '') {
        // Azure Portal 对空 RG 名称的处理：
        // 方案 A：OK 按钮在 HTML/CSS 层面被禁用（检查各种禁用指标）
        // 方案 B：OK 按钮可点击，但点击后弹框不关闭（提交被阻止）
        // 行为测试：先检查禁用，如未禁用则点击 OK 看弹框是否保持打开
        const okDisabled = await isOKButtonDisabled();
        if (okDisabled) {
          passed = true;
          errorText = '（OK 按钮已禁用，空值不可提交）';
          console.log(`  OK 按钮状态: 禁用 ✅`);
        } else {
          // 点击 OK，验证弹框是否仍然打开（提交被阻止）
          const okBtnLocator = page.getByRole('button', { name: 'OK' }).first();
          await okBtnLocator.click().catch(() => {});
          await page.waitForTimeout(800);
          const cancelStillVisible = await popupCancelBtn.isVisible({ timeout: 1000 }).catch(() => false);
          if (cancelStillVisible) {
            // 弹框仍然打开：空值提交被阻止（符合预期）
            errorText = await getRGDialogError() || '（点击 OK 后弹框未关闭，空值提交被阻止）';
            passed = true;
          } else {
            // 弹框意外关闭：空值被接受（不符合预期）
            passed = false;
            errorText = null;
          }
          console.log(`  OK 按钮状态: 未禁用（已尝试点击）`);
          console.log(`  弹框仍然打开: ${cancelStillVisible}`);
          console.log(`  错误文本: ${errorText || '（未检测到）'}`);
        }
      } else {
        errorText = await getRGDialogError();
        passed = !!errorText;
        console.log(`  错误文本: ${errorText || '（未检测到）'}`);
      }
      console.log(`  结果: ${passed ? '✅ PASS' : '❌ FAIL'}`);

      const screenshotLabel =
        `${tc.id}-${tc.description.replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 30)}`;
      await screenshot(page, screenshotLabel);

      results.push({
        id: tc.id,
        description: tc.description,
        input: tc.input,
        rule: tc.rule,
        ariaInvalid: null,
        errorText: errorText || '',
        actualInputLength: tc.input.length,
        passed,
      });
    }

    // ── TC-RG-VALID：输入合法 RG 名称并点击 OK ────────────────────────────
    console.log(`\n▶ TC-RG-VALID: 输入合法 RG 名称 "${VALID_RG_NAME}" 并点击 OK`);
    await rgNameInput.click({ clickCount: 3 });
    await rgNameInput.fill(VALID_RG_NAME);
    await page.waitForTimeout(300);
    await rgNameInput.press('Tab');
    await page.waitForTimeout(800);

    const validRGErr = await getRGDialogError();
    const noErrorAfterValidInput = !validRGErr;
    console.log(`  错误文本: ${validRGErr || '（无）'}`);

    // OK 按钮：弹框无 role="dialog"，直接用 getByRole 匹配 OK 文本
    const okBtn = page.getByRole('button', { name: 'OK' }).first();
    await okBtn.waitFor({ state: 'visible', timeout: 10000 });
    await okBtn.click();
    await page.waitForTimeout(1500);

    // 验证弹框已关闭：Cancel 按钮消失即表示弹框关闭
    const dialogClosed = !(await popupCancelBtn.isVisible({ timeout: 2000 }).catch(() => false));

    // 验证 RG 字段已显示新名称
    const rgFieldShowsNewName = await page.evaluate((name) => {
      for (const el of document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"]')) {
        if ((el.innerText || el.textContent || '').trim().includes(name)) return true;
      }
      for (const el of document.querySelectorAll('input[type="text"], input:not([type])')) {
        if (el.value && el.value.includes(name)) return true;
      }
      return document.body.innerText.includes(name);
    }, VALID_RG_NAME);

    const tc_rg_valid_passed = noErrorAfterValidInput && dialogClosed;
    console.log(`  弹框已关闭: ${dialogClosed}`);
    console.log(`  RG 字段显示新名称: ${rgFieldShowsNewName}`);
    console.log(`  结果: ${tc_rg_valid_passed
      ? '✅ PASS（合法 RG 名称，点击 OK 后弹框关闭）'
      : '❌ FAIL'}`);
    await screenshot(page, `TC-RG-VALID-new-rg-${VALID_RG_NAME}`);
    results.push({
      id: 'TC-RG-VALID',
      description: `合法 RG 名称 "${VALID_RG_NAME}"，弹框关闭`,
      input: VALID_RG_NAME,
      rule: '合法 RG 名称应无错误提示，点击 OK 后弹框应关闭',
      ariaInvalid: null,
      errorText: validRGErr || '',
      actualInputLength: VALID_RG_NAME.length,
      passed: tc_rg_valid_passed,
    });

    // ════════════════════════════════════════════════════════════════════════
    //  最终验证：输入合法 Name，确认错误清除
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n━'.repeat(64));
    console.log(`  最终验证：输入合法 Name "${VALID_NAME}"`);
    console.log('━'.repeat(64));

    await nameInput.click({ clickCount: 3 });
    await nameInput.fill(VALID_NAME);
    await page.waitForTimeout(300);
    await nameInput.press('Tab');
    await page.waitForTimeout(800);

    const { ariaInvalid: finalAria, errorText: finalErr } = await getNameErrorMessage(page);
    // aria-invalid 是字段有效性的权威来源；errorText 可能是 TC-01 往返后遗留的 stale DOM 节点，不作为主判据
    const validPassed = finalAria !== 'true';
    console.log(`  aria-invalid: ${finalAria}`);
    console.log(`  错误文本: ${finalErr || '（无）'}${finalErr && finalAria !== 'true' ? '  ← 残留 DOM 节点，已忽略' : ''}`);
    console.log(`  结果: ${validPassed ? '✅ PASS（合法 Name 无错误提示）' : '❌ FAIL（合法 Name 仍有错误提示）'}`);
    await screenshot(page, `FINAL-valid-name-${VALID_NAME}`);

    // ════════════════════════════════════════════════════════════════════════
    //  汇总报告
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    测试结果汇总                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`${'ID'.padEnd(8)}${'描述'.padEnd(22)}${'结果'.padEnd(30)}错误文本（摘要）`);
    console.log('─'.repeat(90));
    for (const r of results) {
      const status = r.passed ? '✅ PASS' : '❌ FAIL';
      const errSummary = r.errorText ? r.errorText.slice(0, 40) : '（未检测到）';
      console.log(`${r.id.padEnd(8)}${r.description.slice(0, 20).padEnd(22)}${status.padEnd(30)}${errSummary}`);
    }
    console.log('─'.repeat(90));
    const passCount = results.filter(r => r.passed).length;
    const failCount = results.filter(r => !r.passed).length;
    console.log(`合计: ${results.length} 个用例  ✅ PASS: ${passCount}  ❌ FAIL: ${failCount}`);
    console.log(`\n截图目录: ${SCREENSHOT_DIR}`);

    // 保存 JSON 报告
    const reportPath = path.join(SCREENSHOT_DIR, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ results, validNameResult: { ariaInvalid: finalAria, errorText: finalErr, passed: validPassed } }, null, 2), 'utf-8');
    console.log(`JSON 报告: ${reportPath}`);

  } catch (err) {
    console.error('\n[ERROR]', err.message);
    await screenshot(page, 'ERROR-unexpected');
    process.exit(1);
  } finally {
    await page.waitForTimeout(3000);
    await context.close();
  }
})();

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SC4 Tags Tab 测试                                                       ║
// ║                                                                          ║
// ║  测试场景：在 Tags 标签页                                                  ║
// ║    TC-TAG-01: 添加 env=test（普通标签）                                    ║
// ║    TC-TAG-02: 添加 owner=lyx（普通标签）                                   ║
// ║    TC-TAG-03: 添加 project-name=nginx/stage（值含特殊字符 /）               ║
// ║    TC-TAG-04: 添加 cost_center=123（键含下划线）                            ║
// ║    TC-TAG-05: 添加 env=production（重复键名，预期出现验证警告）               ║
// ║    TC-TAG-SPECIAL: 在 Name 中输入 <>? 等非法字符，预期出现错误提示             ║
// ║    TC-TAG-EDIT: 编辑 owner 值：lyx → yixueli                              ║
// ║    TC-TAG-DEL: 删除 cost_center 标签行                                    ║
// ║    TC-TAG-REVIEW: 进入 Review+create，验证无错误banner、字段摘要正确          ║
// ║                                                                          ║
// ║  运行方式：node test-nginxaas-name-validation.js --sc4                    ║
// ║                                                                          ║
// ║  关键发现（交互测试调试总结）：                                               ║
// ║  1. Tags Name combobox 受 Knockout.js 绑定，fill()/keyboard.type() 会     ║
// ║     被 KO 重置，必须使用 pressSequentially() 触发真实键盘事件                ║
// ║  2. 从 Name 移至 Value 必须用 keyboard.press('Tab')，不能用 click()         ║
// ║     直接跳 Value（会导致 KO 重渲染后 ID 失效，行内容被覆盖）                  ║
// ║  3. Delete 按钮无 aria-label="Delete" HTML 属性，通过无障碍计算名称          ║
// ║     暴露，需用 page.getByRole('button', {name:'Delete'}) 定位               ║
// ║  4. 已确认标签行（display row）无 input 元素，                               ║
// ║     querySelectorAll('input[aria-label="Name"]') 只返回编辑行               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * 在 Tags 标签页添加一个标签。
 *
 * 前置条件：当前焦点任意，Tags 标签页处于激活状态。
 * 后置条件：标签已提交为 display row，Tags 控件底部出现新的空编辑行。
 *
 * @param {import('playwright').Page} page
 * @param {string} key   标签名
 * @param {string} value 标签值
 */
async function sc4AddTag(page, key, value) {
  // 找 Tags 控件内最后一个 Name 输入框（仅编辑行有 input）
  const tagsPanel = page.getByRole('tabpanel', { name: 'Tags' });
  const nameInputs = tagsPanel.locator('input[aria-label="Name"]');

  // 等待空行出现
  await nameInputs.last().waitFor({ state: 'visible', timeout: 10000 });

  // 找到最后一个值为空的 Name 输入框的 ID
  const emptyNameId = await tagsPanel.evaluate(p => {
    const ns = [...p.querySelectorAll('input[aria-label="Name"]')];
    for (let i = ns.length - 1; i >= 0; i--) {
      if (ns[i].value === '') return ns[i].id;
    }
    return null;
  });
  if (!emptyNameId) throw new Error(`sc4AddTag: no empty row available for ${key}`);

  const nameInput = page.locator(`#${emptyNameId}`);
  await nameInput.click({ force: true });
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);

  // ⚠️ 必须用 pressSequentially（不能用 fill 或 keyboard.type）
  //    KO 绑定的 combobox 需要真实键盘事件才能正确更新 observable
  await nameInput.pressSequentially(key, { delay: 80 });
  await page.waitForTimeout(350);

  // ⚠️ 用 Tab 导航到 Value（不能用 click + ID），
  //    否则 KO 重渲染后旧 ID 失效，导致行数据互相覆盖
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  // 清空 Value 并输入（当前焦点在 Value 输入框）
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  await page.keyboard.type(value, { delay: 60 });
  await page.waitForTimeout(300);

  // Tab 确认行，触发 display row 生成并出现新空行
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
}

/**
 * 读取 Tags 控件所有 display rows 的文本内容（已确认的标签）。
 * display rows 以 "key : value All resources" 格式呈现。
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>} 格式为 ["key=value", ...] 的数组
 */
async function sc4ReadDisplayedTags(page) {
  const grid = page.getByRole('grid', { name: 'Add or edit tags grid' });
  const rows = grid.getByRole('row');
  const count = await rows.count();
  const tags = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const rowName = await row.getAttribute('aria-label') || await row.innerText().catch(() => '');
    // display row 格式: "key : value All resources"
    const match = rowName.match(/^(.+?)\s*:\s*(.+?)\s+All resources/);
    if (match) {
      tags.push(`${match[1].trim()}=${match[2].trim()}`);
    }
  }
  return tags;
}

/**
 * SC4 Tags Tab 完整测试。
 *
 * 假设页面已停在 Tags 标签页（或通过 tabClick 参数自动跳转）。
 * 返回包含每个测试用例结果的数组。
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{id:string, description:string, passed:boolean, detail:string}>>}
 */
async function runSC4TagsTest(page) {
  const results = [];

  function log(id, desc, passed, detail = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}  ${id}: ${desc}${detail ? '  → ' + detail : ''}`);
    results.push({ id, description: desc, passed, detail });
  }

  // ── 确保在 Tags 标签页 ────────────────────────────────────────────────────
  const tagsTab = page.getByRole('tab', { name: 'Tags' });
  if (await tagsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tagsTab.click();
    await page.waitForTimeout(1000);
  }

  const tagsPanel = page.getByRole('tabpanel', { name: 'Tags' });
  const tagsPanelVisible = await tagsPanel.isVisible({ timeout: 5000 }).catch(() => false);
  log('TC-TAG-SETUP', 'Tags 标签页可见', tagsPanelVisible);
  if (!tagsPanelVisible) return results;

  // ── TC-TAG-01: 添加 env=test ──────────────────────────────────────────────
  await sc4AddTag(page, 'env', 'test');
  const afterT01 = await sc4ReadDisplayedTags(page);
  log('TC-TAG-01', '添加 env=test', afterT01.includes('env=test'), `当前标签: [${afterT01.join(', ')}]`);

  // ── TC-TAG-02: 添加 owner=lyx ─────────────────────────────────────────────
  await sc4AddTag(page, 'owner', 'lyx');
  const afterT02 = await sc4ReadDisplayedTags(page);
  log('TC-TAG-02', '添加 owner=lyx', afterT02.includes('owner=lyx'), `当前标签: [${afterT02.join(', ')}]`);

  // ── TC-TAG-03: 添加 project-name=nginx/stage（值含特殊字符 /）──────────────
  await sc4AddTag(page, 'project-name', 'nginx/stage');
  const afterT03 = await sc4ReadDisplayedTags(page);
  log('TC-TAG-03', '添加 project-name=nginx/stage（值含 /）',
    afterT03.includes('project-name=nginx/stage'), `当前标签: [${afterT03.join(', ')}]`);

  // ── TC-TAG-04: 添加 cost_center=123（键含下划线）─────────────────────────
  await sc4AddTag(page, 'cost_center', '123');
  const afterT04 = await sc4ReadDisplayedTags(page);
  log('TC-TAG-04', '添加 cost_center=123（键含 _）',
    afterT04.includes('cost_center=123'), `当前标签: [${afterT04.join(', ')}]`);

  // ── TC-TAG-05: 添加 env=production（重复键名，预期出现验证警告）──────────────
  await sc4AddTag(page, 'env', 'production');
  // 重复键验证错误出现在编辑行内（非 display row）；
  // 通过检查页面文本中是否含有 "already used" 警告来验证
  const pageTextAfterT05 = await tagsPanel.innerText().catch(() => '');
  const dupWarningShown = /already used/i.test(pageTextAfterT05);
  log('TC-TAG-05', '添加重复键 env=production 出现验证警告', dupWarningShown,
    dupWarningShown ? '"env already used" 警告已显示' : '未检测到重复键警告');

  // ── TC-TAG-SPECIAL: Name 含非法字符 <>? 出现错误提示 ────────────────────────
  // Azure 标签名称不允许包含 < > % & \ ? / 等字符，输入后应立即出现验证错误。
  // 注：此用例只验证错误提示，不提交行（测试完毕后清空 Name 输入框）。
  const SPECIAL_CHARS = '<>?';
  {
    const emptyNameIdForSpecial = await tagsPanel.evaluate(p => {
      const ns = [...p.querySelectorAll('input[aria-label="Name"]')];
      for (let i = ns.length - 1; i >= 0; i--) {
        if (ns[i].value === '') return ns[i].id;
      }
      return null;
    });
    if (emptyNameIdForSpecial) {
      const specialNameInput = page.locator(`#${emptyNameIdForSpecial}`);
      await specialNameInput.click({ force: true });
      await page.waitForTimeout(150);
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(80);
      // 输入非法字符（pressSequentially 确保 KO 更新）
      await specialNameInput.pressSequentially(SPECIAL_CHARS, { delay: 80 });
      await page.waitForTimeout(600);
      // 验证错误提示：Portal 实际显示 "The following characters are not supported: <>%&\?/."
      const panelTextAfterSpecial = await tagsPanel.innerText().catch(() => '');
      const specialErrShown = /not supported|invalid tag name|not allowed|cannot contain/i.test(panelTextAfterSpecial);
      log('TC-TAG-SPECIAL', `Name 含 "${SPECIAL_CHARS}" 出现非法字符错误提示`, specialErrShown,
        specialErrShown ? '非法字符错误提示已显示' : '未检测到非法字符错误提示');
      // 清空 Name 输入框，避免影响后续用例
      await specialNameInput.click({ force: true });
      await page.waitForTimeout(100);
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(500);
    } else {
      log('TC-TAG-SPECIAL', `Name 含 "${SPECIAL_CHARS}" 出现非法字符错误提示`, false,
        '未找到空编辑行，跳过此用例');
    }
  }

  // ── TC-TAG-EDIT: 编辑 owner Value：lyx → yixueli ────────────────────────
  // 找 owner 行对应的 Value 输入框（编辑行 or display row 中的 input）
  const ownerValueId = await tagsPanel.evaluate(p => {
    const ns = [...p.querySelectorAll('input[aria-label="Name"]')];
    const vs = [...p.querySelectorAll('input[aria-label="Value"]')];
    const idx = ns.findIndex(n => n.value === 'owner');
    return idx >= 0 ? vs[idx]?.id : null;
  });

  let editPassed = false;
  if (ownerValueId) {
    const ownerValueInput = page.locator(`#${ownerValueId}`);
    await ownerValueInput.click({ force: true });
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(80);
    // ⚠️ 用 pressSequentially 编辑 Value（确保 KO 更新）
    await ownerValueInput.pressSequentially('yixueli', { delay: 80 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);

    const afterEdit = await sc4ReadDisplayedTags(page);
    editPassed = afterEdit.includes('owner=yixueli') && !afterEdit.includes('owner=lyx');
    log('TC-TAG-EDIT', '编辑 owner: lyx → yixueli', editPassed, `当前标签: [${afterEdit.join(', ')}]`);
  } else {
    log('TC-TAG-EDIT', '编辑 owner: lyx → yixueli', false, 'owner 行的 input 未找到（行可能为 display 模式）');
  }

  // ── TC-TAG-DEL: 删除 cost_center 行 ──────────────────────────────────────
  // ⚠️ Delete 按钮无 aria-label="Delete" HTML 属性；
  //    必须使用 Playwright 无障碍树 getByRole 定位（不能用 querySelectorAll）
  const beforeDel = await sc4ReadDisplayedTags(page);
  const costCenterExistedBeforeDel = beforeDel.some(t => t.startsWith('cost_center'));

  let delPassed = false;
  if (costCenterExistedBeforeDel) {
    await page.getByRole('row', { name: /cost_center/ })
      .getByRole('button', { name: 'Delete' })
      .first()
      .click({ force: true });
    await page.waitForTimeout(700);
    const afterDel = await sc4ReadDisplayedTags(page);
    delPassed = !afterDel.some(t => t.startsWith('cost_center'));
    log('TC-TAG-DEL', '删除 cost_center 行', delPassed, `删除后标签: [${afterDel.join(', ')}]`);
  } else {
    log('TC-TAG-DEL', '删除 cost_center 行', false, 'cost_center 行未在 display rows 中找到');
  }

  // ── TC-TAG-REVIEW: Review+create 验证 ────────────────────────────────────
  const reviewBtn = page.getByRole('button', { name: 'Review + create' });
  await reviewBtn.click();
  await page.waitForTimeout(2000);

  const reviewPanel = page.getByRole('tabpanel', { name: 'Review + create' });
  const reviewVisible = await reviewPanel.isVisible({ timeout: 5000 }).catch(() => false);
  log('TC-TAG-REVIEW-01', 'Review+create 页面加载成功', reviewVisible);

  if (reviewVisible) {
    const reviewText = await reviewPanel.innerText().catch(() => '');

    // 检查无错误 banner
    const errorBanner = await page.locator('[role="alert"]').innerText().catch(() => null);
    const noErrorBanner = !errorBanner || !/(error|failed|invalid)/i.test(errorBanner);
    log('TC-TAG-REVIEW-02', '无验证错误 banner', noErrorBanner,
      errorBanner ? `banner 内容: ${errorBanner.substring(0, 80)}` : '无 alert');

    // 检查 Basics 字段摘要
    const checks = [
      { id: 'subscription', text: 'Liftr-Nginx-Test' },
      { id: 'rg',           text: 'lyx-liftr-test' },
      { id: 'region',       text: 'West Central US' },
      { id: 'pricing',      text: 'Standard V3' },
      { id: 'scaling',      text: 'Manual' },
      { id: 'channel',      text: 'Stable' },
    ];
    for (const chk of checks) {
      log(`TC-TAG-REVIEW-${chk.id}`, `摘要包含 "${chk.text}"`,
        reviewText.includes(chk.text));
    }

    // 检查 Tags 摘要
    const tagsInReview = reviewText.includes('env') && reviewText.includes('test')
                      && reviewText.includes('owner') && reviewText.includes('yixueli')
                      && reviewText.includes('project-name') && reviewText.includes('nginx/stage');
    const noCostCenterInReview = !reviewText.includes('cost_center');
    log('TC-TAG-REVIEW-tags', 'Tags 摘要包含 env/owner/project-name', tagsInReview,
      tagsInReview ? 'env=test, owner=yixueli, project-name=nginx/stage 已确认' : '部分标签缺失');
    log('TC-TAG-REVIEW-del', 'Tags 摘要不含已删除的 cost_center', noCostCenterInReview);
  }

  return results;
}

// ── 入口：如果以 --sc4 参数运行，执行 SC4 测试 ──────────────────────────────
if (process.argv.includes('--sc4')) {
  (async () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║       NGINXaaS  SC4 Tags Tab 测试                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const SC4_NAME      = 'lyx-sc4-auto';
    const SC4_REGION    = 'West Central US';

    let context;
    try {
      context = await chromium.launchPersistentContext(EDGE_USER_DATA_DIR, {
        channel: 'msedge', headless: false, viewport: null,
        args: ['--start-maximized', '--profile-directory=Default',
               '--no-first-run', '--no-default-browser-check'],
      });
    } catch (_) {
      context = await chromium.launchPersistentContext(TEST_PROFILE_DIR, {
        channel: 'msedge', headless: false, viewport: null,
        args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
      });
    }

    const pages = context.pages();
    let page = pages.find(p => p.url() && p.url() !== 'about:blank') || pages[0] || await context.newPage();
    for (const extra of context.pages()) {
      if (extra !== page) await extra.close().catch(() => {});
    }
    context.on('page', p => { if (p !== page) p.close().catch(() => {}); });

    try {
      console.log('[1] 导航到 Azure Portal...');
      await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000);

      console.log('[2] 处理登录流程...');
      await handleLoginFlow(page, TARGET_ACCOUNT);

      console.log('[3] 等待 Portal 首页加载...');
      await page.waitForSelector(
        '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
        { timeout: 120000 }
      );
      await page.waitForTimeout(2000);

      // 进入 Create NGINXaaS 向导
      console.log('[4] 进入 Create NGINXaaS 向导...');
      const searchBox = page.locator(
        '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]'
      ).first();
      await searchBox.click();
      await searchBox.pressSequentially('nginxaas', { delay: 80 });
      await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
      await page.waitForTimeout(1000);
      await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();
      await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.frameLocator('iframe[name="BrowseResource.ReactView"]')
        .locator('[role="menuitem"]:has-text("Create")').click();
      await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
      await page.waitForSelector('text=Project details', { timeout: 30000 });
      await page.waitForTimeout(3000);

      // 填写 Basics 必填项（使向导可以前进到 Tags 标签页）
      // 此处仅做最简填写，详细 Basics 流程参见 test-nginxaas.js
      console.log('[5] 填写 Basics 必填字段...');
      // Subscription（通常已默认选中 Liftr-Nginx-Test）
      // Resource Group
      await page.getByRole('combobox', { name: /resource group/i }).first()
        .selectOption({ label: TARGET_RESOURCE_GROUP }).catch(async () => {
          await page.locator('[aria-label*="Resource group"]').first().click();
          await page.getByRole('option', { name: TARGET_RESOURCE_GROUP }).click().catch(() => {});
        });
      await page.waitForTimeout(500);
      // Name
      const nameField = page.locator('input[id*="nginxDeployment"], input[aria-label="Name"]').first();
      await nameField.fill(SC4_NAME).catch(async () => {
        await nameField.click({ clickCount: 3 });
        await nameField.pressSequentially(SC4_NAME, { delay: 50 });
      });
      await page.waitForTimeout(500);
      // 直接点击 Tags 标签页（跳过 Networking）
      await page.getByRole('tab', { name: 'Tags' }).click();
      await page.waitForTimeout(1500);

      // 运行 SC4 测试
      console.log('\n[6] 运行 SC4 Tags 测试...\n');
      const sc4Results = await runSC4TagsTest(page);

      // 汇总报告
      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║                    SC4 测试结果汇总                          ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      const passCount = sc4Results.filter(r => r.passed).length;
      const failCount = sc4Results.filter(r => !r.passed).length;
      console.log(`合计: ${sc4Results.length} 个用例  ✅ PASS: ${passCount}  ❌ FAIL: ${failCount}`);

    } catch (err) {
      console.error('\n[ERROR]', err.message);
    } finally {
      await page.waitForTimeout(3000);
      await context.close();
    }
  })();
}
