import { openPage, sleep, fail, checkPayload, countOf } from '../browser-harness.mjs';

const repository = 'https://github.com/mhamri/amaleh';
const sponsor = 'https://github.com/sponsors/mhamri';

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

async function clickLink(tab, selector, what) {
  const handle = await tab.page.$(selector);
  if (!handle) {
    fail(`${what}: no element matches ${selector}`);
    return;
  }
  await handle.click();
  await sleep(300);
}

function expectWin(wins, event, location, where) {
  const matching = wins.filter((entry) => entry.event === event);
  if (matching.length !== 1) {
    fail(`${where}: expected exactly one ${event}, found ${matching.length}`);
    return;
  }
  checkPayload(matching[0], where);
  if (location !== undefined && matching[0].win_location !== location) {
    fail(`${where}: ${event} has win_location ${JSON.stringify(matching[0].win_location)}, expected ${JSON.stringify(location)}`);
  }
}

async function starClicks(site) {
  const tab = await openPage(site, { width: 1440 });
  await tab.goto('/');
  await blockExternalNavigation(tab);
  if ((await tab.wins()).some((entry) => entry.event !== 'amaleh_engaged_visit')) {
    fail('a click win is recorded before any click');
  }
  await clickLink(tab, `header a[href="${repository}"]`, 'header Star');
  expectWin(await tab.wins(), 'amaleh_star_click', 'header', 'header Star click');
  await clickLink(tab, `#final-cta a[href="${repository}"]`, 'final call Star');
  if (countOf(await tab.wins(), 'amaleh_star_click') > 1) {
    fail('a second Star click in the same session recorded a second amaleh_star_click');
  }
  await tab.page.reload({ waitUntil: 'networkidle0' });
  await blockExternalNavigation(tab);
  await clickLink(tab, `header a[href="${repository}"]`, 'header Star after reload');
  if (countOf(await tab.wins(), 'amaleh_star_click') !== 0) {
    fail('a Star click after a reload in the same browser session recorded amaleh_star_click again');
  }
  for (const error of tab.errors) fail(`home logged a page error during the Star probes: ${error}`);
  await tab.close();
}

async function sponsorClicks(site) {
  const tab = await openPage(site, { width: 1440 });
  await tab.goto('/');
  await blockExternalNavigation(tab);
  await clickLink(tab, `#final-cta a[href="${sponsor}"]`, 'final call Sponsor');
  await clickLink(tab, `main section a[href="${sponsor}"]`, 'hero Sponsor');
  const wins = await tab.wins();
  expectWin(wins, 'amaleh_sponsor_click', 'final-call', 'final call Sponsor click');
  for (const error of tab.errors) fail(`home logged a page error during the Sponsor probes: ${error}`);
  await tab.close();

  const hero = await openPage(site, { width: 1440 });
  await hero.goto('/');
  await blockExternalNavigation(hero);
  await clickLink(hero, `main section a[href="${sponsor}"]`, 'hero Sponsor');
  expectWin(await hero.wins(), 'amaleh_sponsor_click', 'hero', 'hero Sponsor click');
  await hero.close();
}

async function mobileMenuStar(site) {
  const tab = await openPage(site, { width: 390 });
  await tab.goto('/docs/');
  await blockExternalNavigation(tab);
  await clickLink(tab, 'header details.dropdown summary', 'mobile menu toggle');
  await clickLink(tab, `header details.dropdown a[href="${repository}"]`, 'mobile menu Star');
  expectWin(await tab.wins(), 'amaleh_star_click', 'header-menu', 'mobile menu Star click');
  for (const error of tab.errors) fail(`/docs/ logged a page error during the mobile menu probe: ${error}`);
  await tab.close();
}

async function payloadKeys(site) {
  const tab = await openPage(site, { width: 1440 });
  await tab.goto('/');
  await blockExternalNavigation(tab);
  await clickLink(tab, `header a[href="${repository}"]`, 'header Star for the dataLayer key check');
  for (const entry of await tab.wins()) {
    for (const key of Object.keys(entry)) {
      if (key !== 'event' && key !== 'win_id' && key !== 'win_location') {
        fail(`${entry.event} carries unexpected key "${key}"; no personal data may reach window.dataLayer`);
      }
    }
  }
  await tab.close();
}

async function engagedVisit(site) {
  const eager = await openPage(site, { width: 1440 });
  await eager.goto('/docs/commands/');
  await eager.page.evaluate(() => {
    window.scrollTo(0, 0.6 * (document.documentElement.scrollHeight - window.innerHeight));
  });
  await sleep(8000);
  if (countOf(await eager.wins(), 'amaleh_engaged_visit') !== 0) {
    fail('engaged visit: recorded after 8 seconds even though the rule needs 30 seconds of visible time');
  }
  await sleep(24500);
  expectWin(await eager.wins(), 'amaleh_engaged_visit', undefined, 'engaged visit after 32 seconds of visible time and a 60% scroll');
  await eager.page.evaluate(() => {
    window.scrollTo(0, 0.9 * (document.documentElement.scrollHeight - window.innerHeight));
  });
  await sleep(1500);
  if (countOf(await eager.wins(), 'amaleh_engaged_visit') > 1) {
    fail('engaged visit: recorded more than once in one session');
  }
  for (const error of eager.errors) fail(`/docs/commands/ logged a page error during the engaged-visit probe: ${error}`);
  await eager.close();

  const reader = await openPage(site, { width: 1440 });
  await reader.goto('/docs/commands/');
  await sleep(32000);
  if (countOf(await reader.wins(), 'amaleh_engaged_visit') !== 0) {
    fail('engaged visit: recorded after 32 seconds with no scrolling, although the rule needs half the page scrolled');
  }
  await reader.page.evaluate(() => {
    window.scrollTo(0, 0.6 * (document.documentElement.scrollHeight - window.innerHeight));
  });
  await sleep(2000);
  expectWin(await reader.wins(), 'amaleh_engaged_visit', undefined, 'engaged visit after a 60% scroll and 32 seconds');
  for (const error of reader.errors) fail(`/docs/commands/ logged a page error during the no-scroll probe: ${error}`);
  await reader.close();
}

export async function run(site) {
  await starClicks(site);
  await sponsorClicks(site);
  await mobileMenuStar(site);
  await payloadKeys(site);
  await engagedVisit(site);
}