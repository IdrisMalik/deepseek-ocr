/**
 * Browser regression tests for release-critical interactions that the smoke
 * suite does not cover: focus restoration across DOM rebuilds, responsive
 * layout variants, result preservation, Rich-layout recovery, partial batch
 * failures, and keyboard extraction.
 *
 * Demo mode makes no network calls. Live-mode cases seed a fake key and
 * intercept the OCR endpoint, so no request can reach DeepSeek.
 */
import { expect, test, type Page } from '@playwright/test';

const KEY_STORAGE = 'deepseek-ocr:api-key';
const FAKE_KEY = 'sk-interaction-test';

type Box = { x: number; y: number; width: number; height: number };

async function seedFakeKey(page: Page): Promise<void> {
  await page.addInitScript(({ name, value }) => window.localStorage.setItem(name, value), {
    name: KEY_STORAGE,
    value: FAKE_KEY,
  });
}

async function openDemo(page: Page): Promise<void> {
  await page.goto('/?demo=1');
}

async function addFiles(page: Page, files: string[], expectedCount = files.length): Promise<void> {
  await page.setInputFiles('#fileInput', files);
  await expect(page.getByTestId('attachment')).toHaveCount(expectedCount);
}

async function mockOcr(page: Page, requests: string[]): Promise<void> {
  await page.route('**/v1/tools/ocr', async (route) => {
    const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
    const name = body.includes('sample.jpg') ? 'sample.jpg' : 'sample.png';
    requests.push(name);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pages: [
          {
            index: 0,
            text: name === 'sample.jpg' ? 'JPG text.' : 'PNG text.',
            finish_reason: 'stop',
          },
        ],
      }),
    });
  });
}

function boxesFor(page: Page): Promise<{ composer: Box | null; result: Box | null }> {
  return Promise.all([
    page.locator('#composer').boundingBox(),
    page.getByTestId('result-panel').boundingBox(),
  ]).then(([composer, result]) => ({ composer, result }));
}

async function expectSideBySide(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const { composer, result } = await boxesFor(page);
      return (
        composer !== null &&
        result !== null &&
        result.x >= composer.x + composer.width - 2 &&
        result.y < composer.y + composer.height &&
        composer.y < result.y + result.height
      );
    })
    .toBe(true);
}

async function expectStacked(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const { composer, result } = await boxesFor(page);
      return (
        composer !== null &&
        result !== null &&
        result.y >= composer.y + composer.height - 2 &&
        result.x < composer.x + composer.width &&
        composer.x < result.x + result.width
      );
    })
    .toBe(true);
}

test.describe('focus restoration', () => {
  test('removing a thumbnail moves focus to the remaining file', async ({ page }) => {
    await openDemo(page);
    await addFiles(page, ['tests/fixtures/sample.png', 'tests/fixtures/sample.jpg']);

    const removeJpg = page.locator(
      '[data-testid="attachment"][data-name="sample.jpg"] [data-action="remove"]'
    );
    await removeJpg.focus();
    await removeJpg.click();

    await expect(
      page.locator('[data-testid="attachment"][data-name="sample.png"] [data-action="remove"]')
    ).toBeFocused();
  });

  test('removing or clearing the last file restores focus to Browse', async ({ page }) => {
    await openDemo(page);
    await addFiles(page, ['tests/fixtures/sample.png']);

    await page.locator('[data-testid="attachment"] [data-action="remove"]').click();
    await expect(page.locator('#browseLink')).toBeFocused();

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();

    await page.getByTestId('clear-button').click();
    await expect(page.locator('#browseLink')).toBeFocused();
    await expect(page.getByTestId('result-panel')).toBeHidden();
  });

  test('cancelling a live batch returns focus to Extract', async ({ page }) => {
    await seedFakeKey(page);
    // Hold the request open so the test can cancel before it settles.
    await page.route('**/v1/tools/ocr', () => {});
    await page.goto('/');
    await expect(page.getByTestId('mode-badge')).toHaveText('Live mode');

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('progress-wrap')).toBeVisible();

    await page.getByTestId('cancel-button').click();
    await expect(page.getByTestId('extract-button')).toBeFocused();
  });
});

test.describe('workflow state', () => {
  test('adding a file preserves completed results and leaves only the new file pending', async ({
    page,
  }) => {
    await openDemo(page);
    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('text-editor')).toHaveValue(/sample\.png/);

    await addFiles(page, ['tests/fixtures/sample.jpg'], 2);
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.getByTestId('text-editor')).toHaveValue(/sample\.png/);
    await expect(page.getByTestId('extract-button')).toContainText('Extract text');

    await page.getByTestId('extract-button').click();
    await expect(page.locator('.result-tab')).toHaveCount(3);

    const jpgTab = page
      .getByTestId('result-tabs')
      .getByRole('button', { name: 'sample.jpg', exact: true });
    await jpgTab.click();
    await expect(jpgTab).toBeFocused();
    await expect(page.getByTestId('text-editor')).toHaveValue(/sample\.jpg/);
  });

  test('Ctrl/Cmd+Enter extracts only pending files and preserves completed edits', async ({
    page,
  }) => {
    await seedFakeKey(page);
    const requests: string[] = [];
    await mockOcr(page, requests);
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('text-editor')).toHaveValue('PNG text.');
    await expect(page.getByTestId('extract-button')).toContainText('Re-extract all');

    await page.getByTestId('text-editor').fill('Edited PNG');
    await expect(page.getByTestId('revert-button')).toBeVisible();

    await addFiles(page, ['tests/fixtures/sample.jpg'], 2);
    await expect(page.getByTestId('extract-button')).toContainText('Extract text');
    expect(requests).toEqual(['sample.png']);

    await page.getByTestId('text-editor').blur();
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.result-tab')).toHaveCount(3);

    expect(requests).toEqual(['sample.png', 'sample.jpg']);
    await expect(page.getByTestId('text-editor')).toHaveValue('Edited PNG');
    await page
      .getByTestId('result-tabs')
      .getByRole('button', { name: 'sample.jpg', exact: true })
      .click();
    await expect(page.getByTestId('text-editor')).toHaveValue('JPG text.');
  });

  test('Ctrl/Cmd+Enter is ignored in settings and the result editor', async ({ page }) => {
    await seedFakeKey(page);
    const requests: string[] = [];
    await mockOcr(page, requests);
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('text-editor')).toHaveValue('PNG text.');
    expect(requests).toEqual(['sample.png']);

    await page.locator('#keyButton').click();
    await expect(page.getByTestId('key-panel')).toBeVisible();
    await page.locator('#keyClose').focus();
    const settingsRequest = page
      .waitForRequest('**/v1/tools/ocr', { timeout: 500 })
      .catch(() => null);
    await page.keyboard.press('Control+Enter');
    expect(await settingsRequest).toBeNull();
    await expect(page.getByTestId('key-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('key-panel')).toBeHidden();

    await page.getByTestId('text-editor').fill('Edited PNG');
    const editorRequest = page
      .waitForRequest('**/v1/tools/ocr', { timeout: 500 })
      .catch(() => null);
    await page.keyboard.press('Control+Enter');
    expect(await editorRequest).toBeNull();
    await expect(page.getByTestId('text-editor')).toHaveValue('Edited PNG');
    expect(requests).toEqual(['sample.png']);
  });

  test('Ctrl/Cmd+Enter re-extracts all files once every result is complete', async ({ page }) => {
    await seedFakeKey(page);
    const requests: string[] = [];
    await mockOcr(page, requests);
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png', 'tests/fixtures/sample.jpg']);
    await page.getByTestId('extract-button').click();
    await expect(page.locator('.result-tab')).toHaveCount(3);
    await expect(page.getByTestId('extract-button')).toContainText('Re-extract all');
    expect(requests).toHaveLength(2);

    await page.locator('h1').click();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => requests.length).toBe(4);
    expect(requests.slice(2).sort()).toEqual(['sample.jpg', 'sample.png']);
    await expect(page.locator('.result-tab')).toHaveCount(3);
  });

  test('truncated Standard output can be retried with Rich layout', async ({ page }) => {
    await seedFakeKey(page);
    const purposes: string[] = [];
    await page.route('**/v1/tools/ocr', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const rich = body.includes('rich_layout_recognition');
      purposes.push(rich ? 'rich_layout_recognition' : 'text_recognition');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [
            {
              index: 0,
              text: rich ? 'Rich layout recovered text.' : 'Standard output reached the limit.',
              finish_reason: rich ? 'stop' : 'length',
            },
          ],
        }),
      });
    });
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('truncated-notice')).toBeVisible();
    await expect(page.getByTestId('layout-retry')).toBeVisible();
    await expect(page.getByTestId('text-editor')).toHaveValue('Standard output reached the limit.');
    await page.getByTestId('text-editor').fill('Edited standard output');
    await expect(page.getByTestId('revert-button')).toBeVisible();

    await page.getByTestId('layout-retry').click();
    await expect(page.getByTestId('text-editor')).toHaveValue('Rich layout recovered text.');
    await expect(page.getByTestId('revert-button')).toBeHidden();
    await expect(page.getByTestId('truncated-notice')).toBeHidden();
    expect(purposes).toEqual(['text_recognition', 'rich_layout_recognition']);
  });

  test('a failed Rich retry keeps the previous Standard result and edit', async ({ page }) => {
    await seedFakeKey(page);
    const purposes: string[] = [];
    await page.route('**/v1/tools/ocr', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const rich = body.includes('rich_layout_recognition');
      purposes.push(rich ? 'rich_layout_recognition' : 'text_recognition');
      if (rich) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Rich layout is unavailable.' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [
            {
              index: 0,
              text: 'Standard output kept after retry.',
              finish_reason: 'length',
            },
          ],
        }),
      });
    });
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('truncated-notice')).toBeVisible();
    const editor = page.getByTestId('text-editor');
    await expect(editor).toHaveValue('Standard output kept after retry.');
    await editor.fill('Edited standard output');
    await expect(page.getByTestId('revert-button')).toBeVisible();

    await page.getByTestId('layout-retry').click();
    await expect(page.locator('[data-testid="attachment"].error')).toBeVisible();
    await expect(editor).toHaveValue('Edited standard output');
    await expect(editor).toHaveJSProperty('readOnly', false);
    await expect(page.getByTestId('truncated-notice')).toBeVisible();
    await expect(page.getByTestId('layout-retry')).toBeVisible();
    await expect(page.getByTestId('layout-retry')).toBeEnabled();
    await expect(page.getByTestId('revert-button')).toBeVisible();
    await expect(page.getByTestId('extract-button')).toContainText('Extract text');
    expect(purposes).toEqual(['text_recognition', 'rich_layout_recognition']);
  });

  test('a partial re-extract keeps the failed file’s previous result', async ({ page }) => {
    await seedFakeKey(page);
    let batch = 0;
    await page.route('**/v1/tools/ocr', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const jpg = body.includes('sample.jpg');
      if (batch === 1 && jpg) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'JPG re-extraction rejected.' } }),
        });
        return;
      }
      const text = jpg
        ? batch === 0
          ? 'JPG original result.'
          : 'JPG updated result.'
        : batch === 0
          ? 'PNG original result.'
          : 'PNG updated result.';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [{ index: 0, text, finish_reason: 'stop' }],
        }),
      });
    });
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png', 'tests/fixtures/sample.jpg']);
    await page.getByTestId('extract-button').click();
    await expect(page.locator('.result-tab')).toHaveCount(3);
    const tabs = page.getByTestId('result-tabs');
    await tabs.getByRole('button', { name: 'sample.png', exact: true }).click();
    await expect(page.getByTestId('text-editor')).toHaveValue('PNG original result.');
    await tabs.getByRole('button', { name: 'sample.jpg', exact: true }).click();
    await expect(page.getByTestId('text-editor')).toHaveValue('JPG original result.');

    batch = 1;
    await page.getByTestId('extract-button').click();
    await expect(
      page.locator('[data-testid="attachment"][data-name="sample.jpg"].error')
    ).toBeVisible();
    await expect(page.locator('.toast.error')).toContainText('Could not extract text from 1 file.');
    await expect(page.locator('.result-tab')).toHaveCount(3);
    await tabs.getByRole('button', { name: 'sample.png', exact: true }).click();
    await expect(page.getByTestId('text-editor')).toHaveValue('PNG updated result.');
    await tabs.getByRole('button', { name: 'sample.jpg', exact: true }).click();
    await expect(page.getByTestId('text-editor')).toHaveValue('JPG original result.');
  });

  test('cancelling a re-extract keeps the previous result', async ({ page }) => {
    await seedFakeKey(page);
    let calls = 0;
    await page.route('**/v1/tools/ocr', async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            pages: [{ index: 0, text: 'Original result.', finish_reason: 'stop' }],
          }),
        });
      }
      // Leave the replacement request pending until the batch is cancelled.
    });
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('text-editor')).toHaveValue('Original result.');

    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('progress-wrap')).toBeVisible();
    await page.getByTestId('cancel-button').click();

    await expect(page.getByTestId('text-editor')).toHaveValue('Original result.');
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.locator('[data-testid="attachment"]')).toContainText('Cancelled');
    await expect(page.getByTestId('extract-button')).toBeEnabled();
  });

  test('Rich retry is hidden when no Standard result is truncated', async ({ page }) => {
    await seedFakeKey(page);
    await page.route('**/v1/tools/ocr', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const rich = body.includes('rich_layout_recognition');
      const jpg = body.includes('sample.jpg');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [
            {
              index: 0,
              text: rich ? 'Rich output reached the limit.' : jpg ? 'JPG text.' : 'PNG text.',
              finish_reason: rich ? 'length' : 'stop',
            },
          ],
        }),
      });
    });
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.locator('label[for="modeRich"]').click();
    await expect(page.getByTestId('purpose-rich')).toBeChecked();
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('truncated-notice')).toBeVisible();
    await expect(page.getByTestId('layout-retry')).toBeHidden();

    await page.locator('label[for="modeStandard"]').click();
    await expect(page.getByTestId('purpose-standard')).toBeChecked();
    await addFiles(page, ['tests/fixtures/sample.jpg'], 2);
    await page.getByTestId('extract-button').click();
    await expect(page.locator('.result-tab')).toHaveCount(3);
    await page
      .getByTestId('result-tabs')
      .getByRole('button', { name: 'All files', exact: true })
      .click();
    await expect(page.getByTestId('truncated-notice')).toBeVisible();
    await expect(page.getByTestId('layout-retry')).toBeHidden();
  });

  test('a partially failed batch keeps successful results and retries the failed file', async ({
    page,
  }) => {
    await seedFakeKey(page);
    let failJpg = true;
    await page.route('**/v1/tools/ocr', async (route) => {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const isJpg = body.includes('sample.jpg');
      if (isJpg && failJpg) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'The API key is not valid.' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [
            {
              index: 0,
              text: isJpg ? 'Recovered JPG text.' : 'PNG text.',
              finish_reason: 'stop',
            },
          ],
        }),
      });
    });
    await page.goto('/');

    await addFiles(page, ['tests/fixtures/sample.png', 'tests/fixtures/sample.jpg']);
    await page.getByTestId('extract-button').click();

    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.getByTestId('text-editor')).toHaveValue('PNG text.');
    await expect(
      page.locator('[data-testid="attachment"][data-name="sample.jpg"].error')
    ).toBeVisible();
    await expect(page.getByTestId('composer-error')).toBeHidden();
    await expect(page.locator('.toast.error')).toContainText('Could not extract text from 1 file.');

    failJpg = false;
    await page
      .locator('[data-testid="attachment"][data-name="sample.jpg"] [data-action="retry"]')
      .click();
    await expect(page.locator('.result-tab')).toHaveCount(3);

    await page
      .getByTestId('result-tabs')
      .getByRole('button', { name: 'sample.jpg', exact: true })
      .click();
    await expect(page.getByTestId('text-editor')).toHaveValue('Recovered JPG text.');
  });
});

test.describe('responsive layout', () => {
  test('keeps the result beside the composer at wide and short-landscape sizes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDemo(page);
    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expectSideBySide(page);

    await page.setViewportSize({ width: 900, height: 560 });
    await expectSideBySide(page);
  });

  test('stacks the result below the composer on a phone without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);
    await addFiles(page, ['tests/fixtures/sample.png']);
    await page.getByTestId('extract-button').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expectStacked(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
