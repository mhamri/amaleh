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

const inspectLabelOverlaps = () => {
  const toViewportPixels = (label) => {
    const box = label.getBBox();
    const matrix = label.getCTM();
    if (!matrix) return null;
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }));
    return {
      x0: Math.min(...corners.map((corner) => corner.x)),
      x1: Math.max(...corners.map((corner) => corner.x)),
      y0: Math.min(...corners.map((corner) => corner.y)),
      y1: Math.max(...corners.map((corner) => corner.y)),
    };
  };
  const problems = [];
  const hero = [...document.querySelectorAll('svg[data-hero-layout]')].filter(
    (svg) => svg.getBoundingClientRect().width > 0 && svg.getBoundingClientRect().height > 0,
  );
  const targets = [
    ...hero.map((svg) => ({ svg, which: `the visible hero SVG (${svg.dataset.heroLayout})` })),
    ...[...document.querySelectorAll('svg[data-topo-svg]')].map((svg) => ({
      svg,
      which: `the topology SVG (${svg.dataset.topoVariant ?? 'variant'})`,
    })),
  ];
  const tolerance = 0.5;
  for (const { svg, which } of targets) {
    const view = svg.viewBox.baseVal;
    if (!view || view.width === 0) continue;
    const declaredDisplay = svg.style.display;
    if (svg.getBoundingClientRect().width === 0) svg.style.display = 'block';
    const drawn = svg.getBoundingClientRect();
    if (drawn.width === 0) {
      svg.style.display = declaredDisplay;
      problems.push({ which, text: 'the SVG has no drawn width even when shown, so its labels could not be measured' });
      continue;
    }
    const labels = [...svg.querySelectorAll('text')]
      .map((label) => ({ label, box: toViewportPixels(label) }))
      .filter((entry) => entry.box && entry.box.x1 > entry.box.x0 && entry.box.y1 > entry.box.y0);
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = labels[i];
        const b = labels[j];
        const overlapX = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0);
        const overlapY = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
        if (overlapX > tolerance && overlapY > tolerance) {
          problems.push({
            which,
            text:
              `"${a.label.textContent.trim().slice(0, 40)}" and "${b.label.textContent.trim().slice(0, 40)}" ` +
              `overlap by ${Math.round(Math.min(overlapX, overlapY) * 10) / 10} CSS pixels`,
          });
        }
      }
    }
    svg.style.display = declaredDisplay;
  }
  return problems;
};

const inspectHeroFit = () => {
  const copyMargin = 4;
  const narrow = 640;
  const problems = [];
  const layouts = [...document.querySelectorAll('svg[data-hero-layout]')];
  const shown = layouts.filter((svg) => {
    const rect = svg.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(svg).visibility !== 'hidden';
  });
  if (shown.length !== 1) {
    problems.push(`the landing page shows ${shown.length} hero layouts at once, expected the wide and the narrow one to swap at ${narrow} CSS pixels`);
    return problems;
  }
  const svg = shown[0];
  const expected = document.documentElement.clientWidth < narrow ? 'narrow' : 'wide';
  if (svg.dataset.heroLayout !== expected) {
    problems.push(`the ${svg.dataset.heroLayout} hero layout is visible at ${document.documentElement.clientWidth} CSS pixels, expected the ${expected} one`);
  }
  const section = svg.closest('section');
  if (!section) {
    problems.push('the visible hero layout sits in no hero section');
    return problems;
  }
  const sectionBox = section.getBoundingClientRect();
  const viewport = { left: 0, right: document.documentElement.clientWidth };
  const copy = [...section.querySelectorAll('h1, p, a.btn')]
    .filter((element) => !svg.contains(element) && element.getBoundingClientRect().width > 0)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent.trim().slice(0, 30),
        box: {
          left: rect.left - copyMargin,
          top: rect.top - copyMargin,
          right: rect.right + copyMargin,
          bottom: rect.bottom + copyMargin,
        },
      };
    });
  const drawn = [];
  const add = (what, left, top, right, bottom) => drawn.push({ what, box: { left, top, right, bottom } });
  for (const line of svg.querySelectorAll('[data-link]')) {
    const matrix = line.getScreenCTM();
    if (!matrix) continue;
    const at = (x, y) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f });
    const start = at(line.x1.baseVal.value, line.y1.baseVal.value);
    const end = at(line.x2.baseVal.value, line.y2.baseVal.value);
    add(
      `the ${line.getAttribute('data-kind')} line ${line.getAttribute('data-link')}`,
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.max(start.x, end.x),
      Math.max(start.y, end.y),
    );
  }
  for (const group of svg.querySelectorAll('g[data-model]')) {
    const name = group.querySelector('text[data-label]')?.textContent.trim() ?? group.dataset.model;
    for (const [what, selector] of [['tile', 'rect[data-tile]'], ['label', 'text[data-label]']]) {
      const element = group.querySelector(selector);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      add(`the ${what} of ${name}`, rect.left, rect.top, rect.right, rect.bottom);
    }
  }
  const ring = svg.querySelector('[data-role="coordinator"]');
  if (!ring) {
    problems.push('the visible hero layout draws no coordinator ring');
  } else {
    const rect = ring.getBoundingClientRect();
    add('the coordinator ring', rect.left, rect.top, rect.right, rect.bottom);
  }
  const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const { what, box } of drawn) {
    if (box.left < viewport.left - 0.5 || box.right > viewport.right + 0.5) {
      problems.push(`${what} leaves the viewport: it runs from ${Math.round(box.left)} to ${Math.round(box.right)} across a ${Math.round(viewport.right)} CSS pixel page`);
    }
    if (box.top < sectionBox.top - 0.5 || box.bottom > sectionBox.bottom + 0.5) {
      problems.push(`${what} leaves the hero section: it runs from ${Math.round(box.top)} to ${Math.round(box.bottom)} across a section ${Math.round(sectionBox.height)} CSS pixels tall`);
    }
    const near = copy.find((entry) => meets(box, entry.box));
    if (near) problems.push(`${what} sits within ${copyMargin} CSS pixels of the hero copy "${near.text}"`);
  }
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

        if (route === '/') {
          for (const problem of await withinStep(page.evaluate(inspectHeroFit), `${route} at ${width}px hero fit inspection`)) {
            failures.push(`${route} at ${width}px: ${problem}`);
          }
        }

        if (width === 320 || width === 768 || width === 1440) {
          for (const problem of await withinStep(page.evaluate(inspectLabels), `${route} at ${width}px label inspection`)) {
            failures.push(`${route} at ${width}px: label "${problem.text}" ${problem.kind}`);
          }
          for (const problem of await withinStep(page.evaluate(inspectLabelOverlaps), `${route} at ${width}px label overlap inspection`)) {
            failures.push(`${route} at ${width}px: two labels cross inside ${problem.which}: ${problem.text}`);
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

  {
    const tab = await openPage(site, { width: 1440 });
    const page = tab.page;
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(origin + '/', { waitUntil: 'networkidle0' });
      await sleep(250);
      for (const width of [390, 1440]) {
        await page.setViewport({ width, height: 900 });
        await sleep(250);
        for (const problem of await withinStep(page.evaluate(inspectHeroFit), `/ resized to ${width}px hero fit inspection`)) {
          failures.push(`/ resized from 1440px to ${width}px: ${problem}`);
        }
      }
    } catch (error) {
      failures.push(`/ could not be inspected after a resize: ${error.message}`);
    } finally {
      await tab.close().catch(() => {});
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
    'no SVG label escaping its viewBox or straddling a card edge, no two labels crossing inside the visible hero or a topology SVG, the visible hero layout inside the viewport and away from the copy at every width and after a 1440 to 390 to 1440 resize, no animation under prefers-reduced-motion, ' +
    'every route still readable with JavaScript disabled, and the consent banner visible at 320 CSS pixels ' +
    'with timezone Europe/Berlin on every route without overflow or errors.',
);