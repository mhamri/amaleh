import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicDir, openPage, sleep, fail, checkPayload, countOf } from '../browser-harness.mjs';

const installCommands = [
  'git clone https://github.com/mhamri/amaleh',
  'cd amaleh',
  'bun amaleh/scripts/run.ts doctor',
  'bun amaleh/scripts/run.ts install',
].join('\n');

const cloneCommand = 'git clone https://github.com/mhamri/amaleh';

function copyButtonIn(tab, anchorSelector) {
  return tab.page.evaluateHandle((selector) => {
    const block = document.querySelector(selector)?.closest('section');
    const figure = block?.querySelector('figure') ?? block;
    return (
      [...(figure?.querySelectorAll('button') ?? [])].find(
        (button) => button.getAttribute('type') === 'button' && /copy/i.test(button.textContent ?? ''),
      ) ?? null
    );
  }, anchorSelector);
}

const exists = (handle) => handle.evaluate((node) => node !== null);
const labelOf = (handle) => handle.evaluate((button) => button.textContent.trim());
const clipboardText = async (tab) =>
  (await tab.page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

async function requireButton(tab, anchorSelector, where) {
  const handle = await copyButtonIn(tab, anchorSelector);
  if (!(await exists(handle))) {
    fail(`${where}: no type="button" Copy button inside the code figure`);
    return null;
  }
  const label = await labelOf(handle);
  if (label !== 'Copy') fail(`${where}: the Copy button reads "${label}" before any click, expected "Copy"`);
  return handle;
}

function expectOne(wins, location, where) {
  const matching = wins.filter((entry) => entry.event === 'amaleh_install_copied');
  if (matching.length !== 1) {
    fail(`${where}: expected exactly one amaleh_install_copied, found ${matching.length}`);
    return;
  }
  if (matching[0].win_location !== location) {
    fail(`${where}: win_location is ${JSON.stringify(matching[0].win_location)}, expected "${location}"`);
  }
  checkPayload(matching[0], where);
}

async function homeInstallCopy(site) {
  const tab = await openPage(site, { width: 1440, clipboard: true });
  await tab.goto('/');
  const button = await requireButton(tab, '#install', 'home install');
  if (button) {
    await button.click();
    await sleep(400);
    const copied = await clipboardText(tab);
    if (copied !== installCommands) {
      fail(`home install Copy wrote ${JSON.stringify(copied)} to the clipboard, expected the four install commands`);
    }
    const after = await labelOf(button);
    if (after !== 'Copied') fail(`home install Copy button reads "${after}" after a successful copy, expected "Copied"`);
    expectOne(await tab.wins(), 'install', 'home install Copy click');
    await button.click();
    await sleep(300);
    if (countOf(await tab.wins(), 'amaleh_install_copied') > 1) {
      fail('home: a second copy in the same session recorded a second amaleh_install_copied');
    }
    await sleep(2200);
    const settled = await labelOf(button);
    if (settled !== 'Copy') fail(`home install Copy button reads "${settled}" about two seconds after a copy, expected "Copy"`);
  }
  for (const error of tab.errors) fail(`home logged a page error during the install copy probe: ${error}`);
  await tab.close();
}

async function finalCallCopy(site) {
  const tab = await openPage(site, { width: 1440, clipboard: true });
  await tab.goto('/');
  const button = await requireButton(tab, '#final-cta', 'final call to action');
  if (button) {
    await button.click();
    await sleep(400);
    const copied = await clipboardText(tab);
    if (copied !== cloneCommand) {
      fail(`final call Copy wrote ${JSON.stringify(copied)} to the clipboard, expected ${JSON.stringify(cloneCommand)}`);
    }
    expectOne(await tab.wins(), 'final-call', 'final call Copy click');
  }
  for (const error of tab.errors) fail(`home logged a page error during the final call copy probe: ${error}`);
  await tab.close();
}

async function copySelectionOf(tab, target) {
  return tab.page.evaluate((which) => {
    const node =
      which === 'install-pre'
        ? document.getElementById('install')?.closest('section')?.querySelector('pre')
        : document.querySelector(which);
    if (!node) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.execCommand('copy');
    return true;
  }, target);
}

async function gettingStartedCopy(site) {
  const tab = await openPage(site, { width: 1440, clipboard: true });
  await tab.goto('/docs/getting-started/');
  const button = await requireButton(tab, '#install', 'getting-started install');
  if (button) {
    await button.click();
    await sleep(400);
    if (await clipboardText(tab) !== installCommands) {
      fail('getting-started install Copy did not write the four install commands to the clipboard');
    }
    if (countOf(await tab.wins(), 'amaleh_install_copied') !== 1) {
      fail('getting-started: the Copy button did not record exactly one amaleh_install_copied');
    }
  }
  await tab.close();
}

async function visitorSelection(site) {
  const tab = await openPage(site, { width: 1440, clipboard: true });
  await tab.goto('/docs/getting-started/');
  if (!(await copySelectionOf(tab, 'h1'))) fail('getting-started: no h1 to select outside the install block');
  await sleep(300);
  if (countOf(await tab.wins(), 'amaleh_install_copied') !== 0) {
    fail('getting-started: copying the page heading recorded amaleh_install_copied');
  }
  if (!(await copySelectionOf(tab, 'install-pre'))) fail('getting-started: the install section carries no <pre>');
  await sleep(400);
  expectOne(await tab.wins(), 'getting-started', 'getting-started copy of the visitor selection inside the install <pre>');
  for (const error of tab.errors) fail(`getting-started logged a page error during the install copy probe: ${error}`);
  await tab.close();
}

async function refusedClipboard(site) {
  const tab = await openPage(site, { width: 1440 });
  await tab.page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('denied')),
        readText: () => Promise.reject(new Error('denied')),
      },
    });
  });
  await tab.goto('/');
  const button = await requireButton(tab, '#install', 'home install with a refusing clipboard');
  if (button) {
    await button.click();
    await sleep(400);
    const label = await labelOf(button);
    if (label !== 'Copy failed') {
      fail(`home install Copy button reads "${label}" when the clipboard refuses, expected "Copy failed"`);
    }
    if (countOf(await tab.wins(), 'amaleh_install_copied') !== 0) {
      fail('home: a refused clipboard write recorded amaleh_install_copied');
    }
  }
  for (const error of tab.errors) fail(`home with a refusing clipboard logged a page error: ${error}`);
  await tab.close();
}

async function keyboardReach(site) {
  const tab = await openPage(site, { width: 1440, clipboard: true });
  await tab.goto('/');
  let reached = false;
  for (let step = 0; step < 60 && !reached; step += 1) {
    await tab.page.keyboard.press('Tab');
    reached = await tab.page.evaluate(() => {
      const active = document.activeElement;
      return (
        active instanceof HTMLButtonElement &&
        active.type === 'button' &&
        /copy/i.test(active.textContent ?? '') &&
        active.getBoundingClientRect().width > 0
      );
    });
  }
  if (!reached) {
    fail('home: the install Copy button is not reachable by tabbing through the page');
  } else {
    await tab.page.keyboard.press('Enter');
    await sleep(400);
    if (await clipboardText(tab) !== installCommands) {
      fail('home: pressing Enter on the focused install Copy button wrote nothing to the clipboard');
    }
    expectOne(await tab.wins(), 'install', 'home install Copy click from the keyboard');
  }
  await tab.close();
}

async function narrowViewport(site) {
  for (const route of ['/', '/docs/getting-started/']) {
    const tab = await openPage(site, { width: 320 });
    await tab.goto(route);
    const scroll = await tab.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (scroll.scrollWidth > scroll.clientWidth + 1) {
      fail(`${route} with the install Copy buttons scrolls horizontally at 320 CSS pixels: ${scroll.scrollWidth} > ${scroll.clientWidth}`);
    }
    await tab.close();
  }
}

async function commandsWithoutScript() {
  for (const [file, commands] of [['index.html', installCommands], ['docs/getting-started/index.html', installCommands]]) {
    let html = '';
    try {
      html = await readFile(join(publicDir, file), 'utf8');
    } catch (error) {
      fail(`could not read ${file} from the build output: ${error.message}`);
      continue;
    }
    for (const line of commands.split('\n')) {
      if (!html.includes(line)) {
        fail(`${file} does not carry the install command "${line}" in its prerendered HTML, so the commands are not readable with JavaScript disabled`);
      }
    }
  }
}

export async function run(site) {
  await homeInstallCopy(site);
  await finalCallCopy(site);
  await gettingStartedCopy(site);
  await visitorSelection(site);
  await refusedClipboard(site);
  await keyboardReach(site);
  await narrowViewport(site);
  await commandsWithoutScript();
}
