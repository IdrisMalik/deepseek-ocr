/**
 * Browser smoke tests for the production build (see playwright.config.ts).
 *
 * Demo mode (?demo=1) covers the upload-to-result workflow without any
 * network access. Live-mode cases seed a fake API key and intercept the OCR
 * endpoint with page.route(), so no request leaves the browser and no
 * charges can occur.
 */
import { expect, test, type Page } from '@playwright/test';

const KEY_STORAGE = 'deepseek-ocr:api-key';
/** A clearly fake key: routes are intercepted, so nothing can ever reach DeepSeek. */
const FAKE_KEY = 'sk-browser-test';

async function seedFakeKey(page: Page): Promise<void> {
  await page.addInitScript(({ name, value }) => window.localStorage.setItem(name, value), {
    name: KEY_STORAGE,
    value: FAKE_KEY,
  });
}

async function openDemo(page: Page): Promise<void> {
  await page.goto('/?demo=1');
}

async function addFiles(page: Page, files: string[]): Promise<void> {
  await page.setInputFiles('#fileInput', files);
  await expect(page.getByTestId('attachment')).toHaveCount(files.length);
}

test('demo mode loads with a visible badge and disabled extract', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByTestId('mode-badge')).toHaveText('Demo mode');
  await expect(page.getByTestId('empty-prompt')).toBeVisible();
  await expect(page.getByTestId('extract-button')).toBeDisabled();
});

test('intake rejects unsupported files and lists accepted ones', async ({ page }) => {
  await openDemo(page);
  await page.setInputFiles('#fileInput', 'tests/fixtures/not-an-image.txt');
  await expect(page.locator('.toast.error')).toContainText('not a supported file type');
  await expect(page.getByTestId('attachment')).toHaveCount(0);

  await addFiles(page, ['tests/fixtures/sample.png', 'tests/fixtures/sample.jpg']);
  await expect(page.getByTestId('file-bar')).toContainText('2 files');
});

test('extraction produces editable text with working revert', async ({ page }) => {
  await openDemo(page);
  await addFiles(page, ['tests/fixtures/sample.png']);
  await page.getByTestId('extract-button').click();

  const editor = page.getByTestId('text-editor');
  await expect(editor).toHaveValue(/Demo mode — sample text/);
  await expect(page.getByTestId('result-panel')).toBeVisible();
  await expect(page.getByTestId('text-stats')).toContainText('characters');
  await expect(page.getByTestId('revert-button')).toBeHidden();

  await editor.fill('My manual edit');
  await expect(page.getByTestId('revert-button')).toBeVisible();

  await page.getByTestId('revert-button').click();
  await expect(editor).toHaveValue(/Demo mode — sample text/);
});

test('rotation invalidates a completed result', async ({ page }) => {
  await openDemo(page);
  await addFiles(page, ['tests/fixtures/sample.png']);
  await page.getByTestId('extract-button').click();
  await expect(page.getByTestId('result-panel')).toBeVisible();

  await page.locator('[data-testid="attachment"] [data-action="rotate"]').click();
  await expect(page.locator('.toast')).toContainText('Rotation changed');
  await expect(page.getByTestId('result-panel')).toBeHidden();
  await expect(page.getByTestId('extract-button')).toBeEnabled();
  await expect(page.getByTestId('extract-button')).toContainText('Extract text');
});

test('multiple results expose per-file tabs and a combined view', async ({ page }) => {
  await openDemo(page);
  await addFiles(page, ['tests/fixtures/sample.png', 'tests/fixtures/sample.jpg']);
  await page.getByTestId('extract-button').click();

  await expect(page.locator('.result-tab')).toHaveCount(3);
  const tabs = page.getByTestId('result-tabs');
  await tabs.getByRole('button', { name: 'sample.jpg', exact: true }).click();
  await expect(page.getByTestId('text-editor')).toHaveValue(/sample\.jpg/);

  await tabs.getByRole('button', { name: 'All files', exact: true }).click();
  await expect(page.getByTestId('text-editor')).toHaveValue(/## sample\.png/);
  await expect(page.getByTestId('text-editor')).toHaveValue(/## sample\.jpg/);
});

test('clear all resets the workspace', async ({ page }) => {
  await openDemo(page);
  await addFiles(page, ['tests/fixtures/sample.png']);
  await page.getByTestId('extract-button').click();
  await expect(page.getByTestId('result-panel')).toBeVisible();

  await page.getByTestId('clear-button').click();
  await expect(page.getByTestId('empty-prompt')).toBeVisible();
  await expect(page.getByTestId('attachment')).toHaveCount(0);
  await expect(page.getByTestId('result-panel')).toBeHidden();
  await expect(page.getByTestId('extract-button')).toBeDisabled();
});

test('cancelling aborts an in-flight live batch', async ({ page }) => {
  await seedFakeKey(page);
  // Hold the request open; the test cancels before it could settle.
  await page.route('**/v1/tools/ocr', () => {});
  await page.goto('/');
  await expect(page.getByTestId('mode-badge')).toHaveText('Live mode');

  await addFiles(page, ['tests/fixtures/sample.png']);
  await page.getByTestId('extract-button').click();
  await expect(page.getByTestId('progress-wrap')).toBeVisible();

  await page.getByTestId('cancel-button').click();
  await expect(page.getByTestId('attachment')).toContainText('Cancelled');
  await expect(page.locator('.toast')).toContainText('Cancelled');
  await expect(page.getByTestId('progress-wrap')).toBeHidden();
  await expect(page.getByTestId('extract-button')).toBeEnabled();
});

test('a fully failed batch shows a composer error whose retry recovers', async ({ page }) => {
  await seedFakeKey(page);
  let respondWith: 'unauthorized' | 'recovered' = 'unauthorized';
  await page.route('**/v1/tools/ocr', async (route) => {
    if (respondWith === 'recovered') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [{ index: 0, text: 'Recovered text after retry.', finish_reason: 'stop' }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'The API key is not valid.' } }),
    });
  });
  await page.goto('/');
  await addFiles(page, ['tests/fixtures/sample.png']);
  await page.getByTestId('extract-button').click();

  const composerError = page.getByTestId('composer-error');
  await expect(composerError).toBeVisible();
  await expect(composerError).toContainText('not valid');
  await expect(page.getByTestId('result-panel')).toBeHidden();

  respondWith = 'recovered';
  await composerError.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('text-editor')).toHaveValue('Recovered text after retry.');
  await expect(composerError).toBeHidden();
});
