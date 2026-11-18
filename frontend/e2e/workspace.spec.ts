import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Simple unsigned 16-bit TIFF with two bright disks, treated as an ordinary imported source. */
function ordinaryTiff(constant = false) {
  const size = 96;
  const tags = [
    [256, 4, size], [257, 4, size], [258, 3, 16], [259, 3, 1], [262, 3, 1],
    [273, 4, 122], [277, 3, 1], [278, 4, size], [279, 4, size * size * 2],
  ];
  const image = Buffer.alloc(122 + size * size * 2);
  image.write('II');
  image.writeUInt16LE(42, 2);
  image.writeUInt32LE(8, 4);
  image.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, type, value], i) => {
    const pos = 10 + i * 12;
    image.writeUInt16LE(tag, pos);
    image.writeUInt16LE(type, pos + 2);
    image.writeUInt32LE(1, pos + 4);
    image.writeUInt32LE(value, pos + 8);
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 100;
      if (!constant && (x - 27) ** 2 + (y - 27) ** 2 < 12 ** 2) value += 2200;
      if (!constant && (x - 66) ** 2 + (y - 60) ** 2 < 12 ** 2) value += 4400;
      image.writeUInt16LE(value, 122 + (y * size + x) * 2);
    }
  }
  return image;
}

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  await expect(page.getByText('Demo / synthetic', { exact: true })).toBeVisible();
  await expect(page.getByText('512 × 512 px · uint16')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze nuclei' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Nuclear channel', exact: true }).selectOption('0');
  await page.getByRole('button', { name: 'Analyze nuclei' }).click();
  await expect(page.getByRole('heading', { name: 'Nucleus 01' })).toBeVisible({ timeout: 30_000 });
}

test('synthetic field works from mapping through reopening and export', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await loadDemo(page);

  const microscope = page.getByRole('group', { name: /Microscopy image/ });
  const row = page.getByRole('button', { name: 'Nucleus 02' });
  await page.getByRole('button', { name: 'Nucleus 01' }).focus();
  await page.keyboard.press('Tab');
  await expect(row).toBeFocused();
  expect(await row.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  await row.press('Enter');
  await expect(page.getByRole('heading', { name: 'Nucleus 02' })).toBeVisible();
  const initialView = await microscope.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => microscope.getAttribute('viewBox')).not.toBe(initialView);
  await page.getByRole('button', { name: 'Nucleus 03' }).click();
  await expect(page.locator('[data-mask="3"]')).toHaveClass(/mask-selected/);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.locator('[data-mask="2"]').click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await row.press('j');
  await expect(page.getByRole('heading', { name: 'Nucleus 03' })).toBeVisible();
  await page.keyboard.press('k');
  await expect(page.getByRole('heading', { name: 'Nucleus 02' })).toBeVisible();

  const measure = page.getByText('Integrated signal', { exact: true }).locator('..').locator('dd');
  const rawSignal = await measure.innerText();
  await page.getByLabel('Brightness').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByLabel('Contrast').focus();
  await page.keyboard.press('ArrowRight');
  await expect(measure).toHaveText(rawSignal);
  await page.getByLabel('Masks', { exact: true }).uncheck();
  await expect(page.locator('[data-mask]')).toHaveCount(0);
  await page.getByLabel('Masks', { exact: true }).check();
  await expect(page.locator('[data-mask]')).toHaveCount(48);
  await page.getByRole('combobox', { name: 'Display channel' }).selectOption('1');
  await expect(page.getByText('Rendering image preview…')).toHaveCount(0);
  await expect(measure).toHaveText(rawSignal);
  await page.getByRole('combobox', { name: 'Display channel' }).selectOption('0');

  const inspector = page.getByRole('complementary', { name: 'Selected nucleus and exports' });
  const original = await inspector.getByText('Suggested label', { exact: true }).locator('..').locator('dd').innerText();
  const newLabel = original === 'S-like' ? 'G1-like' : 'S-like';
  await page.getByRole('combobox', { name: 'Corrected label' }).selectOption(newLabel);
  await page.getByRole('button', { name: 'Apply correction' }).click();
  await expect(inspector.getByText('Reviewed label', { exact: true }).locator('..')).toContainText(newLabel);
  await expect(inspector.getByText('Suggested label', { exact: true }).locator('..')).toContainText(original);
  await page.getByRole('button', { name: 'Undo decision' }).click();
  await expect(inspector.getByText('Pending review')).toBeVisible();
  await page.getByRole('button', { name: 'Apply correction' }).click();
  await expect(inspector.getByText('Reviewed label', { exact: true }).locator('..')).toContainText(newLabel);

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Exclude…' }).click();
  const reason = page.getByRole('textbox', { name: 'Exclusion reason' });
  await reason.fill('Touching nuclei');
  await reason.press('j');
  await expect(page.getByRole('heading', { name: 'Nucleus 03' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm exclusion' }).click();
  await expect(inspector.getByText('Touching nucleij')).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('uncertain');
  await expect(page.getByText(/6 of 48 nuclei/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('reviewed');
  await expect(page.getByText('2 of 48 nuclei')).toBeVisible();

  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(report.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
  if (process.env.SORTACELL_SCREENSHOT) {
    await page.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('all');
    await row.click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: process.env.SORTACELL_SCREENSHOT });
    await page.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('reviewed');
  }

  await page.getByLabel('Session name').fill('Two nucleus decisions');
  await page.getByRole('button', { name: 'Save session' }).click();
  await expect(page.getByText('Saved session “Two nucleus decisions”.')).toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: 'Saved sessions and runs' }).selectOption({ label: 'Two nucleus decisions' });
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('2 of 48 nuclei')).toBeVisible();
  const download = async (format: string) => {
    const [file] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('link', { name: 'Download ' + format }).click(),
    ]);
    return readFile((await file.path())!, 'utf8');
  };
  const csv = await download('CSV');
  const data = JSON.parse(await download('JSON'));
  expect(csv.trimEnd().split(/\r?\n/)).toHaveLength(3);
  expect(data.rowCount).toBe(2);
  expect(data.exportFilter).toBe('reviewed');
  expect(data.source.isSynthetic).toBe(true);
  expect(data.objects.map((item: { review: { reviewStatus: string } }) => item.review.reviewStatus)).toEqual(['corrected', 'excluded']);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Nucleus inspector' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(pageErrors).toEqual([]);
});

test('ordinary TIFF requires axis confirmation and explicit reusable calibration', async ({ page }) => {
  await page.goto('/');
  const upload = page.getByLabel('Open TIFF or OME-TIFF');
  await upload.setInputFiles({ name: 'test-field.tiff', mimeType: 'image/tiff', buffer: ordinaryTiff() });
  await expect(page.getByText('TIFF · YX · uint16')).toBeVisible();
  await page.getByRole('combobox', { name: 'Nuclear channel', exact: true }).selectOption('0');
  await expect(page.getByRole('button', { name: 'Analyze nuclei' })).toBeDisabled();
  await page.getByLabel('Confirm the displayed TIFF axes').check();
  await page.getByRole('button', { name: 'Analyze nuclei' }).click();
  await expect(page.getByText('2 of 2 nuclei')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No dataset calibration. Manual review required.')).toBeVisible();

  await page.getByText('Dataset calibration', { exact: true }).click();
  await page.getByRole('button', { name: 'Create calibration' }).click();
  await page.getByLabel('Dataset scope').fill('Constructed browser test field');
  await page.getByLabel('G1 integrated signal reference').fill('950000');
  await page.getByLabel('Reference provenance').fill('Known pixel values from the generated test case.');
  await expect(page.getByRole('button', { name: 'Save calibration' })).toBeDisabled();
  await page.getByLabel('I confirmed this image is suitable for quantitative DNA measurement.').check();
  await page.getByRole('button', { name: 'Save calibration' }).click();
  await expect(page.getByText('Calibration saved. Run analysis to apply it.')).toBeVisible();
  await page.getByRole('button', { name: 'Run new analysis' }).click();
  await expect(page.getByText(/Unvalidated dataset rule/)).toBeVisible();

  await page.reload();
  await page.getByRole('combobox', { name: 'Imported images' }).selectOption({ label: 'test-field.tiff' });
  await page.getByLabel('Confirm the displayed TIFF axes').check();
  await page.getByRole('combobox', { name: 'Nuclear channel', exact: true }).selectOption('0');
  await page.getByText('Dataset calibration', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Matching calibration' }).locator('option')).toHaveCount(2);
});

test('failed analysis explains the input issue and keeps earlier runs available', async ({ page }) => {
  await loadDemo(page);
  await page.getByLabel('Open TIFF or OME-TIFF').setInputFiles({
    name: 'constant-field.tiff', mimeType: 'image/tiff', buffer: ordinaryTiff(true),
  });
  await page.getByRole('combobox', { name: 'Nuclear channel', exact: true }).selectOption('0');
  await page.getByLabel('Confirm the displayed TIFF axes').check();
  await page.getByRole('button', { name: 'Analyze nuclei' }).click();
  await expect(page.getByRole('alert')).toContainText('Selected plane is constant');
  const savedRun = page.getByRole('combobox', { name: 'Saved sessions and runs' });
  const demoRun = savedRun.locator('optgroup[label="All analysis runs"] option').filter({ hasText: 'SortACell-synthetic.ome.tiff' }).first();
  await savedRun.selectOption((await demoRun.getAttribute('value'))!);
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('48 of 48 nuclei')).toBeVisible();
});
