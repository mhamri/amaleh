const NAMED_ENTITIES = new Map([
  ['nbsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);
const LAST_CODE_POINT = 0x10ffff;

export function decodeEntities(text) {
  return text.replace(/&(?:([a-z]+)|#x([0-9a-f]+)|#(\d+));/gi, (entity, name, hex, decimal) => {
    if (name !== undefined) return NAMED_ENTITIES.get(name) ?? entity;
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(decimal);
    return code <= LAST_CODE_POINT ? String.fromCodePoint(code) : entity;
  });
}

export function withoutScriptsAndStyles(html, gap) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, gap)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, gap);
}

export function withoutComments(html, gap) {
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<!--[\s\S]*?--!?>/g, gap);
  } while (text !== previous);
  return text;
}

export function withoutTags(html, gap) {
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, gap);
  } while (text !== previous);
  return text;
}

export function visibleText(html) {
  const markup = withoutComments(withoutScriptsAndStyles(html, ' '), ' ');
  const attributes = [...markup.matchAll(/\s(?:aria-label|title|alt|content)="([^"]*)"/g)].map((match) => match[1]);
  return decodeEntities(`${withoutTags(markup, ' ')} ${attributes.join(' ')}`).replace(/\s+/g, ' ');
}
