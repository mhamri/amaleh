import { scriptJson } from './script-json.ts';

export const consentRegions = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
  'IS', 'LI', 'NO',
  'GB',
  'CH',
] as const;

export const consentStorageKey = 'amaleh-consent';

export const consentSignals = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'] as const;

export const consentTimeZones = [
  'Europe/Vienna',
  'Europe/Brussels',
  'Europe/Sofia',
  'Europe/Zagreb',
  'Europe/Nicosia',
  'Asia/Nicosia',
  'Asia/Famagusta',
  'Europe/Prague',
  'Europe/Copenhagen',
  'Europe/Tallinn',
  'Europe/Helsinki',
  'Europe/Mariehamn',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Busingen',
  'Europe/Athens',
  'Europe/Budapest',
  'Europe/Dublin',
  'Europe/Rome',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Luxembourg',
  'Europe/Malta',
  'Europe/Amsterdam',
  'Europe/Warsaw',
  'Europe/Lisbon',
  'Atlantic/Azores',
  'Atlantic/Madeira',
  'Europe/Bucharest',
  'Europe/Bratislava',
  'Europe/Ljubljana',
  'Europe/Madrid',
  'Africa/Ceuta',
  'Atlantic/Canary',
  'Europe/Stockholm',
  'Atlantic/Reykjavik',
  'Europe/Oslo',
  'Arctic/Longyearbyen',
  'Europe/Vaduz',
  'Europe/London',
  'Europe/Belfast',
  'Europe/Guernsey',
  'Europe/Jersey',
  'Europe/Isle_of_Man',
  'Europe/Gibraltar',
  'Europe/Zurich',
  'America/Cayenne',
  'America/Guadeloupe',
  'America/Martinique',
  'Indian/Reunion',
  'Indian/Mayotte',
  'America/Marigot',
] as const;

export function inConsentTimeZone(): boolean {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return consentTimeZones.includes(zone as (typeof consentTimeZones)[number]);
}

export type ConsentChoice = 'granted' | 'denied';

type ConsentSignals = Record<(typeof consentSignals)[number], ConsentChoice>;

export function consentSignalsSetTo(choice: ConsentChoice): ConsentSignals {
  return Object.fromEntries(consentSignals.map((signal) => [signal, choice])) as ConsentSignals;
}

export const consentGrantedEvent = 'amaleh_consent_granted';

declare global {
  interface Window {
    gtag?: (command: 'consent', action: 'update', signals: ConsentSignals) => void;
    dataLayer?: unknown[];
  }
}

export function storedConsentChoice(): ConsentChoice | undefined {
  try {
    const stored = localStorage.getItem(consentStorageKey);
    return stored === 'granted' || stored === 'denied' ? stored : undefined;
  } catch {
    return undefined;
  }
}

function tryStoreConsentChoice(choice: ConsentChoice): boolean {
  try {
    localStorage.setItem(consentStorageKey, choice);
    return true;
  } catch {
    return false;
  }
}

export function setConsentChoice(choice: ConsentChoice): void {
  const newlyGranted = choice === 'granted' && storedConsentChoice() !== 'granted';
  tryStoreConsentChoice(choice);
  window.gtag?.('consent', 'update', consentSignalsSetTo(choice));
  if (newlyGranted) window.dataLayer?.push({ event: consentGrantedEvent });
}

const storedChoiceUpdate = consentSignals.map((signal) => `${signal}:choice`).join(',');

export const consentDefaultsScript = [
  'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}',
  `gtag('consent','default',${scriptJson({ ...consentSignalsSetTo('denied'), wait_for_update: 500, region: consentRegions })});`,
  `gtag('consent','default',${scriptJson(consentSignalsSetTo('granted'))});`,
  `(function(){try{var choice=localStorage.getItem(${scriptJson(consentStorageKey)});if(choice==='granted'||choice==='denied')gtag('consent','update',{${storedChoiceUpdate}});}catch(e){}})();`,
].join('\n');
