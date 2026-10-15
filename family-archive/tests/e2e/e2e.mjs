// Сквозная проверка интерфейса в браузере (Playwright).
// По умолчанию — синтетические вымышленные данные; FAMILY_XLSX=путь — проверить свой файл.
// Скриншоты: REVIEW_SCREENSHOTS=/папка (по умолчанию — временная папка).
//   npm install --no-save playwright && npm run build && npm run test:e2e
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, makePng } from '../helpers/harness.js';
import { fixtureXlsx, FIXTURE_RECORDS } from '../helpers/fixture.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Нужен Playwright: npm install --no-save playwright');
  process.exit(1);
}
if (!fs.existsSync(path.resolve(import.meta.dirname, '../../client/dist/index.html'))) {
  console.error('Сначала соберите интерфейс: npm run build');
  process.exit(1);
}

const shotsDir = process.env.REVIEW_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'family-archive-shots-'));
fs.mkdirSync(shotsDir, { recursive: true });
const xlsxPath = process.env.FAMILY_XLSX;
const xlsx = xlsxPath ? fs.readFileSync(xlsxPath) : fixtureXlsx();
const expected = xlsxPath ? null : FIXTURE_RECORDS;

const results = [];
const check = (title, ok, details = '') => {
  results.push({ title, ok });
  console.log(`${ok ? '✓' : '✗'} ${title}${details ? ` — ${details}` : ''}`);
};

const s = await startServer();
const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (name) => page.screenshot({ path: path.join(shotsDir, `${name}.png`) });

  // Импорт через интерфейс.
  await page.goto(`${s.url}/#/import`);
  await page.setInputFiles('input[type=file]', { name: 'Семейное древо .xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await page.waitForSelector('.file-card');
  await shot('01-import-preview');
  await page.getByRole('button', { name: 'Импортировать' }).click();
  await page.waitForSelector('.result-card');
  const resultText = await page.locator('.result-card').innerText();
  check('Импорт через интерфейс сохраняется и показывает итог', /Импорт сохранён/.test(resultText), resultText.split('\n')[1]);

  // Древо без подтверждённых связей: все люди видны, есть приглашение уточнить связи.
  await page.goto(`${s.url}/#/tree`);
  await page.waitForSelector('.react-flow__node-person');
  await page.waitForTimeout(500);
  const nodeCount = await page.locator('.react-flow__node-person').count();
  const recordCount = (await s.get('/api/data')).data.persons.length;
  check('Все записи доступны на древе без ложных связей', nodeCount === recordCount && (await page.locator('.canvas-banner').count()) === 1 && (await page.locator('.react-flow__edge').count()) === 0, `карточек: ${nodeCount}${expected ? ` из ${expected}` : ''}`);
  await shot('02-tree-empty-relations');

  // Исходная схема и предположения пунктиром.
  await page.getByRole('radio', { name: /Исходная схема Excel/ }).click();
  await page.waitForTimeout(900);
  await page.getByText('Показать предположения').click();
  await page.waitForTimeout(500);
  const hypEdges = await page.locator('.react-flow__edge-hypothesis').count();
  check('Исходная схема Excel и предположения пунктиром', (await page.locator('.react-flow__node-person').count()) === recordCount && hypEdges > 0, `пунктирных линий: ${hypEdges}`);
  await shot('03-excel-schema-hypotheses');
  await page.getByText('Показать предположения').click();
  await page.getByRole('radio', { name: /Семейное древо/ }).click();

  // Подтверждение связи в «Уточнить связи».
  await page.goto(`${s.url}/#/questions`);
  await page.waitForSelector('.question-card');
  await shot('04-questions');
  const row = page.locator('li.hyp-row', { hasText: '— родитель' }).first();
  await row.getByRole('button', { name: /Подтвердить/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  await page.waitForTimeout(300);
  const afterConfirm = (await s.get('/api/data')).data;
  check('Подтверждение связи из очереди вопросов', afterConfirm.parentChild.length === 1 && afterConfirm.partnerships.length === 0);
  await page.goto(`${s.url}/#/tree`);
  await page.waitForTimeout(900);
  check('Подтверждённая связь появляется на древе сплошной линией', (await page.locator('.react-flow__edge-parent').count()) === 1);

  // Карточка: редактирование и сохранение после перезагрузки.
  const childId = afterConfirm.parentChild[0].child_id;
  await page.goto(`${s.url}/#/people?p=${childId}`);
  await page.waitForSelector('.panel-name');
  await page.getByRole('button', { name: 'Редактировать' }).click();
  await page.locator('fieldset', { hasText: 'Дата рождения' }).first().locator('select').first().selectOption('year');
  await page.getByLabel('Дата рождения: год').fill('1961');
  await page.getByLabel('Биография').fill('Проверка сохранения биографии.');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForSelector('.save-status.is-saved');
  await page.reload();
  await page.waitForSelector('.panel-name');
  const panelText = await page.locator('.panel').innerText();
  check('Изменения сведений сохраняются после перезагрузки', panelText.includes('1961') && panelText.includes('Проверка сохранения биографии.'));

  // Фотография: загрузка с кадрированием.
  await page.locator('input[type=file][accept*="image"]').setInputFiles({ name: 'портрет.png', mimeType: 'image/png', buffer: makePng(3000, 2000, [180, 160, 120]) });
  await page.waitForSelector('.cropper canvas');
  const note = await page.locator('.compress-note').innerText().catch(() => '');
  await page.waitForTimeout(300);
  await shot('05-photo-cropper');
  await page.getByRole('button', { name: 'Сохранить фото' }).click();
  await page.waitForSelector('.photo-main img');
  const photos = (await s.get('/api/data')).data.photos;
  check('Фотография загружается, кадрируется и сохраняется файлом', photos.length === 1 && fs.existsSync(path.join(s.dir, 'photos', photos[0].id, photos[0].original_file)));
  check('Фото уменьшается и сжимается при загрузке', photos[0].original_width === 2048 && photos[0].original_file.endsWith('.jpg') && /уменьшено/.test(note), `${photos[0].original_width}×${photos[0].original_height}; ${note.slice(0, 80)}`);
  await shot('06-person-card-photo');

  // Добавить ребёнка из существующих людей.
  await page.getByRole('tab', { name: 'Связи' }).click();
  await page.getByRole('button', { name: 'Ребёнок' }).click();
  const dlg = page.getByRole('dialog');
  const parentOfChild = afterConfirm.parentChild[0].parent_id;
  const parentName = afterConfirm.persons.find((p) => p.id === parentOfChild).display_name;
  const disabled = await dlg.locator('.picker-item', { hasText: parentName }).first().isDisabled();
  check('Предок недоступен для выбора ребёнком (защита от цикла)', disabled);
  await dlg.locator('.picker-item:not([disabled])').first().click();
  await dlg.getByRole('button', { name: 'Сохранить связь' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  check('Связь с существующим человеком добавляется из карточки', (await s.get('/api/data')).data.parentChild.length === 2);

  // Новый человек через верхнюю панель.
  await page.getByRole('button', { name: 'Добавить человека' }).first().click();
  await page.getByRole('dialog').getByLabel('Фамилия').fill('Тестова');
  await page.getByRole('dialog').getByLabel('Имя', { exact: true }).fill('Мария');
  await page.getByRole('dialog').getByRole('button', { name: 'Добавить' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  check('Добавление человека', (await s.get('/api/data')).data.persons.some((p) => p.display_name === 'Тестова Мария'));

  // Архив: резервная копия.
  await page.goto(`${s.url}/#/archive`);
  await page.getByRole('button', { name: 'Создать резервную копию' }).click();
  await page.waitForSelector('.backup-list li');
  check('Резервная копия создаётся из интерфейса', (await page.locator('.backup-list li').count()) >= 1);
  await shot('07-archive');

  // Телефон: без горизонтальной прокрутки, карточка — нижней панелью.
  for (const [w, h] of [[390, 844], [320, 640]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const m = await ctx.newPage();
    let overflow = 0;
    for (const v of ['tree', 'people', 'questions', 'import', 'archive']) {
      await m.goto(`${s.url}/#/${v}`);
      await m.waitForTimeout(500);
      overflow += await m.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    }
    await m.goto(`${s.url}/#/people`);
    await m.locator('.people-row').first().click();
    const sheet = await m.locator('.bottom-sheet').isVisible();
    if (w === 390) await m.screenshot({ path: path.join(shotsDir, '08-phone-sheet.png') });
    check(`Телефон ${w}px: нет горизонтальной прокрутки, карточка — нижней панелью`, overflow === 0 && sheet, `переполнение: ${overflow}px`);
    await ctx.close();
  }
  check('Нет ошибок JavaScript в браузере', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await s.close();
}
console.log(`\nСкриншоты: ${shotsDir}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`Итог: пройдено ${results.length - failed} из ${results.length}.`);
process.exit(failed ? 1 : 0);
