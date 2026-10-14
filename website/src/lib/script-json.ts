// See website/SEO.md, section "Structured data".
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<\u{2028}\u{2029}]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
