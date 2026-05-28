/**
 * test-setup-vnets.js
 *
 * 测试前准备工作：创建 NGINXaaS Networking 测试所需的两个虚拟网络
 *
 * lyx-vnet01:
 *   Subscription : Liftr-Nginx-Test
 *   Resource group: lyx-liftr-test
 *   Region        : West Central US
 *   Address space : 10.0.0.0/28（16 个地址）
 *   Subnet        : 删除默认 /24 子网，新增默认 /28 子网
 *
 * lyx-vnet02:
 *   Subscription : Liftr-Nginx-Test
 *   Resource group: lyx-liftr-test
 *   Region        : West Central US
 *   Address space : 10.0.0.0/16（保留默认 /24 子网）
 *
 * 浏览器 : Microsoft Edge（与 test-nginxaas.js 相同）
 * Portal : 与 NGINXaaS 创建测试相同的带 Feature Flags 的 URL
 *
 * 执行方式：
 *   node test-setup-vnets.js
 *
 * 若两个 VNet 均已存在，脚本会跳过创建步骤，直接回到 Portal 首页。
 * 完成后浏览器保持打开，可直接运行 test-nginxaas.js 进行后续测试。
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ── 常量 ─────────────────────────────────────────────────────────────

// 与 test-nginxaas.js 相同的 Portal URL（含 NGINXaaS feature flags）
const AZURE_PORTAL_URL =
  'https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true' +
  '&Azure_Marketplace_Nginx=stage1' +
  '&Azure_Marketplace_Nginx_assettypeoptions=%7B%22Nginx%22%3A%7B%22options%22%3A%22%22%7D%7D' +
  '&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home';

const TARGET_ACCOUNT      = 'v-yixueli@microsoft.com';
const TARGET_SUBSCRIPTION = 'Liftr-Nginx-Test';
const TARGET_RG           = 'lyx-liftr-test';
const TARGET_REGION       = 'West Central US';
const VNET01_NAME         = 'lyx-vnet01';
const VNET02_NAME         = 'lyx-vnet02';
const SCREENSHOT_DIR      = path.join(__dirname, 'sc4-screenshots');

// VNet 创建向导的 iframe name（Azure Portal 固定值）
const VNET_IFRAME = 'iframe[name="VirtualNetworkCreateV3.ReactView"]';

// 与 test-nginxaas.js 相同的 Edge 配置文件路径
const EDGE_USER_DATA_DIR = path.join(
  os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'
);
const TEST_PROFILE_DIR = path.join(__dirname, '.edge-test-profile');

// ── 辅助函数 ──────────────────────────────────────────────────────────

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function takeScreenshot(page, filename) {
  ensureScreenshotDir();
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false }).catch(() => {});
  console.log(`  [screenshot] ${filename}`);
}

/**
 * 处理 Microsoft 登录页面的各种场景（与 test-nginxaas.js 完全相同）：
 *   A. 账号选择器（Pick an account）— 直接点击目标账号
 *   B. 邮箱输入框 — 填入邮箱后点击 Next，等待企业 SSO
 *   C. "Stay signed in?" 提示 — 点击 Yes
 */
async function handleLoginFlow(page, targetAccount) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = page.url();
    if (!url.includes('login.microsoftonline.com') && !url.includes('login.microsoft.com')) break;
    await page.waitForTimeout(2000);

    // 情况 A：data-test-id 账号 tile
    const tileVisible = await page.locator(`[data-test-id="${targetAccount}"]`)
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (tileVisible) {
      console.log(`  [login-A] 点击账号 tile: ${targetAccount}`);
      await page.locator(`[data-test-id="${targetAccount}"]`).click();
      await page.waitForTimeout(2000);
      continue;
    }

    // 情况 A2：文字列表账号
    const textVisible = await page.locator(`text="${targetAccount}"`)
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (textVisible) {
      console.log(`  [login-A2] 通过文字点击账号: ${targetAccount}`);
      await page.locator(`text="${targetAccount}"`).first().click();
      await page.waitForTimeout(2000);
      continue;
    }

    // 情况 B：邮箱输入框
    const emailVisible = await page.locator('input[name="loginfmt"]')
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (emailVisible) {
      console.log(`  [login-B] 填入邮箱: ${targetAccount}`);
      await page.locator('input[name="loginfmt"]').fill(targetAccount);
      await page.waitForTimeout(500);
      await page.locator('input[id="idSIButton9"], input[type="submit"][value="Next"]').click();
      await page.waitForTimeout(3000);
      continue;
    }

    // 情况 C："Stay signed in?" 提示
    const kmsiVisible = await page.locator('input[id="idSIButton9"][value="Yes"]')
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (kmsiVisible) {
      console.log('  [login-C] 点击 Stay signed in: Yes');
      await page.locator('input[id="idSIButton9"][value="Yes"]').click();
      await page.waitForTimeout(2000);
      continue;
    }

    break;
  }
}

/**
 * 等待 Portal 顶部搜索框出现（首页完全加载的可靠信号）
 * 与 test-nginxaas.js 中 waitForSelector 逻辑相同
 */
async function waitForPortalReady(page) {
  await page.waitForSelector(
    '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
    { timeout: 120000 }
  );
  await page.waitForTimeout(2000);
}

/**
 * 通过 Portal 顶部搜索框导航到 Virtual networks 列表页
 *
 * 关键点：
 * - 必须用 pressSequentially（fill 不触发搜索事件处理器）
 * - 等待 BrowseResource.ReactView iframe 出现（列表页内容容器）
 * - 使用精确正则 /^Virtual networks$/ 避免点到子资源类型
 */
async function navigateToVNetList(page) {
  console.log('  [nav] 搜索 Virtual networks...');
  const searchBox = page.locator(
    '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]'
  ).first();
  await searchBox.click();
  await page.waitForTimeout(500);
  // pressSequentially 触发每个字符的 input/keydown 事件，Portal 的搜索才会响应
  await searchBox.pressSequentially('virtual networks', { delay: 80 });
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
  await page.waitForTimeout(800);

  // Services 分类下精确匹配 "Virtual networks"（排除含描述文字的 Marketplace 项）
  await page.locator('[role="option"]').filter({ hasText: /^Virtual networks$/ }).first().click();

  // Portal 使用 hash 路由，waitForURL 无法检测 hash 变化
  // 改为等待 BrowseResource.ReactView iframe 出现
  await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
  // 等待列表内容渲染完成（资源列表行从后端加载需要几秒）
  await page.waitForTimeout(5000);
  console.log('  [nav] Virtual networks 列表页已加载');
}

/**
 * 检查指定 VNet 是否已存在于列表中
 * 通过 frameLocator 穿透 BrowseResource.ReactView iframe 查找文本
 */
async function vnetExistsInList(page, vnetName) {
  const browseFrame = page.frameLocator('iframe[name="BrowseResource.ReactView"]');
  const exists = await browseFrame.locator(`text=${vnetName}`)
    .isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`  [check] VNet ${vnetName} 已存在: ${exists}`);
  return exists;
}

/**
 * 等待 VNet 创建向导 iframe 加载完成（Basics tabpanel 可见）
 */
async function waitForVNetCreateForm(page) {
  // 等待 iframe 本身出现
  await page.waitForSelector(VNET_IFRAME, { timeout: 30000 });
  await page.waitForTimeout(3000);

  // 等待 Basics tabpanel 可见，确认表单内容已渲染
  const vnetFrame = page.frameLocator(VNET_IFRAME);
  await vnetFrame.getByRole('tabpanel', { name: 'Basics' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2000);
}

/**
 * 在 VNet 创建向导 Basics 标签页填写基本信息：
 *   - Subscription（通过 combobox）
 *   - Resource group（combobox + 过滤框）
 *   - Virtual network name（resourceNameTextField）
 *   - Region 验证（应已跟随 Subscription 自动设为 West Central US）
 *
 * 关键点：
 * - VNet 表单完全在 iframe 内，必须通过 frameLocator 访问
 * - Subscription / Resource group / Region 均为 Fluent UI combobox，
 *   需先 click() 打开下拉，再 click() 选项
 * - Resource group 下拉支持过滤框输入（getByRole('textbox', { name: 'Filter items...' })）
 * - VNet 名称输入框通过 data-testid="resourceNameTextField" 定位
 */
async function fillVNetBasics(page, vnetName) {
  const vnetFrame = page.frameLocator(VNET_IFRAME);

  // ① Subscription ────────────────────────────────────────────────
  console.log(`  [basics] 选择 Subscription: ${TARGET_SUBSCRIPTION}`);
  const subCombo = vnetFrame.getByRole('combobox', { name: 'Subscription' });
  const subText = await subCombo.innerText().catch(() => '');
  if (!subText.includes(TARGET_SUBSCRIPTION)) {
    await subCombo.click();
    await page.waitForTimeout(800);
    // 选项列表渲染在 iframe 内，通过 vnetFrame 访问
    await vnetFrame.getByRole('option', { name: TARGET_SUBSCRIPTION }).click();
    await page.waitForTimeout(1500);
    console.log(`  [basics] Subscription 已切换为 ${TARGET_SUBSCRIPTION}`);
  } else {
    console.log(`  [basics] Subscription 已为 ${TARGET_SUBSCRIPTION}`);
  }

  // ② Resource group ──────────────────────────────────────────────
  console.log(`  [basics] 选择 Resource group: ${TARGET_RG}`);
  const rgCombo = vnetFrame.getByRole('combobox', { name: 'Resource group' });
  const rgText = await rgCombo.innerText().catch(() => '');
  if (!rgText.includes(TARGET_RG)) {
    await rgCombo.click();
    await page.waitForTimeout(800);
    // 使用过滤框快速定位（避免滚动长列表）
    // 注意：Filter items... textbox 在下拉打开后才出现
    const filterInput = vnetFrame.getByRole('textbox', { name: 'Filter items...' });
    await filterInput.waitFor({ state: 'visible', timeout: 5000 });
    await filterInput.fill('lyx');
    await page.waitForTimeout(800);
    await vnetFrame.getByRole('option', { name: TARGET_RG }).click();
    await page.waitForTimeout(1000);
    console.log(`  [basics] Resource group 已切换为 ${TARGET_RG}`);
  } else {
    console.log(`  [basics] Resource group 已为 ${TARGET_RG}`);
  }

  // ③ Virtual network name ────────────────────────────────────────
  console.log(`  [basics] 填写 VNet 名称: ${vnetName}`);
  const nameInput = vnetFrame.getByTestId('resourceNameTextField');
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  await nameInput.click({ clickCount: 3 }); // 全选已有内容
  await nameInput.fill(vnetName);
  await page.waitForTimeout(500);

  // ④ Region 验证 ─────────────────────────────────────────────────
  // 选择 Liftr-Nginx-Test 订阅后，Region 通常自动设为 West Central US
  const regionCombo = vnetFrame.getByRole('combobox', { name: 'Region' });
  const regionText = await regionCombo.innerText().catch(() => '');
  console.log(`  [basics] 当前 Region: "${regionText.trim()}"`);

  if (!regionText.includes(TARGET_REGION)) {
    console.log(`  [basics] 需要修改 Region 为 ${TARGET_REGION}...`);
    await regionCombo.click();
    await page.waitForTimeout(800);

    // Region 下拉过滤框（aria-controls 指向的弹出容器内）
    // Fluent UI 弹出容器渲染在 iframe 内，用 vnetFrame 访问
    const regionOption = vnetFrame.getByRole('option', { name: /West Central US/i });
    const regionOptionVisible = await regionOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (regionOptionVisible) {
      await regionOption.click();
    } else {
      // 备用：通过过滤框输入（与 test-nginxaas.js 中 Region 选择逻辑一致）
      const regionFilterInput = vnetFrame.locator('input').first();
      if (await regionFilterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await regionFilterInput.pressSequentially('West central us', { delay: 80 });
        await page.waitForTimeout(1000);
        await regionFilterInput.press('ArrowDown');
        await page.waitForTimeout(500);
        await regionFilterInput.press('Enter');
      } else {
        await page.keyboard.type('West central');
        await page.waitForTimeout(800);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      }
    }
    await page.waitForTimeout(1000);
  }

  await takeScreenshot(page, `${vnetName}-basics.png`);
}

/**
 * 配置 lyx-vnet01 的地址空间：
 *   1. 切换到 Address space 标签
 *   2. 将 Size 从 /16 改为 /28
 *   3. 删除默认子网（/24 子网不适合 /28 地址空间）
 *   4. 点击 "Add a subnet" 添加新的默认 /28 子网
 *   5. 在右侧 Context Pane 中点击 "Add" 确认（接受默认子网名 "default"）
 *
 * 关键点：
 * - Address space 表单完全在 iframe 内
 * - Size combobox 通过 getByRole('combobox', { name: 'Size' }) 定位
 * - 删除旧子网后 "Add a subnet" 按钮才变为可点击状态
 * - "Add a subnet" 打开右侧 Context Pane（在主页面层级，非 iframe 内）
 *   → 确认按钮 "Add" 用 page.getByRole('button', { name: /^Add$/i }) 定位
 */
async function configureVNet01AddressSpace(page) {
  const vnetFrame = page.frameLocator(VNET_IFRAME);

  // 切换到 Address space 标签
  console.log('  [addr] 切换到 Address space 标签...');
  await vnetFrame.getByRole('tab', { name: 'Address space' }).click();
  await page.waitForTimeout(3000);
  await vnetFrame.getByRole('tabpanel', { name: 'Address space' })
    .waitFor({ state: 'visible', timeout: 15000 });

  // 等待地址空间卡片完全渲染
  // 用 heading "Virtual network address space" 作为可靠信号（不依赖具体控件的 aria-name）
  await vnetFrame.getByRole('heading', { name: 'Virtual network address space' })
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);

  // 修改地址空间大小：/16 → /28
  // 注意：该 combobox 的 accessible name 不总是 "Size"，改用当前值 "/16" 文本定位
  console.log('  [addr] 将地址空间 Size 从 /16 修改为 /28...');
  const addrPanel = vnetFrame.getByRole('tabpanel', { name: 'Address space' });
  // 在 Address space tabpanel 内找显示 "/数字" 的 combobox
  const sizeCombo = addrPanel.locator('[role="combobox"]').filter({ hasText: /^\/\d+/ }).first();
  await sizeCombo.waitFor({ state: 'visible', timeout: 10000 });
  await sizeCombo.click();
  await page.waitForTimeout(800);

  // Size listbox 有 "Filter items..." 过滤框（与 Subscription/RG 下拉相同结构）
  // 用过滤框输入 "/28" 可快速定位，避免滚动长列表
  const sizeListbox = vnetFrame.getByRole('listbox').first();
  const sizeListboxVisible = await sizeListbox.isVisible({ timeout: 3000 }).catch(() => false);
  if (sizeListboxVisible) {
    const sizeFilter = sizeListbox.getByRole('textbox', { name: 'Filter items...' });
    if (await sizeFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sizeFilter.fill('/28');
      await page.waitForTimeout(500);
    }
  }
  // /28 选项在 iframe 内的 listbox 中（role="option"）
  await vnetFrame.getByRole('option', { name: '/28' }).click();
  await page.waitForTimeout(1000);
  console.log('  [addr] 地址空间已改为 10.0.0.0/28（16 个地址）');

  await takeScreenshot(page, 'vnet01-address-space-28.png');

  // 删除默认子网（/24 子网超出 /28 地址空间范围，必须先删除）
  console.log('  [addr] 检查并删除默认子网...');
  const deleteSubnetBtn = vnetFrame.getByRole('button', { name: 'Delete subnet' }).first();
  const subnetExists = await deleteSubnetBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (subnetExists) {
    await deleteSubnetBtn.click();
    await page.waitForTimeout(1500);
    console.log('  [addr] 默认子网已删除');
  } else {
    console.log('  [addr] 无需删除（子网不存在）');
  }

  await takeScreenshot(page, 'vnet01-address-space-no-subnet.png');

  // 点击 "Add a subnet" 添加新子网
  // 注意：删除旧子网后，"Add a subnet" 按钮变为可用
  console.log('  [addr] 点击 Add a subnet...');
  const addSubnetBtn = vnetFrame.getByRole('button', { name: 'Add a subnet' });
  await addSubnetBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addSubnetBtn.click();
  await page.waitForTimeout(2500);

  // "Add a subnet" 打开右侧 Context Pane（主页面层级，非 iframe 内）
  // Context Pane 加载完成后，点击 "Add" 按钮确认（接受默认值：subnet name="default"，address range 自动适配 /28）
  console.log('  [addr] 等待 Add subnet Context Pane 加载...');
  await takeScreenshot(page, 'vnet01-add-subnet-panel.png');

  // 先在主页面查找 "Add" 按钮（Context Pane 渲染在主页面）
  const addConfirmBtnInPage = page.getByRole('button', { name: /^Add$/i }).first();
  let addConfirmFound = await addConfirmBtnInPage.isVisible({ timeout: 8000 }).catch(() => false);

  if (!addConfirmFound) {
    // 备用：Context Pane 可能渲染在 iframe 内
    const addConfirmBtnInFrame = vnetFrame.getByRole('button', { name: /^Add$/i }).first();
    addConfirmFound = await addConfirmBtnInFrame.isVisible({ timeout: 5000 }).catch(() => false);
    if (addConfirmFound) {
      await addConfirmBtnInFrame.click();
      console.log('  [addr] Add subnet 已确认（iframe 内）');
    }
  } else {
    await addConfirmBtnInPage.click();
    console.log('  [addr] Add subnet 已确认（主页面）');
  }

  if (!addConfirmFound) {
    console.warn('  [addr] 警告：未找到 Add subnet 确认按钮，等待后继续...');
    await page.waitForTimeout(3000);
  }

  await page.waitForTimeout(2000);
  await takeScreenshot(page, 'vnet01-address-space-with-subnet.png');
}

/**
 * 提交 VNet 创建（Review + create → 等待校验 → Create）
 * 然后等待部署详情页显示 "Your deployment is complete"（最多 5 分钟）
 *
 * 关键点：
 * - "Review + create" tab 通过 vnetFrame.getByRole('tab', ...) 点击
 * - "Validation passed" 状态在 iframe 内以 status 元素呈现
 * - Create 按钮通过 data-testid="createButton" 定位
 * - 提交后页面跳转到 DeploymentDetails，部署结果在内嵌 iframe 中渲染
 */
async function submitAndWaitForVNet(page, vnetName) {
  const vnetFrame = page.frameLocator(VNET_IFRAME);

  // 点击 "Review + create"
  console.log(`  [submit] 点击 Review + create...`);
  await vnetFrame.getByRole('tab', { name: 'Review + create' }).click();
  await page.waitForTimeout(2000);

  // 等待校验通过（status 文字 "Validation passed" 出现在 iframe 内）
  console.log(`  [submit] 等待 Validation passed...`);
  await vnetFrame.getByText(/Validation passed/i)
    .waitFor({ state: 'visible', timeout: 30000 });
  await takeScreenshot(page, `${vnetName}-review-create.png`);
  console.log(`  [submit] 校验通过`);

  // 点击 "Create"（data-testid 在实际 Portal 中已确认）
  console.log(`  [submit] 点击 Create...`);
  await vnetFrame.getByTestId('createButton').click();
  await page.waitForTimeout(3000);

  // 等待跳转到 DeploymentDetails 页
  console.log(`  [submit] 等待跳转到部署详情页...`);
  await page.waitForURL(/DeploymentDetails/i, { timeout: 60000 });
  console.log(`  [submit] 已跳转到部署详情页，等待部署完成...`);

  // 轮询检查所有 frames 中的 "Your deployment is complete"（最多 5 分钟）
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    for (const frame of [page, ...page.frames()]) {
      const complete = await frame.locator('text=Your deployment is complete')
        .isVisible({ timeout: 500 }).catch(() => false);
      if (complete) {
        await takeScreenshot(page, `${vnetName}-deployed.png`);
        console.log(`  [submit] ✅ ${vnetName} 部署完成！`);
        return;
      }
    }

    // 检查部署失败信号
    const failed = await page.locator('text=Deployment failed').isVisible({ timeout: 500 }).catch(() => false);
    if (failed) throw new Error(`${vnetName} 部署失败`);

    await page.waitForTimeout(5000);
  }

  throw new Error(`${vnetName} 部署超时（5 分钟）`);
}

// ── 主流程 ────────────────────────────────────────────────────────────

(async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   测试前准备：创建 lyx-vnet01 和 lyx-vnet02      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // ── 启动 Edge 浏览器 ─────────────────────────────────────────────
  let context;
  try {
    // 优先复用系统 Edge 配置文件（含已登录账号会话，避免重新登录）
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
    console.log(`[1] Edge 默认配置文件不可用（${e.message.split('\n')[0]}）`);
    console.log('[1b] 改用独立测试配置文件（首次运行需手动完成登录）...');
    context = await chromium.launchPersistentContext(TEST_PROFILE_DIR, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
    });
  }

  // 保持单一页面（关闭多余 tab）
  const pages = context.pages();
  let page = pages.find(p => p.url() && p.url() !== 'about:blank') || pages[0];
  if (!page) page = await context.newPage();

  const keepSinglePage = async (p) => { if (p !== page) await p.close().catch(() => {}); };
  for (const p of context.pages()) await keepSinglePage(p);
  context.on('page', keepSinglePage);

  try {
    // ── Step 1: 导航到 Azure Portal（带 NGINXaaS Feature Flags）─────
    console.log('[2] 导航到 Azure Portal（与 NGINXaaS 测试使用相同 URL）...');
    await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    // ── Step 2: 处理登录/账号选择 ───────────────────────────────────
    console.log('[3] 处理登录/账号选择流程...');
    await handleLoginFlow(page, TARGET_ACCOUNT);

    // ── Step 3: 等待 Portal 首页加载 ────────────────────────────────
    console.log('[4] 等待 Portal 首页加载（最多 120 秒）...');
    await waitForPortalReady(page);
    console.log('[4] Portal 首页已就绪');

    // ── Step 4: 导航到 Virtual networks 列表 ────────────────────────
    console.log('[5] 导航到 Virtual networks 列表...');
    await navigateToVNetList(page);

    // ══════════════════════════════════════════════════════
    //   创建 lyx-vnet01（地址空间 /28，自定义 /28 子网）
    // ══════════════════════════════════════════════════════

    console.log(`\n[6] 检查 ${VNET01_NAME} 是否已存在...`);
    const vnet01Exists = await vnetExistsInList(page, VNET01_NAME);

    if (vnet01Exists) {
      console.log(`[6] ${VNET01_NAME} 已存在，跳过创建`);
    } else {
      console.log(`[6] 开始创建 ${VNET01_NAME}...`);

      // 点击 Create 按钮（BrowseResource.ReactView iframe 内的 menuitem）
      const createBtn1 = page
        .frameLocator('iframe[name="BrowseResource.ReactView"]')
        .locator('[role="menuitem"]:has-text("Create")');
      await createBtn1.waitFor({ state: 'visible', timeout: 30000 });
      await createBtn1.click();

      // 等待 VNet 创建向导加载
      console.log('[7] 等待 VNet 创建向导加载...');
      await waitForVNetCreateForm(page);

      // 填写 Basics 信息
      console.log('[8] 填写 Basics 信息...');
      await fillVNetBasics(page, VNET01_NAME);

      // 配置地址空间（/28 + 新 /28 子网）
      console.log('[9] 配置地址空间（/28 + /28 子网）...');
      await configureVNet01AddressSpace(page);

      // 提交并等待部署完成
      console.log('[10] 提交创建并等待部署...');
      await submitAndWaitForVNet(page, VNET01_NAME);
    }

    // ── 回到 Virtual networks 列表 ──────────────────────────────────
    console.log(`\n[11] 返回 Virtual networks 列表...`);
    await navigateToVNetList(page);

    // ══════════════════════════════════════════════════════
    //   创建 lyx-vnet02（默认 /16 地址空间，保留默认子网）
    // ══════════════════════════════════════════════════════

    console.log(`\n[12] 检查 ${VNET02_NAME} 是否已存在...`);
    const vnet02Exists = await vnetExistsInList(page, VNET02_NAME);

    if (vnet02Exists) {
      console.log(`[12] ${VNET02_NAME} 已存在，跳过创建`);
    } else {
      console.log(`[12] 开始创建 ${VNET02_NAME}...`);

      const createBtn2 = page
        .frameLocator('iframe[name="BrowseResource.ReactView"]')
        .locator('[role="menuitem"]:has-text("Create")');
      await createBtn2.waitFor({ state: 'visible', timeout: 30000 });
      await createBtn2.click();

      console.log('[13] 等待 VNet 创建向导加载...');
      await waitForVNetCreateForm(page);

      // 填写 Basics（地址空间保持默认 /16，跳过 Address space tab）
      console.log('[14] 填写 Basics 信息（保留默认地址空间 /16）...');
      await fillVNetBasics(page, VNET02_NAME);

      // 提交并等待部署完成（不修改 Address space，直接 Review + create）
      console.log('[15] 提交创建并等待部署...');
      await submitAndWaitForVNet(page, VNET02_NAME);
    }

    // ── Step 最终：回到 Portal 首页，准备开始 NGINXaaS 测试 ──────────
    console.log('\n[16] 回到 Portal 首页，准备开始 NGINXaaS 部署创建测试...');
    await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForPortalReady(page);
    await takeScreenshot(page, 'setup-complete-portal-home.png');

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  ✅ 准备工作完成！两个 VNet 均已就绪              ║');
    console.log('║     lyx-vnet01: 10.0.0.0/28                      ║');
    console.log('║     lyx-vnet02: 10.0.0.0/16                      ║');
    console.log('║  现在可以运行 test-nginxaas.js 开始正式测试       ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

  } catch (err) {
    console.error('\n❌ 准备工作出错:', err.message);
    await takeScreenshot(page, 'setup-error.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    // 浏览器保持打开，方便继续进行 NGINXaaS 测试
    // 如需关闭，取消注释下行：
    // await context.close();
  }
})();
