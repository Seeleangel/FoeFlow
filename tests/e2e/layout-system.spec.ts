/**
 * E2E Tests for AI Layout System
 *
 * Tests for the intelligent layout analysis and generation feature
 * in the Article Generator page.
 */
import { test, expect } from '@playwright/test';

test.describe('AI Layout System', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to generator page
    await page.goto('/');
    // Click on Generator navigation item
    await page.click('button:has-text("文章生成器"), a:has-text("文章生成器"), [data-navigate="generator"]');
    // Wait for page to load
    await page.waitForTimeout(1000);
  });

  test('should analyze article and generate layout strategy', async ({ page }) => {
    // Input article content directly via textarea
    const textarea = page.locator('textarea').first();
    await textarea.fill(`# 315 维权指南

## 一、维权流程

1. 准备证据材料
2. 核实主体信息
3. 明确核心诉求

## 二、常见维权场景

### 1. 网络购物纠纷

- 商品质量问题
- 虚假宣传
- 售后服务

### 2. 服务合同纠纷

- 预付费退款
- 服务质量不达标
`);

    // Wait for templates to load and select one
    await page.waitForTimeout(2000);

    // Click analyze button (智能排版)
    const analyzeButton = page.locator('button:has-text("智能排版")').first();
    await analyzeButton.click();

    // Wait for analysis to complete
    await page.waitForTimeout(5000);

    // Verify layout strategy is generated - check for "换个排版" button appearing
    const generateButton = page.locator('button:has-text("换个排版")');
    await expect(generateButton).toBeVisible({ timeout: 10000 });
  });

  test('should show layout feedback tags after clicking 换个排版', async ({ page }) => {
    // Input article content
    const textarea = page.locator('textarea').first();
    await textarea.fill(`
# 测试文章

这是一段测试内容，用于验证排版反馈功能。

## 第一部分

这是第一部分的内容。
`);

    // Wait for templates to load
    await page.waitForTimeout(2000);

    // Click 智能排版 to analyze
    await page.click('button:has-text("智能排版")');
    await page.waitForTimeout(5000);

    // Select first direction to generate layout
    const directionButton = page.locator('button:has-text("学术"), button:has-text("简洁"), button:has-text("正式"), button:has-text("现代")').first();
    if (await directionButton.isVisible()) {
      await directionButton.click();
      await page.waitForTimeout(10000);
    }

    // Now 换个排版 button should be visible
    const refineButton = page.locator('button:has-text("换个排版")');
    await expect(refineButton).toBeVisible({ timeout: 15000 });

    // Click 换个排版
    await refineButton.click();
    await page.waitForTimeout(2000);

    // Should see feedback tags in chat
    const tagChip = page.locator('button:has-text("颜色")');
    await expect(tagChip).toBeVisible({ timeout: 5000 });
  });

  test('should copy layout HTML to clipboard', async ({ page }) => {
    // Input article content
    const textarea = page.locator('textarea').first();
    await textarea.fill(`
# 测试文章

这是一段测试内容。
`);

    // Wait for templates to load
    await page.waitForTimeout(2000);

    // Click analyze and generate
    await page.click('button:has-text("智能排版")');
    await page.waitForTimeout(5000);
    await page.click('button:has-text("换个排版")');
    await page.waitForTimeout(10000);

    // Grant clipboard permissions for Chromium
    const context = page.context();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Click copy HTML button in layout result section
    const copyButton = page.locator('text=排版结果').locator('..').locator('button:has-text("复制 HTML")').first();
    await expect(copyButton).toBeVisible({ timeout: 15000 });
    await copyButton.click();

    // Verify clipboard contains HTML
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('<section');
    expect(clipboardText).toContain('style=');
  });

  test('should show error when analyzing without content', async ({ page }) => {
    // Wait for templates to load
    await page.waitForTimeout(2000);

    // Click analyze button without any content
    const analyzeButton = page.locator('button:has-text("智能排版")').first();
    await analyzeButton.click();

    // Wait for error message
    await page.waitForTimeout(2000);

    // Verify error message is shown
    const errorMessage = page.locator('text=请先生成文章内容');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });
});
