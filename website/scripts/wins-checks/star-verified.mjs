import { checkPayload, countOf, fail, openPage, sleep } from '../browser-harness.mjs';
import { REPOSITORY_URL, SPONSOR_URL } from '../../src/lib/links.ts';

const starAccept = 'application/vnd.github.star+json';
const starRequestBound = 10;
const repositoryFullName = new URL(REPOSITORY_URL).pathname.replace(/^\/+/, '').replace(/\/+$/, '');
const states = ['ask', 'checking', 'verified', 'confirmed', 'partial', 'not-found', 'no-user', 'busy', 'invalid', 'error'];

function starred(withDates, fullName, starredAt) {
  return withDates ? { starred_at: starredAt, repo: { full_name: fullName } } : { full_name: fullName };
}

const paginatedAccounts = {
  'deep-starrer': { id: 103, pages: 3, repoPage: 2, repoAt: '2020-01-01T00:00:00Z' },
  'huge-starrer': { id: 104, pages: 60, repoPage: null, repoAt: null },
};
const paginatedNameById = new Map(Object.entries(paginatedAccounts).map(([name, account]) => [String(account.id), name]));

function paginatedPage(request, account, withDates) {
  const url = new URL(request.url());
  const page = Number(url.searchParams.get('page') ?? '1');
  const perPage = Number(url.searchParams.get('per_page') ?? '30');
  const now = Date.now();
  const body = [];
  for (let index = 0; index < perPage; index += 1) {
    const at = new Date(now - ((page - 1) * perPage + index + 1) * 3600000).toISOString();
    body.push(starred(withDates, `someone/repo-${page}-${index}`, at));
  }
  if (account.repoPage === page) {
    const at = account.repoAt === 'now' ? new Date(now).toISOString() : account.repoAt;
    body.splice(Math.floor(perPage / 2), 0, starred(withDates, repositoryFullName, at));
    body.length = perPage;
  }
  const pageUrl = (number) => `https://api.github.com/user/${account.id}/starred?per_page=${perPage}&page=${number}`;
  const links = [];
  if (page < account.pages) links.push(`<${pageUrl(page + 1)}>; rel="next"`, `<${pageUrl(account.pages)}>; rel="last"`);
  if (page > 1) links.push(`<${pageUrl(1)}>; rel="first"`, `<${pageUrl(page - 1)}>; rel="prev"`);
  const headers = { 'access-control-expose-headers': 'ETag, Link, Retry-After, X-RateLimit-Remaining' };
  if (links.length) headers.link = links.join(', ');
  return { body, headers };
}

function githubApi(request) {
  const url = new URL(request.url());
  const byName = /^\/users\/([^/]+)\/starred$/.exec(url.pathname);
  const byNumber = /^\/user\/(\d+)\/starred$/.exec(url.pathname);
  const name = byName
    ? decodeURIComponent(byName[1]).toLowerCase()
    : byNumber
      ? (paginatedNameById.get(byNumber[1]) ?? null)
      : null;
  const account = name ? paginatedAccounts[name] : null;
  if (request.method() !== 'GET' || !name) return { status: 404, body: { message: 'Not Found' } };
  const withDates = (request.headers().accept ?? '').includes(starAccept);
  const now = new Date().toISOString();
  if (account) return paginatedPage(request, account, withDates);
  switch (name) {
    case 'fresh-starrer':
      return {
        body: [
          starred(withDates, repositoryFullName, now),
          starred(withDates, 'someone/older', '2020-01-01T00:00:00Z'),
        ],
      };
    case 'mixed-case':
      return { body: [starred(withDates, repositoryFullName.toUpperCase(), now)] };
    case 'old-starrer':
      return {
        body: [
          starred(withDates, 'someone/newer', now),
          starred(withDates, repositoryFullName, '2020-01-01T00:00:00Z'),
        ],
      };
    case 'no-star':
      return { body: [starred(withDates, 'someone/else', now)] };
    case 'ghost':
      return { status: 404, body: { message: 'Not Found' } };
    case 'busy':
      return { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'API rate limit exceeded' } };
    case 'not-an-array':
      return { body: { message: 'Not Found' } };
    case 'not-json':
      // HACK: openPage JSON.stringifies every answer body, so a function body — which JSON.stringify drops — is the only way to answer with an empty, non-JSON body; revisit when the harness can send raw text.
      return { status: 200, body: () => undefined };
    default:
      return null;
  }
}

const reportedStates = new Set();

async function panelState(page) {
  const read = await page.evaluate(() => {
    const panel = document.querySelector('[data-star-check]');
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || getComputedStyle(panel).visibility === 'hidden') return null;
    return panel.getAttribute('data-star-check-state');
  });
  if (read !== null && !states.includes(read) && !reportedStates.has(read)) {
    reportedStates.add(read);
    fail(`a star check panel reports state ${JSON.stringify(read)}; the state must be one of ${states.join(', ')}`);
  }
  return read;
}

async function expectState(page, expected, where) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await panelState(page)) === expected) return;
    await sleep(100);
  }
  fail(`${where}: the star check panel reports ${JSON.stringify(await panelState(page))}, expected ${JSON.stringify(expected)}`);
}

async function blockExternalNavigation(tab) {
  await tab.page.evaluate(() => {
    window.addEventListener(
      'click',
      (event) => {
        const anchor = event.target instanceof Element ? event.target.closest('a[target="_blank"]') : null;
        if (anchor) event.preventDefault();
      },
      true,
    );
  });
}

async function clickStar(tab, selector, where) {
  const handle = await tab.page.$(selector);
  if (!handle) {
    fail(`${where}: no element matches ${selector}`);
    return;
  }
  await handle.click();
  await sleep(300);
}

async function clickByText(page, selector, text, where) {
  const clicked = await page.evaluate(
    (query, label) => {
      const button = [...document.querySelectorAll(query)].find((element) => element.textContent.trim() === label);
      if (!button) return false;
      button.click();
      return true;
    },
    selector,
    text,
  );
  if (!clicked) fail(`${where}: no element matching ${selector} reads ${JSON.stringify(text)}`);
}

async function submitName(page, name, where) {
  const field = await page.$('[data-star-check] input');
  if (!field) {
    fail(`${where}: the star check panel has no username input`);
    return;
  }
  await field.click({ clickCount: 3 });
  await field.press('Backspace');
  if (name.length > 0) await field.type(name);
  await field.press('Enter');
  await sleep(50);
}

function expectStarClick(wins, location, where) {
  const matching = wins.filter((entry) => entry.event === 'amaleh_star_click');
  if (matching.length !== 1) {
    fail(`${where}: expected exactly one amaleh_star_click, found ${matching.length}`);
    return;
  }
  checkPayload(matching[0], where);
  if (matching[0].win_location !== location) {
    fail(`${where}: amaleh_star_click carries win_location ${JSON.stringify(matching[0].win_location)}, expected ${JSON.stringify(location)}`);
  }
}

async function trackStarFetches(page) {
  await page.evaluate(() => {
    window.__starFetchCache = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const cache = init?.cache ?? (input instanceof Request ? input.cache : 'default');
      if (String(url).includes('api.github.com')) window.__starFetchCache.push({ url: String(url), cache });
      return original(input, init);
    };
  });
}

async function expectCacheBypassed(page, where) {
  const fetches = await page.evaluate(() => window.__starFetchCache ?? []);
  if (fetches.length === 0) {
    fail(`${where}: no api.github.com request passed through window.fetch, so the cache mode could not be read`);
    return;
  }
  for (const request of fetches) {
    if (!['no-store', 'no-cache', 'reload'].includes(request.cache)) {
      fail(`${where}: ${request.url} is fetched with cache mode ${JSON.stringify(request.cache)}, so the browser can answer from a cached starred list`);
    }
  }
}

function checkRequests(requests, where) {
  if (requests.length === 0) {
    fail(`${where}: no request reached api.github.com`);
    return;
  }
  for (const request of requests) {
    const url = new URL(request.url);
    if (url.origin !== 'https://api.github.com') fail(`${where}: ${request.url} does not call api.github.com`);
    if (!/^\/(users\/[^/]+|user\/\d+)\/starred$/.test(url.pathname)) fail(`${where}: ${request.url} does not read a GitHub starred list`);
    if (url.searchParams.get('per_page') !== '100') fail(`${where}: ${request.url} does not ask api.github.com for per_page=100`);
    const accept = request.headers.accept ?? '';
    if (!accept.includes(starAccept)) {
      fail(`${where}: the api.github.com request sends Accept ${JSON.stringify(accept)}, expected ${starAccept} so starred_at is readable`);
    }
  }
}

async function checkPanelParts(page, where) {
  const parts = await page.evaluate(() => {
    const panel = document.querySelector('[data-star-check]');
    if (!panel) return null;
    const field = panel.querySelector('input');
    const label = field && field.id ? panel.querySelector(`label[for="${field.id}"]`) : null;
    const live = panel.querySelector('[aria-live="polite"]');
    const rect = panel.getBoundingClientRect();
    return {
      hasState: panel.hasAttribute('data-star-check-state'),
      label: label ? label.textContent.trim() : null,
      live: live ? live.textContent.trim() : null,
      inside:
        rect.left >= -0.5 &&
        rect.right <= window.innerWidth + 0.5 &&
        rect.top >= -0.5 &&
        rect.bottom <= window.innerHeight + 0.5,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  if (!parts) {
    fail(`${where}: the star check panel is not in the document`);
    return;
  }
  if (!parts.hasState) fail(`${where}: the star check panel carries no data-star-check-state attribute`);
  if (!parts.label) fail(`${where}: the star check panel input has no label pointing at it`);
  if (parts.live === null) fail(`${where}: the star check panel has no polite live region`);
  if (!parts.inside) fail(`${where}: the star check panel does not fit inside the viewport`);
  if (parts.overflow) fail(`${where}: the page scrolls horizontally with the star check panel open`);
}

async function liveText(page) {
  return page.evaluate(() => document.querySelector('[data-star-check] [aria-live="polite"]')?.textContent.trim() ?? '');
}

async function storedStarClickAt(page) {
  return page.evaluate(() => {
    const now = Date.now();
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const value = Number(localStorage.getItem(key));
      if (Number.isFinite(value) && value > now - 3600000 && value <= now + 1000) return value;
    }
    return null;
  });
}

async function checkUsernameHidden(page, name, where) {
  const leaked = await page.evaluate((needle) => {
    const pattern = new RegExp(needle, 'i');
    const texts = [JSON.stringify(window.dataLayer ?? [])];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? '';
        texts.push(key, storage.getItem(key) ?? '');
      }
    }
    return texts.some((text) => pattern.test(text));
  }, name);
  if (leaked) fail(`${where}: the GitHub username ${JSON.stringify(name)} reached window.dataLayer or browser storage`);
}

async function hiddenUntilStarClick(site) {
  const tab = await openPage(site, { width: 1440, githubApi });
  await tab.goto('/');
  await sleep(1200);
  if ((await panelState(tab.page)) !== null) fail('the star check panel is open on / before any Star click');
  await tab.goto('/docs/');
  await sleep(600);
  if ((await panelState(tab.page)) !== null) fail('the star check panel is open on /docs/ before any Star click');
  if (tab.githubRequests.length !== 0) fail('a page without a Star click asked api.github.com to check a star');
  for (const error of tab.errors) fail(`a page with no Star click logged a page error: ${error}`);
  await tab.close();
}

async function verifiedFlow(site) {
  const tab = await openPage(site, { width: 1440, githubApi });
  await tab.goto('/');
  await blockExternalNavigation(tab);

  await clickStar(tab, `header a[href="${REPOSITORY_URL}"]`, 'the header Star click');
  await expectState(tab.page, 'ask', 'the panel after a header Star click');
  expectStarClick(await tab.wins(), 'header', 'the header Star click');
  await checkPanelParts(tab.page, 'the panel after a header Star click');

  const firstClick = await storedStarClickAt(tab.page);
  if (firstClick === null) fail('the first Star click time is not stored in localStorage');

  await submitName(tab.page, 'fresh-starrer', 'fresh-starrer');
  await expectState(tab.page, 'verified', 'fresh-starrer');
  const wins = await tab.wins();
  const verified = wins.filter((entry) => entry.event === 'amaleh_star_verified');
  if (verified.length !== 1) fail(`fresh-starrer: expected exactly one amaleh_star_verified, found ${verified.length}`);
  else checkPayload(verified[0], 'fresh-starrer');
  if (!(await tab.page.$(`[data-star-check] a[href="${SPONSOR_URL}"]`))) {
    fail('fresh-starrer: the verified panel offers no Sponsor button');
  }
  await checkUsernameHidden(tab.page, 'fresh-starrer', 'fresh-starrer');
  checkRequests(tab.githubRequests, 'fresh-starrer');

  await tab.page.keyboard.press('Escape');
  await sleep(300);
  if ((await panelState(tab.page)) !== null) fail('Escape does not close the star check panel');

  await clickStar(tab, `#final-cta a[href="${REPOSITORY_URL}"]`, 'the final call Star click');
  await expectState(tab.page, 'ask', 'the panel after a final call Star click');
  const laterClick = await storedStarClickAt(tab.page);
  if (laterClick !== firstClick) {
    fail(`the first Star click time is not kept: it became ${JSON.stringify(laterClick)} after a later Star click, was ${JSON.stringify(firstClick)}`);
  }
  await clickByText(tab.page, '[data-star-check] button', 'Not now', 'the reopened panel');
  await sleep(300);
  if ((await panelState(tab.page)) !== null) fail('the Not now button does not close the star check panel');

  await tab.page.reload({ waitUntil: 'networkidle0' });
  await blockExternalNavigation(tab);
  await clickStar(tab, `#final-cta a[href="${REPOSITORY_URL}"]`, 'the final call Star click after a reload');
  await expectState(tab.page, 'ask', 'the panel after a reload');
  await submitName(tab.page, 'fresh-starrer', 'fresh-starrer after a reload');
  await expectState(tab.page, 'verified', 'fresh-starrer after a reload');
  if (countOf(await tab.wins(), 'amaleh_star_verified') !== 0) {
    fail('a second verified star in the same browser recorded amaleh_star_verified again');
  }
  for (const error of tab.errors) fail(`the verified star flow logged a page error: ${error}`);
  await tab.close();
}

async function panelParts(page) {
  return page.evaluate((sponsor) => ({
    text: document.querySelector('[data-star-check] [aria-live="polite"]')?.textContent.trim() ?? '',
    sponsor: Boolean(document.querySelector(`[data-star-check] a[href="${sponsor}"]`)),
  }), SPONSOR_URL);
}

async function expectConfirmedPanel(page, where) {
  const parts = await panelParts(page);
  if (!/thank/i.test(parts.text)) fail(`${where}: the sentence ${JSON.stringify(parts.text)} does not thank the visitor for the star`);
  if (!parts.sponsor) fail(`${where}: the confirmed panel offers no Sponsor button`);
}

async function starCheckStates(site) {
  const tab = await openPage(site, { width: 1440, githubApi });
  await tab.goto('/');
  await blockExternalNavigation(tab);
  await clickStar(tab, `#final-cta a[href="${REPOSITORY_URL}"]`, 'the final call Star click');
  await expectState(tab.page, 'ask', 'the panel before the star check states');
  expectStarClick(await tab.wins(), 'final-call', 'the final call Star click');
  await trackStarFetches(tab.page);

  await submitName(tab.page, 'old-starrer', 'old-starrer');
  await expectState(tab.page, 'confirmed', 'old-starrer');
  await expectConfirmedPanel(tab.page, 'old-starrer');

  const failures = [
    ['no-star', 'not-found'],
    ['ghost', 'no-user'],
    ['busy', 'busy'],
    ['offline-user', 'error'],
    ['not-an-array', 'error'],
    ['not-json', 'error'],
  ];
  for (const [name, expected] of failures) {
    await submitName(tab.page, name, name);
    await expectState(tab.page, expected, name);
    if (expected === 'not-found' || expected === 'busy') {
      const sentence = await liveText(tab.page);
      if (!/try again/i.test(sentence)) {
        fail(`${name}: the ${expected} sentence ${JSON.stringify(sentence)} does not invite the visitor to try again`);
      }
    }
  }

  const beforeDeep = tab.githubRequests.length;
  await submitName(tab.page, 'deep-starrer', 'deep-starrer');
  await expectState(tab.page, 'confirmed', 'deep-starrer');
  await expectConfirmedPanel(tab.page, 'deep-starrer');
  const deepRequests = tab.githubRequests.length - beforeDeep;
  if (deepRequests < 2) fail(`deep-starrer: the star sits on page 2 but the check sent ${deepRequests} request(s) to api.github.com`);
  if (deepRequests > starRequestBound) fail(`deep-starrer: one check sent ${deepRequests} requests to api.github.com, above ${starRequestBound}`);

  const beforeHuge = tab.githubRequests.length;
  await submitName(tab.page, 'huge-starrer', 'huge-starrer');
  await expectState(tab.page, 'partial', 'huge-starrer');
  const huge = await panelParts(tab.page);
  if (/no star/i.test(huge.text)) fail(`huge-starrer: the sentence ${JSON.stringify(huge.text)} claims the account has no star`);
  if (huge.sponsor) fail('huge-starrer: the panel offers a Sponsor button for a star it never found');
  if (!/could not read/i.test(huge.text)) fail(`huge-starrer: the sentence ${JSON.stringify(huge.text)} does not say the whole list could not be read`);
  const hugeRequests = tab.githubRequests.length - beforeHuge;
  if (hugeRequests > starRequestBound) fail(`huge-starrer: one check sent ${hugeRequests} requests to api.github.com, above ${starRequestBound}`);

  await expectCacheBypassed(tab.page, 'the star check states');
  checkRequests(tab.githubRequests, 'the star check states');
  if (countOf(await tab.wins(), 'amaleh_star_verified') !== 0) {
    fail('a star check that found no new star recorded amaleh_star_verified');
  }

  for (const name of ['fresh-starrer', 'mixed-case']) {
    await submitName(tab.page, name, name);
    await expectState(tab.page, 'verified', name);
    const recorded = countOf(await tab.wins(), 'amaleh_star_verified');
    if (recorded !== 1) {
      fail(`${name}: expected exactly one amaleh_star_verified in this browser, found ${recorded}`);
    }
  }

  const beforeInvalid = tab.githubRequests.length;
  for (const invalid of ['bad--name-', '-leading', 'trailing-', 'a'.repeat(40), '   ']) {
    await submitName(tab.page, invalid, `the invalid username ${JSON.stringify(invalid)}`);
    await expectState(tab.page, 'invalid', `the invalid username ${JSON.stringify(invalid)}`);
  }
  if (tab.githubRequests.length !== beforeInvalid) {
    fail('an invalid GitHub username still sent a request to api.github.com');
  }

  await submitName(tab.page, 'a'.repeat(39), 'a 39 character username');
  await sleep(500);
  if (tab.githubRequests.length !== beforeInvalid + 1) {
    fail('a 39 character GitHub username is valid but sent no request to api.github.com');
  }

  for (const name of ['old-starrer', 'ghost', 'busy', 'not-json']) await checkUsernameHidden(tab.page, name, name);
  for (const error of tab.errors) fail(`the star check failure paths logged a page error: ${error}`);
  await tab.close();
}

async function mobileMenuPanel(site) {
  const tab = await openPage(site, { width: 320, githubApi });
  await tab.goto('/docs/');
  await blockExternalNavigation(tab);
  await clickStar(tab, 'header details.dropdown summary', 'the mobile menu toggle');
  await clickStar(tab, `header details.dropdown a[href="${REPOSITORY_URL}"]`, 'the mobile menu Star link');
  await expectState(tab.page, 'ask', 'the panel after a mobile menu Star click at 320px');
  expectStarClick(await tab.wins(), 'header-menu', 'the mobile menu Star click');
  await checkPanelParts(tab.page, 'the 320px panel');
  for (const error of tab.errors) fail(`/docs/ at 320px logged a page error with the panel open: ${error}`);
  await tab.close();
}

async function consentBannerClearance(site) {
  const tab = await openPage(site, { width: 390, githubApi });
  await tab.page.emulateTimezone('Europe/Berlin');
  await tab.goto('/');
  await blockExternalNavigation(tab);
  await clickStar(tab, 'header details.dropdown summary', 'the mobile menu toggle with the consent banner up');
  await clickStar(tab, `header details.dropdown a[href="${REPOSITORY_URL}"]`, 'the mobile menu Star link with the consent banner up');
  await expectState(tab.page, 'ask', 'the panel with the consent banner up');
  const overlap = await tab.page.evaluate(() => {
    const banner = document.querySelector('[data-consent-banner]')?.getBoundingClientRect();
    const panel = document.querySelector('[data-star-check]')?.getBoundingClientRect();
    if (!banner || !panel) return `banner ${Boolean(banner)}, panel ${Boolean(panel)}`;
    const x = Math.min(banner.right, panel.right) - Math.max(banner.left, panel.left);
    const y = Math.min(banner.bottom, panel.bottom) - Math.max(banner.top, panel.top);
    return x > 0.5 && y > 0.5 ? 'overlap' : 'clear';
  });
  if (overlap !== 'clear') {
    fail(`with the consent banner visible at 390px the star check panel is not clear of it (${overlap})`);
  }
  await tab.close();
}

export async function run(site) {
  await hiddenUntilStarClick(site);
  await verifiedFlow(site);
  await starCheckStates(site);
  await mobileMenuPanel(site);
  await consentBannerClearance(site);
}
