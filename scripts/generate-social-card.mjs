import puppeteer from 'puppeteer';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, '../docs/social-card.html');
const outPath = resolve(__dirname, '../docs/social-card.png');

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 2 });
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1280, height: 640 } });
await browser.close();

console.log(`Social card saved to ${outPath}`);
