/**
 * NginxaaS Azure Portal Test
 * 使用 Microsoft Edge 浏览器 (复用 Edge 用户配置文件以启用账号选择器):
 * 1. 打开 Azure Portal (含 NginxaaS feature flags)
 * 2. 自动选择并点击 v-yixueli@microsoft.com 账号登录
 * 3. 搜索 nginxaas 并点击 NGINXaaS 服务
 * 4. 点击 Create 进入创建页面
 * 5. 验证/设置 Subscription、Resource Group
 * 6. 填写 Name（lyx-stage-MMDD）
 * 7. 检查/设置 Region 为 West Central US
 * 8. 选择 Pricing Plan（Standard v3）
 * 9. 依次通过 Networking、Tags 进入 Review + create 页面
 * 10. 在 Review + create 页面截图
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const AZURE_PORTAL_URL =
  'https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true' +
  '&Azure_Marketplace_Nginx=stage1' +
  '&Azure_Marketplace_Nginx_assettypeoptions=%7B%22Nginx%22%3A%7B%22options%22%3A%22%22%7D%7D' +
  '&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home';

const TARGET_ACCOUNT = 'v-yixueli@microsoft.com';
const TARGET_SUBSCRIPTION = 'Liftr-Nginx-Test';
const TARGET_RESOURCE_GROUP = 'lyx-liftr-test';
const TARGET_REGION = 'West Central US';
const SCREENSHOT_PATH = path.join(__dirname, 'nginxaas-review-create-edge.png');
const DEPLOYMENT_TIMEOUT_MINUTES = Number(process.env.DEPLOYMENT_TIMEOUT_MINUTES || 20);
const DEPLOYMENT_POLL_INTERVAL_MS = 10000;
const DEPLOYMENT_REFRESH_INTERVAL_MS = 90000;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function readSelectedRadioOption(page, fieldPattern, allowedOptions) {
  return page.evaluate(({ pattern, allowed }) => {
    const regex = new RegExp(pattern, 'i');
    const fieldAnchor = [...document.querySelectorAll('label,span,div,strong,p')]
      .find((element) => regex.test((element.textContent || '').trim()));

    if (!fieldAnchor) {
      return null;
    }

    let container = fieldAnchor.parentElement;
    for (let depth = 0; depth < 8 && container; depth += 1, container = container.parentElement) {
      const checkedNodes = [...container.querySelectorAll('input[type="radio"], [role="radio"]')].filter((node) => {
        if (node instanceof HTMLInputElement) {
          return node.checked;
        }
        return node.getAttribute('aria-checked') === 'true';
      });

      for (const node of checkedNodes) {
        const candidateTexts = [
          node.closest('label')?.innerText,
          node.closest('[role="radio"]')?.innerText,
          node.parentElement?.innerText,
          node.nextElementSibling?.innerText,
          node.getAttribute('aria-label'),
          node.textContent,
        ];

        for (const candidateText of candidateTexts) {
          const normalized = (candidateText || '').replace(/\s+/g, ' ').trim();
          if (!normalized) {
            continue;
          }

          const lowered = normalized.toLowerCase();
          const matchedOption = allowed.find((option) => lowered.includes(option.toLowerCase()));
          if (matchedOption) {
            return matchedOption;
          }
        }
      }
    }

    return null;
  }, { pattern: fieldPattern.source, allowed: allowedOptions });
}

async function readFieldControlText(page, fieldPattern) {
  return page.evaluate(({ pattern }) => {
    const regex = new RegExp(pattern, 'i');
    const fieldAnchor = [...document.querySelectorAll('label,span,div,strong,p')]
      .find((element) => regex.test((element.textContent || '').trim()));

    if (!fieldAnchor) {
      return null;
    }

    let container = fieldAnchor.parentElement;
    for (let depth = 0; depth < 8 && container; depth += 1, container = container.parentElement) {
      const control = container.querySelector('button[aria-haspopup="listbox"], [role="combobox"]');
      if (control) {
        const text = (control.innerText || control.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) {
          return text;
        }
      }
    }

    return null;
  }, { pattern: fieldPattern.source });
}

async function assertReviewFieldContains(page, fieldPattern, expectedText) {
  const matched = await page.evaluate(({ pattern, expected }) => {
    const regex = new RegExp(pattern, 'i');
    const expectedText = expected.replace(/\s+/g, ' ').trim().toLowerCase();
    const anchors = [...document.querySelectorAll('label,span,div,strong,p,dt,dd,th,td')]
      .filter((element) => regex.test((element.textContent || '').trim()));

    for (const anchor of anchors) {
      let node = anchor;
      for (let depth = 0; depth < 8 && node; depth += 1, node = node.parentElement) {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (text && text.includes(expectedText)) {
          return true;
        }
      }
    }

    return false;
  }, { pattern: fieldPattern.source, expected: expectedText });

  if (!matched) {
    throw new Error(`Review field mismatch for ${fieldPattern.source}: expected ${expectedText}`);
  }
}

async function waitForDeploymentCompletion(page, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  // 已知按钮的绝对 XPath（来自实际页面结构），精确到 button 元素
  const GO_TO_RESOURCE_XPATH = '/html/body/div[3]/div/div/div[2]/div/div/div[2]/div[1]/div[3]/div[2]/div[2]/button';

  // 在主页及所有 frames 中查找 Go to resource 按钮，返回可见 locator 或 null
  async function findGoToResourceBtn() {
    // 优先使用 getByRole + 正则（大小写不敏感），覆盖各种文字变体
    const contexts = [page, ...page.frames()];
    for (const ctx of contexts) {
      try {
        const byRole = ctx.getByRole('button', { name: /go to resource/i }).first();
        if (await byRole.isVisible({ timeout: 500 }).catch(() => false)) return byRole;

        const byLink = ctx.getByRole('link', { name: /go to resource/i }).first();
        if (await byLink.isVisible({ timeout: 500 }).catch(() => false)) return byLink;

        // css has-text 回退（对主页有效）
        const byCss = ctx.locator(
          'button:has-text("Go to resource"), a:has-text("Go to resource"),' +
          'button:has-text("Go to Resource"), a:has-text("Go to Resource")'
        ).first();
        if (await byCss.isVisible({ timeout: 500 }).catch(() => false)) return byCss;
      } catch (_) {}
    }

    // 最后使用用户提供的绝对 XPath（仅主页）
    try {
      const byXPath = page.locator(`xpath=${GO_TO_RESOURCE_XPATH}`).first();
      if (await byXPath.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('[22] 通过绝对 XPath 找到 Go to resource 按钮');
        return byXPath;
      }
    } catch (_) {}

    return null;
  }

  const deploymentCompleteSignals = [
    'text=Your deployment is complete',
    'text=Deployment complete',
    'text=Your deployment is successful',
    'text=Deployment succeeded',
    'text=Completed',
  ];
  let lastRefreshAt = Date.now();

  while (Date.now() < deadline) {
    const btn = await findGoToResourceBtn();
    if (btn) return btn;

    const failedVisible = await page.locator('text=Deployment failed').isVisible({ timeout: 1000 }).catch(() => false)
      || await page.locator('text=Failed').isVisible({ timeout: 1000 }).catch(() => false);
    if (failedVisible) {
      throw new Error('Deployment failed before Go to resource became available');
    }

    for (const signal of deploymentCompleteSignals) {
      const signalVisible = await page.locator(signal).isVisible({ timeout: 1000 }).catch(() => false);
      if (signalVisible) {
        const btn2 = await findGoToResourceBtn();
        if (btn2) return btn2;
      }
    }

    if (Date.now() - lastRefreshAt >= DEPLOYMENT_REFRESH_INTERVAL_MS) {
      console.log('[22] 部署仍在进行，刷新页面以同步最新状态...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(3000);
      lastRefreshAt = Date.now();
      continue;
    }

    await page.waitForTimeout(DEPLOYMENT_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for deployment completion`);
}

// Edge 用户数据目录（含已登录账号的会话/Cookie）
const EDGE_USER_DATA_DIR = path.join(
  os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'
);
// 备用：独立测试配置文件目录（首次运行需手动完成登录）
const TEST_PROFILE_DIR = path.join(__dirname, '.edge-test-profile');

/**
 * 处理 Microsoft 登录页面的各种场景：
 *   A. 账号选择器（Pick an account）— 直接点击目标账号
 *   B. 邮箱输入框 — 填入邮箱后点击 Next，等待企业 SSO
 *   C. "Stay signed in?" 提示 — 点击 Yes
 */
async function handleLoginFlow(page, targetAccount) {
  const loginSelectors = {
    accountTile: `[data-test-id="${targetAccount}"]`,
    accountText: `div.table-row:has-text("${targetAccount}"), div.account:has-text("${targetAccount}")`,
    emailInput: 'input[type="email"][name="loginfmt"], input[name="loginfmt"]',
    nextBtn: 'input[type="submit"][value="Next"], input[id="idSIButton9"]',
    kmsiYes: 'input[id="idSIButton9"][value="Yes"], input[type="submit"][value="Yes"]',
    kmsiNo: 'input[id="idBtn_Back"]',
  };

  // 最多等待 10 秒检测登录页面类型
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = page.url();
    if (!url.includes('login.microsoftonline.com') && !url.includes('login.microsoft.com')) {
      break; // 已离开登录页
    }

    await page.waitForTimeout(2000);

    // ── 情况 A: 账号选择器（data-test-id）──
    const tileVisible = await page.locator(loginSelectors.accountTile).isVisible({ timeout: 3000 }).catch(() => false);
    if (tileVisible) {
      console.log(`  [login-A] 找到账号 tile，点击 ${targetAccount}`);
      await page.locator(loginSelectors.accountTile).click();
      await page.waitForTimeout(2000);
      continue;
    }

    // ── 情况 A2: 账号文字列表（"Pick an account" 页）──
    const textVisible = await page.locator(`text="${targetAccount}"`).isVisible({ timeout: 3000 }).catch(() => false);
    if (textVisible) {
      console.log(`  [login-A2] 通过文字找到账号，点击 ${targetAccount}`);
      await page.locator(`text="${targetAccount}"`).first().click();
      await page.waitForTimeout(2000);
      continue;
    }

    // ── 情况 B: 邮箱输入框 ──
    const emailVisible = await page.locator(loginSelectors.emailInput).isVisible({ timeout: 3000 }).catch(() => false);
    if (emailVisible) {
      console.log(`  [login-B] 邮箱输入框，填入 ${targetAccount} 并点击 Next`);
      await page.locator(loginSelectors.emailInput).fill(targetAccount);
      await page.waitForTimeout(500);
      await page.locator(loginSelectors.nextBtn).click();
      await page.waitForTimeout(3000);
      continue;
    }

    // ── 情况 C: "Stay signed in?" 提示 ──
    const kmsiVisible = await page.locator(loginSelectors.kmsiYes).isVisible({ timeout: 3000 }).catch(() => false);
    if (kmsiVisible) {
      console.log('  [login-C] "Stay signed in?" 提示，点击 Yes');
      await page.locator(loginSelectors.kmsiYes).click();
      await page.waitForTimeout(2000);
      continue;
    }

    break; // 未识别到需要处理的登录状态
  }
}

(async () => {
  console.log('[1] 使用 Microsoft Edge 用户配置文件启动浏览器（复用已登录账号）...');

  let context;

  // 优先使用系统 Edge 配置文件（含账号会话），失败则使用独立测试目录
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
    console.log('[1] Edge 默认配置文件加载成功');
  } catch (e) {
    console.log(`[1] Edge 默认配置文件不可用（原因：${e.message.split('\n')[0]}）`);
    console.log('[1b] 改用独立测试配置文件...');
    context = await chromium.launchPersistentContext(TEST_PROFILE_DIR, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
    });
  }

  const existingPages = context.pages();
  let page = existingPages.find((candidate) => candidate.url() && candidate.url() !== 'about:blank') || existingPages[0];
  if (!page) {
    page = await context.newPage();
  }

  let instanceName = '';
  let selectedScaling = '';
  let selectedUpgradeChannel = '';

  const keepSinglePage = async (candidatePage) => {
    if (candidatePage !== page) {
      await candidatePage.close().catch(() => {});
    }
  };

  for (const extraPage of context.pages()) {
    await keepSinglePage(extraPage);
  }

  context.on('page', keepSinglePage);

  try {
    // ── Step 1: 导航到 Azure Portal ──────────────────────────────────
    console.log('[2] 导航到 Azure Portal URL...');
    await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    // ── Step 2: 处理登录流程 ─────────────────────────────────────────
    console.log('[3] 检测并处理登录/账号选择流程...');
    await handleLoginFlow(page, TARGET_ACCOUNT);

    // ── Step 3: 等待 Portal 首页加载 ─────────────────────────────────
    console.log('[4] 等待 Azure Portal 首页加载（最多 120 秒）...');
    await page.waitForSelector(
      '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
      { timeout: 120000 }
    );

    console.log('[5] Azure Portal 首页已加载');
    await page.waitForTimeout(2000);

    // ── Step 4: 搜索 nginxaas ────────────────────────────────────────
    console.log('[6] 点击搜索框并逐字输入 nginxaas...');
    const searchBox = page.locator(
      '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]'
    ).first();
    await searchBox.click();
    await page.waitForTimeout(500);
    // 使用 pressSequentially 确保触发搜索事件处理器
    await searchBox.pressSequentially('nginxaas', { delay: 80 });
    // 等待搜索结果下拉出现（含 Services 分类）
    await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // ── Step 5: 点击 NGINXaaS 服务 ───────────────────────────────────
    console.log('[7] 点击搜索结果中的 NGINXaaS 服务（Services 分类）...');
    // 精确匹配文字为 "NGINXaaS" 的 option（排除 "F5 NGINXaaS..." Marketplace 项）
    await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();

    console.log('[8] 等待 NGINXaaS 资源列表页 iframe 出现...');
    // Azure Portal 使用 hash 路由，不用 waitForURL，改为等待列表页 iframe
    await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
    console.log('[8] BrowseResource iframe 已加载，等待内容渲染...');
    await page.waitForTimeout(3000);

    // ── Step 6: 点击 Create ───────────────────────────────────────────
    console.log('[9] 点击 Create 按钮进入创建页面...');
    // 通过 iframe locator 访问内部 Create 按钮（Playwright 推荐方式）
    const createBtn = page
      .frameLocator('iframe[name="BrowseResource.ReactView"]')
      .locator('[role="menuitem"]:has-text("Create")');

    await createBtn.waitFor({ state: 'visible', timeout: 30000 });
    await createBtn.click();

    console.log('[10] 等待 Create NGINXaaS 页面加载...');
    await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
    await page.waitForTimeout(4000);

    // ── Step 11: 确认并切换到 Basics 标签页 ───────────────────────────
    console.log('[11] 检查并切换到 Basics 标签页...');
    // Azure Portal 创建向导的标签是普通 <a>/<button>，不使用 role="tab"
    // 等待 "Project details" 标题出现，确认 Basics 表单内容已渲染
    await page.waitForSelector('text=Project details', { timeout: 30000 });
    // 检查是否有激活的 Basics 标签（尝试多种选择器）
    const basicsTabLink = page.locator('a:has-text("Basics"), button:has-text("Basics")').first();
    const basicsLinkExists = await basicsTabLink.isVisible({ timeout: 3000 }).catch(() => false);
    if (basicsLinkExists) {
      // 检查是否已激活：查看 aria-selected 或 class 包含 selected/active
      const ariaSel = await basicsTabLink.getAttribute('aria-selected').catch(() => null);
      const cls = await basicsTabLink.getAttribute('class').catch(() => '');
      const isActive = ariaSel === 'true' || (cls || '').toLowerCase().includes('select') || (cls || '').toLowerCase().includes('active');
      if (!isActive && ariaSel !== null) {
        console.log('[11] 当前不在 Basics 标签，切换中...');
        await basicsTabLink.click();
        await page.waitForTimeout(1000);
      } else {
        console.log('[11] 已在 Basics 标签页');
      }
    } else {
      console.log('[11] 已在 Basics 标签页（表单内容已渲染）');
    }

    // ── Step 12: 验证并选择 Subscription ─────────────────────────────
    console.log('[12] 检查 Subscription 是否为 Liftr-Nginx-Test...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // 检查方式：遍历 label 父容器 textContent，判断目标值是否已存在
    const subCorrect = await page.evaluate((target) => {
      const lbl = [...document.querySelectorAll('label')]
        .find(l => /^Subscription/.test(l.textContent?.trim()));
      if (!lbl) return false;
      let el = lbl.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!el) break;
        if (el.textContent?.includes(target)) return true;
        el = el.parentElement;
      }
      return false;
    }, TARGET_SUBSCRIPTION);
    console.log(`[12] Subscription 已正确: ${subCorrect}`);
    if (!subCorrect) {
      console.log(`[12] 切换 Subscription 为 ${TARGET_SUBSCRIPTION}...`);
      await page.evaluate(() => {
        const lbl = [...document.querySelectorAll('label')]
          .find(l => /^Subscription/.test(l.textContent?.trim()));
        if (!lbl) return;
        let el = lbl.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          // 只匹配真正的下拉按钮（aria-haspopup="listbox"），排除 info 图标
          const ctrl = el.querySelector('button[aria-haspopup="listbox"], [role="combobox"]');
          if (ctrl) { ctrl.click(); return; }
          el = el.parentElement;
        }
      });
      await page.waitForTimeout(800);
      await page.locator('[role="option"]').filter({ hasText: TARGET_SUBSCRIPTION }).first()
        .waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('[role="option"]').filter({ hasText: TARGET_SUBSCRIPTION }).first().click();
      await page.waitForTimeout(2000);
    } else {
      console.log(`[12] Subscription 已为 ${TARGET_SUBSCRIPTION}`);
    }

    // ── Step 13: 验证并选择 Resource Group ───────────────────────────
    console.log('[13] 检查 Resource group 是否为 lyx-liftr-test...');
    const rgCorrect = await page.evaluate((target) => {
      const lbl = [...document.querySelectorAll('label')]
        .find(l => /^Resource group/.test(l.textContent?.trim()));
      if (!lbl) return false;
      let el = lbl.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!el) break;
        if (el.textContent?.includes(target)) return true;
        el = el.parentElement;
      }
      return false;
    }, TARGET_RESOURCE_GROUP);
    console.log(`[13] Resource group 已正确: ${rgCorrect}`);
    if (!rgCorrect) {
      console.log(`[13] 切换 Resource group 为 ${TARGET_RESOURCE_GROUP}...`);
      // 点击 RG 下拉（aria-label 已由 debug 确认）
      const rgDropDiv = page.locator('div[aria-label="Create new or use existing Resource group"]');
      await rgDropDiv.waitFor({ state: 'visible', timeout: 10000 });
      await rgDropDiv.click();
      await page.waitForTimeout(800);
      // 下拉打开后，内部有过滤输入框
      // nth(1): nth(0)=Subscription 过滤框(仍在 DOM 中), nth(1)=Resource group 过滤框
      const rgFilterInput = page.locator(
        'input[aria-label="Type to filter result or use down arrow to choose options"]'
      ).nth(1);
      await rgFilterInput.waitFor({ state: 'visible', timeout: 8000 });
      await rgFilterInput.click(); // 确保焦点在过滤框
      // 逐字符输入（触发自然按键事件，避免 fill() 可能引起的 form reset）
      await rgFilterInput.pressSequentially(TARGET_RESOURCE_GROUP, { delay: 50 });
      await page.waitForTimeout(1000);
      // 过滤框的 aria-label 明确写"use down arrow to choose options"
      // 用键盘方向键选择第一个匹配项，比查找 [role="option"] 更可靠
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(400);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
      console.log(`[13] Resource group 切换完成`);
    } else {
      console.log(`[13] Resource group 已为 ${TARGET_RESOURCE_GROUP}`);
    }

    // ── Step 14: 填写 Name ────────────────────────────────────────────
    const now = new Date();
    instanceName = `lyx-stage-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    console.log(`[14] 填写 Name 字段: ${instanceName}...`);
    // 通过 JS 读取 label[for] 属性获取 input 的 ID，避免 getByLabel 匹配到非 input 元素
    const nameInputId = await page.evaluate(() => {
      const label = [...document.querySelectorAll('label')]
        .find(l => /^Name\b/.test((l.textContent || '').trim()));
      return label?.htmlFor || null;
    });
    const nameInput = nameInputId
      ? page.locator(`[id="${nameInputId}"]`)
      : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await nameInput.click({ clickCount: 3 }); // 全选已有内容再填写
    await nameInput.fill(instanceName);
    console.log(`[14] Name 已填写: ${instanceName}`);
    await page.waitForTimeout(500);

    // ── Step 15: 检查并设置 Region ────────────────────────────────────
    console.log(`[15] 检查 Region 是否为 ${TARGET_REGION}...`);
    const regionCorrect = await page.evaluate((target) => {
      const lbl = [...document.querySelectorAll('label')]
        .find(l => /^Region\b/.test((l.textContent || '').trim()));
      if (!lbl) return false;
      let el = lbl.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!el) break;
        if (el.textContent?.includes(target)) return true;
        el = el.parentElement;
      }
      return false;
    }, TARGET_REGION);
    console.log(`[15] 当前 Region 已为 ${TARGET_REGION}: ${regionCorrect}`);
    if (!regionCorrect) {
      console.log(`[15] 切换 Region 为 ${TARGET_REGION}...`);

      // 通过 label 找到 Region 字段内的下拉按钮
      const regionDropBtn = await page.evaluateHandle(() => {
        const lbl = [...document.querySelectorAll('label')]
          .find(l => /^Region\b/.test((l.textContent || '').trim()));
        if (!lbl) return null;
        let el = lbl.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!el) break;
          const btn = el.querySelector('button[aria-haspopup="listbox"], [role="combobox"]');
          if (btn) return btn;
          el = el.parentElement;
        }
        return null;
      });

      const regionBtnElement = regionDropBtn.asElement();
      if (regionBtnElement) {
        console.log('[15] 通过 label 找到 Region 下拉按钮，点击展开...');
        const controlsId = await regionBtnElement.getAttribute('aria-controls');
        await regionBtnElement.click();
        await page.waitForTimeout(800);

        // aria-controls 指向的容器内包含过滤输入框（不会误匹配 Portal 全局搜索框）
        // 选项列表由 Fluent UI 渲染在 body 根层级（Callout 挂载），无法通过 getByRole/getByText 找到
        // 正确做法：在过滤框中输入后，用 filterInput.press('ArrowDown') 将 key 事件发给过滤框
        // 这样键盘事件到达正确目标，ArrowDown 选中过滤结果的第一项，Enter 确认
        if (controlsId) {
          const popup = page.locator(`#${controlsId}`);
          await popup.waitFor({ state: 'visible', timeout: 5000 });
          const filterInput = popup.locator('input').first();
          const filterVisible = await filterInput.isVisible({ timeout: 3000 }).catch(() => false);
          console.log(`[15] Region 过滤框可见: ${filterVisible}`);
          if (filterVisible) {
            await filterInput.click();
            await filterInput.pressSequentially('West central us', { delay: 80 });
            await page.waitForTimeout(1000);
            // 把 ArrowDown/Enter 发给 filterInput，确保事件到达正确目标
            // 输入 "west central us" 可精确过滤出 "(US) West Central US"，排除 "(Europe) Germany West Central"
            await filterInput.press('ArrowDown');
            await page.waitForTimeout(500);
            await filterInput.press('Enter');
            console.log('[15] 已通过过滤框键盘选择 West Central US');
          } else {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(400);
            await page.keyboard.press('Enter');
          }
        } else {
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(400);
          await page.keyboard.press('Enter');
        }
      } else {
        // 备用：直接定位含当前地区名的按钮
        console.log('[15] label 方式未找到，尝试定位含地区名的按钮...');
        const regionFallbackBtn = page.locator('button').filter({
          hasText: /East US|West US|Central US|North Central|South Central|\(US\)/
        }).first();
        if (await regionFallbackBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await regionFallbackBtn.click();
          await page.waitForTimeout(800);
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(400);
          await page.keyboard.press('Enter');
        } else {
          console.log('[15] 备用方式也未找到 Region 按钮，跳过 Region 设置');
        }
      }

      // 选择后验证 Region 是否已设置为目标值
      await page.waitForTimeout(1000);
      const regionVerify = await page.evaluate((target) => {
        const lbl = [...document.querySelectorAll('label')]
          .find(l => /^Region\b/.test((l.textContent || '').trim()));
        if (!lbl) return '(label not found)';
        let el = lbl.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!el) break;
          if (el.textContent?.includes(target)) return 'OK';
          el = el.parentElement;
        }
        // 返回当前实际文字便于诊断
        const btn = document.querySelector('button[aria-haspopup="listbox"]');
        return btn?.innerText?.trim() || '(unknown)';
      }, TARGET_REGION);
      console.log(`[15] Region 验证: ${regionVerify}`);
    } else {
      console.log(`[15] Region 已为 ${TARGET_REGION}，保持默认`);
    }

    // ── Step 16: 选择 Pricing Plan ────────────────────────────────────
    console.log('[16] 点击 Select pricing plan 按钮...');
    // "Select pricing plan" 可能是任意元素（div/span/a），用 text= 匹配叶子节点
    const pricingPlanBtn = page.locator('text=Select pricing plan').first();
    await pricingPlanBtn.waitFor({ state: 'visible', timeout: 15000 });
    await pricingPlanBtn.click();
    await page.waitForTimeout(2500);

    console.log('[16] 在 Plan 列表中选择 Standard v3（非 Standard v3 Test）...');
    // 用 hasText 匹配含 "Standard V3" 的行，再用 hasNotText 排除含 "Test" 或 "TESTING" 的行
    const standardV3Row = page.locator('[role="row"], tr, li')
      .filter({ hasText: /Standard V3/i })
      .filter({ hasNotText: /Test|TESTING/i })
      .first();
    await standardV3Row.waitFor({ state: 'visible', timeout: 15000 });
    const radioInRow = standardV3Row.locator('input[type="radio"]');
    const radioCount = await radioInRow.count();
    if (radioCount > 0) {
      await radioInRow.click();
    } else {
      await standardV3Row.click();
    }
    await page.waitForTimeout(1000);

    console.log('[16] 点击 Confirm Plan 按钮...');
    // Azure Portal 中 Confirm Plan 可能不是 <button>，用 text= 匹配任意元素
    const confirmPlanBtn = page.locator('text=Confirm Plan').first();
    await confirmPlanBtn.waitFor({ state: 'visible', timeout: 15000 });
    await confirmPlanBtn.click();
    await page.waitForTimeout(2000);
    console.log('[16] Pricing Plan 选择完成（Standard v3）');

    // ── Step 16b: 记录 Scaling 和 Upgrade Channel ───────────────────
    console.log('[16b] 读取 Scaling 和 Upgrade Channel 的当前选择...');
    selectedScaling = await readSelectedRadioOption(page, /^Scaling\b/, ['Manual', 'Autoscale']);
    selectedUpgradeChannel = await readFieldControlText(page, /^Upgrade Channel\b/);

    if (!selectedScaling) {
      throw new Error('Unable to determine selected Scaling value on Basics page');
    }

    if (!selectedUpgradeChannel) {
      throw new Error('Unable to determine selected Upgrade Channel value on Basics page');
    }

    console.log(`[16b] Scaling: ${selectedScaling}`);
    console.log(`[16b] Upgrade Channel: ${selectedUpgradeChannel}`);

    // ── Step 17: 点击 Next 进入 Networking 页面 ──────────────────────
    console.log('[17] 点击 Next 按钮进入 Networking 页面...');
    const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
    await nextBtn.waitFor({ state: 'visible', timeout: 20000 });
    await nextBtn.click();
    await page.waitForTimeout(4000);
    console.log('[17] 已进入 Networking 页面');

    // ── Step 18: 勾选 Networking 页面复选框 ───────────────────────────
    console.log('[18] 等待 Networking 页面中的虚拟网络访问复选框...');
    const vnetAccessSpan = page.locator(
      'xpath=/html/body/div[1]/div[4]/div[1]/div[1]/main/div[3]/div[2]/section[2]/div[2]/div[1]/div[4]/div[2]/div/div/div[2]/div/div[2]/div[2]/div/div[2]/div/div[3]/div[3]/div[2]/div[2]/div/div/span'
    ).first();

    await vnetAccessSpan.waitFor({ state: 'visible', timeout: 30000 });
    await vnetAccessSpan.scrollIntoViewIfNeeded().catch(() => {});
    await vnetAccessSpan.click();
    await page.waitForTimeout(1000);

    const fallbackCheckbox = page.locator('input[type="checkbox"]').last();
    const fallbackSelected = await fallbackCheckbox.isChecked().catch(() => false);
    const spanAriaChecked = await vnetAccessSpan.getAttribute('aria-checked').catch(() => null);
    const checkboxSelected = fallbackSelected || spanAriaChecked === 'true';

    if (!checkboxSelected) {
      throw new Error('Networking checkbox was not selected');
    }
    console.log('[18] 已勾选虚拟网络访问复选框');

    // ── Step 19: 点击 Next 进入 Tags 页面 ────────────────────────────
    console.log('[19] 点击 Next 按钮进入 Tags 页面...');
    const nextBtnOnNetworkingPage = page.getByRole('button', { name: /^next$/i }).first();
    await nextBtnOnNetworkingPage.waitFor({ state: 'visible', timeout: 20000 });
    await nextBtnOnNetworkingPage.click();
    await page.waitForTimeout(3000);
    console.log('[19] 已进入 Tags 页面');

    // ── Step 20: 点击 Next 进入 Review + create 页面 ─────────────────
    console.log('[20] 点击 Next 按钮进入 Review + create 页面...');
    const nextBtnOnTagsPage = page.getByRole('button', { name: /^next$/i }).first();
    await nextBtnOnTagsPage.waitFor({ state: 'visible', timeout: 20000 });
    await nextBtnOnTagsPage.click();
    await page.waitForTimeout(4000);
    console.log('[20] 已进入 Review + create 页面');

    // ── Step 20a: 检查页面顶部是否有红色校验失败提示 ─────────────────
    console.log('[20a] 检查 Review + create 页面顶部是否有校验失败提示...');
    const validationErrorPatterns = [
      'text=Validation failed',
      'text=Required information is missing or not valid',
      '[class*="error"] >> text=/validation failed|required information/i',
      '[role="alert"] >> text=/validation failed|required information/i',
    ];
    let validationErrorMsg = '';
    for (const pattern of validationErrorPatterns) {
      try {
        const el = page.locator(pattern).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          validationErrorMsg = (await el.innerText().catch(() => pattern)) || pattern;
          break;
        }
      } catch (_) {}
    }
    if (validationErrorMsg) {
      // Create 按钮此时为灰色不可点击，抛出明确错误
      throw new Error(
        `[20a] Review + create 页面顶部出现校验失败提示，Create 按钮不可点击。\n` +
        `提示内容：${validationErrorMsg.trim()}\n` +
        `请检查表单填写是否有误（Subscription / Resource group / Name / Region / Pricing Plan 等）。`
      );
    }
    console.log('[20a] 未检测到校验失败提示，Create 按钮可点击，继续...');

    // ── Step 20b: 校验 Review + create 页面字段 ───────────────────────
    console.log('[20b] 校验 Review + create 页面中 Basics 摘要字段...');
    await assertReviewFieldContains(page, /^Subscription\b/, TARGET_SUBSCRIPTION);
    await assertReviewFieldContains(page, /^Resource group\b/, TARGET_RESOURCE_GROUP);
    await assertReviewFieldContains(page, /^Name\b/, instanceName);
    await assertReviewFieldContains(page, /^Region\b/, TARGET_REGION);
    await assertReviewFieldContains(page, /^Pricing Plan\b/, 'Standard V3, Monthly');
    await assertReviewFieldContains(page, /^Scaling\b/, selectedScaling);
    await assertReviewFieldContains(page, /^Upgrade Channel\b/, selectedUpgradeChannel);
    console.log('[20b] Review + create 页面字段校验通过');

    // ── Step 21: 点击 Create 并等待部署完成 ─────────────────────────
    console.log('[21] 点击 Review + create 页面下方的 Create 按钮...');
    const createFinalBtn = page.getByRole('button', { name: /^create$/i }).first();
    await createFinalBtn.waitFor({ state: 'visible', timeout: 30000 });
    await createFinalBtn.click();

    console.log(`[22] 等待部署完成，最多 ${DEPLOYMENT_TIMEOUT_MINUTES} 分钟...`);
    const goToResourceButton = await waitForDeploymentCompletion(page, DEPLOYMENT_TIMEOUT_MINUTES * 60 * 1000);
    console.log('[22] 部署完成，Go to resource 按钮已出现');

    // ── Step 23: 点击 Go to resource ────────────────────────────────
    console.log('[23] 点击蓝色 Go to resource 按钮...');
    await goToResourceButton.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);

    // ── Step 24: 截图 ─────────────────────────────────────────────────
    console.log(`[24] 截图保存到: ${SCREENSHOT_PATH}`);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log('[✓] 测试完成！截图已保存。');
    console.log(`\n截图路径: ${SCREENSHOT_PATH}`);

  } catch (err) {
    console.error('[ERROR]', err.message.split('\n')[0]);
    const errorPath = path.join(__dirname, 'nginxaas-error.png');
    await page.screenshot({ path: errorPath }).catch(() => {});
    console.log(`错误截图已保存: ${errorPath}`);
    process.exit(1);
  } finally {
    await page.waitForTimeout(2000);
    await context.close();
  }
})();
