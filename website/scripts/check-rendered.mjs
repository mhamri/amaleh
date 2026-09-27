// Rendered inspection of the built site, as a check that leaves a receipt.
//
// The type check and the static check read source and markup. Neither can see
// a page that scrolls sideways at 320 pixels, a diagram label clipped at a card
// edge, or an animation that keeps running under prefers-reduced-motion. Those
// have each shipped at least once in this project and were only ever caught by
// pointing a browser at the built output.
//
import { startSite, openPage, sleep, trackingHosts } from './browser-harness.mjs';
import { isTracking } from './browser-harness.mjs';

for (const host of ['googletagmanager.com', 'ads-twitter.com']) {
  if (!trackingHosts.includes(host)) {
    console.error(`The shared harness does not block ${host}, so a test run would reach an ad platform.`);
    process.exit(1);
  }
}

const widths = [320, 390, 768, 1024, 1440];
const routes = [
  '/',
  '/docs/',
  '/docs/getting-started/',
  '/docs/workflow/',
  '/docs/review-and-recovery/',
  '/docs/commands/',
  '/case-study/',
];

const inspectLayout = () => ({
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  headings: document.querySelectorAll('h1').length,
});

const inspectLabels = () => {
  const problems = [];
  document.querySelectorAll('svg').forEach((svg) => {
    const view = svg.viewBox.baseVal;
    if (!view || view.width === 0) return;
    const area = view.width * view.height;
    const cards = [...svg.querySelectorAll('rect')]
      .map((rect) => rect.getBBox())
      .filter(
        (box) =>
          box.width > view.width * 0.04 &&
          box.height > view.height * 0.04 &&
          box.width * box.height < area * 0.55,
      );
    for (const label of svg.querySelectorAll('text')) {
      const box = label.getBBox();
      const text = label.textContent.trim().slice(0, 40);
      if (
        box.x < view.x - 0.5 ||
        box.y < view.y - 0.5 ||
        box.x + box.width > view.x + view.width + 0.5 ||
        box.y + box.height > view.y + view.height + 0.5
      ) {
        problems.push({ kind: 'escapes-viewbox', text });
        continue;
      }
      for (const card of cards) {
        const overlapX = Math.min(box.x + box.width, card.x + card.width) - Math.max(box.x, card.x);
        const overlapY = Math.min(box.y + box.height, card.y + card.height) - Math.max(box.y, card.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const inside =
          box.x >= card.x - 0.5 &&
          box.y >= card.y - 0.5 &&
          box.x + box.width <= card.x + card.width + 0.5 &&
          box.y + box.height <= card.y + card.height + 0.5;
        if (!inside) {
          problems.push({ kind: 'straddles-card', text });
          break;
        }
      }
    }
  });
  return problems;
};

const site = await startSite();
const origin = site.origin;

const stepTimeoutMs = 30000;
const runTimeoutMs = 300000;
const watchdog = setTimeout(() => {
  console.error(`Rendered inspection gave up after ${runTimeoutMs / 1000}s without finishing; a page never settled.`);
  process.exit(1);
}, runTimeoutMs);
watchdog.unref();

function withinStep(promise, what) {
  let timer;
  const expired = new Promise((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} did not finish within ${stepTimeoutMs / 1000}s`)), stepTimeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

const failures = [];
let checkedPages = 0;

try {
  for (const route of routes) {
    for (const width of widths) {
      const tab = await openPage(site, { width });
      const page = tab.page;
      try {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          const url = message.location().url;
          if (url && isTracking(url)) return;
          errors.push(message.text());
        });
        await page.setViewport({ width, height: 900 });
        await page.goto(origin + route, { waitUntil: 'networkidle0' });
        await sleep(250);

        const layout = await withinStep(page.evaluate(inspectLayout), `${route} at ${width}px layout inspection`);
        if (layout.horizontalOverflow) {
          failures.push(
            `${route} at ${width}px scrolls horizontally: scrollWidth ${layout.scrollWidth} against clientWidth ${layout.clientWidth}`,
          );
        }
        if (layout.headings !== 1) {
          failures.push(`${route} at ${width}px has ${layout.headings} h1 elements, expected exactly 1`);
        }
        for (const error of errors) failures.push(`${route} at ${width}px logged an error: ${error}`);

        if (width === 320 || width === 768 || width === 1440) {
          for (const problem of await withinStep(page.evaluate(inspectLabels), `${route} at ${width}px label inspection`)) {
            failures.push(`${route} at ${width}px: label "${problem.text}" ${problem.kind}`);
          }
        }
        checkedPages += 1;
      } catch (error) {
        failures.push(`${route} at ${width}px could not be inspected: ${error.message}`);
      } finally {
        await tab.close().catch(() => {});
      }
    }
  }

  for (const route of routes) {
    const tab = await openPage(site, { width: 320 });
    const page = tab.page;
    try {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const url = message.location().url;
        if (url && isTracking(url)) return;
        errors.push(message.text());
      });
      await page.emulateTimezone('Europe/Berlin');
      await page.setViewport({ width: 320, height: 900 });
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      await sleep(250);

      const banner = await withinStep(
        page.evaluate(() => {
          const element = document.querySelector('[data-consent-banner]');
          if (!element) return { present: false, visible: false };
          const rect = element.getBoundingClientRect();
          return {
            present: true,
            visible: rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden',
          };
        }),
        `${route} consent banner inspection`,
      );
      if (!banner.present || !banner.visible) {
        failures.push(
          `${route} at 320px with timezone Europe/Berlin: [data-consent-banner] must be present and visible`,
        );
      }

      const layout = await withinStep(
        page.evaluate(inspectLayout),
        `${route} at 320px with the consent banner layout inspection`,
      );
      if (layout.horizontalOverflow) {
        failures.push(
          `${route} at 320px with timezone Europe/Berlin and the consent banner visible scrolls horizontally: ` +
            `scrollWidth ${layout.scrollWidth} against clientWidth ${layout.clientWidth}`,
        );
      }
      for (const error of errors) {
        failures.push(`${route} at 320px with the consent banner visible logged an error: ${error}`);
      }
      checkedPages += 1;
    } catch (error) {
      failures.push(`${route} at 320px with timezone Europe/Berlin could not be inspected: ${error.message}`);
    } finally {
      await tab.close().catch(() => {});
    }
  }

  for (const route of routes) {
    const tab = await openPage(site, { width: 1440 });
    const page = tab.page;
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      await withinStep(
        page.evaluate(() => {
          window.__scheduled = 0;
          const request = window.requestAnimationFrame;
          window.requestAnimationFrame = (callback) => {
            window.__scheduled += 1;
            return request(callback);
          };
        }),
        `${route} reduced-motion setup`,
      );
      await sleep(900);
      const moving = await withinStep(
        page.evaluate(() => ({
          scheduled: window.__scheduled,
          running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
        })),
        `${route} reduced-motion inspection`,
      );
      if (moving.scheduled > 0 || moving.running > 0) {
        failures.push(
          `${route} keeps animating under prefers-reduced-motion: ${moving.scheduled} animation frames scheduled, ${moving.running} running animations`,
        );
      }
    } catch (error) {
      failures.push(`${route} under prefers-reduced-motion could not be inspected: ${error.message}`);
    } finally {
      await tab.close().catch(() => {});
    }
  }

  for (const route of routes) {
    const tab = await openPage(site, { width: 1440 });
    const page = tab.page;
    try {
      await page.setJavaScriptEnabled(false);
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
      const text = await withinStep(
        page.evaluate(() => document.body.innerText.trim().length),
        `${route} JavaScript-disabled inspection`,
      );
      if (text < 400) {
        failures.push(`${route} renders only ${text} characters with JavaScript disabled`);
      }
    } catch (error) {
      failures.push(`${route} with JavaScript disabled could not be inspected: ${error.message}`);
    } finally {
      await tab.close().catch(() => {});
    }
  }
} catch (error) {
  failures.push(`Rendered inspection could not run: ${error.message}`);
} finally {
  await site.close().catch(() => {});
  clearTimeout(watchdog);
}

if (failures.length > 0) {
  console.error(`Rendered inspection failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `Rendered inspection passed: ${routes.length} routes at ${widths.join('/')} CSS pixels ` +
    `(${checkedPages} page loads); no horizontal overflow, exactly one h1 per route, no console or page errors, ` +
    'no SVG label escaping its viewBox or straddling a card edge, no animation under prefers-reduced-motion, ' +
    'every route still readable with JavaScript disabled, and the consent banner visible at 320 CSS pixels ' +
    'with timezone Europe/Berlin on every route without overflow or errors.',
);