/*
 * One identity list for every model Amaleh routes to: the Latin-script name,
 * the routed hue, the monogram and the vendor mark live in one place. The
 * hero's logo tiles read from here — a model whose vendor publishes a mark
 * renders that mark, and a model without one renders its monogram in the
 * model's routed hue, in the same tile size and shape either way.
 *
 * A mark reaches the hero only when both halves are in place: the file sits in
 * website/public/models AND the model's `logo` field points at it. Dropping a
 * correctly named file into that folder on its own changes nothing — the
 * shipped mechanism reads the `logo` field, not the directory listing.
 *
 * Vendor marks are third-party marks used only to name the models Amaleh
 * routes to. They are served from this site, never hotlinked, and never
 * redrawn, recoloured or combined with the Amaleh mark.
 */

export type ModelId =
  | 'deepseek'
  | 'glm'
  | 'xiaomi'
  | 'stealth'
  | 'kimi'
  | 'jev'
  | 'claude'
  | 'openai'
  | 'upstage';

export type ModelIdentity = {
  /** Name as the site's copy uses it. */
  name: string;
  /** Single letter rendered when no vendor mark exists. */
  monogram: string;
  /** The model's routed hue: a colour custom property from the amaleh theme. */
  hue: string;
  /** Vendor mark under public/, or null when none is published. */
  logo: string | null;
  /** Vendor the mark belongs to, for attribution in code. */
  vendor: string | null;
  /**
   * Tile surface behind a mark that carries no background of its own.
   * Marks published as filled squares (Anthropic, DeepSeek, MoonshotAI,
   * TypeSafe) cover the tile themselves; OpenAI's blossom is black on transparency and
   * MiMo's mark is drawn in currentColor, which resolves to black once the
   * file is loaded into an <image>, so both tiles carry a light surface from
   * the theme to stay legible on the night-ledger background.
   */
  tileFill?: string;
};

export const MODELS: Record<ModelId, ModelIdentity> = {
  deepseek: {
    name: 'DeepSeek',
    monogram: 'D',
    hue: 'var(--color-secondary)',
    logo: 'models/DeepSeek.png',
    vendor: 'DeepSeek',
  },
  glm: {
    name: 'GLM',
    monogram: 'G',
    hue: 'var(--color-info)',
    logo: 'models/GLM.svg',
    vendor: 'Zhipu (Z.ai)',
  },
  xiaomi: {
    name: 'MiMo',
    monogram: 'M',
    hue: 'var(--color-success)',
    logo: 'models/MiMo.svg',
    vendor: 'Xiaomi',
    tileFill: 'var(--color-base-content)',
  },
  stealth: {
    name: 'Stealth',
    monogram: 'S',
    hue: 'var(--color-primary)',
    logo: null,
    vendor: null,
  },
  upstage: {
    name: 'Solar',
    monogram: 'S',
    hue: 'var(--color-primary)',
    logo: 'models/Solar.svg',
    vendor: 'Upstage',
  },
  kimi: {
    name: 'Kimi',
    monogram: 'K',
    hue: 'var(--color-warning)',
    logo: 'models/MoonshotAI.png',
    vendor: 'MoonshotAI',
  },
  jev: {
    name: 'Jev',
    monogram: 'J',
    hue: 'var(--color-accent)',
    logo: 'models/TypeSafe.png',
    vendor: 'TypeSafe',
  },
  claude: {
    name: 'Claude',
    monogram: 'C',
    hue: 'var(--color-error)',
    logo: 'models/Anthropic.svg',
    vendor: 'Anthropic',
  },
  openai: {
    name: 'OpenAI',
    monogram: 'O',
    hue: 'var(--color-neutral-content)',
    logo: 'models/OpenAI.svg',
    vendor: 'OpenAI',
    tileFill: 'var(--color-base-content)',
  },
};