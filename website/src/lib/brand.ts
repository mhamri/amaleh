// See website/DESIGN-SYSTEM.md, Brand assets.
export type BrandImage = {
  publicPath: string;
  size: number;
  maxBytes: number;
  backdrop?: { color: readonly [number, number, number]; markFraction: number };
};

const KIB = 1024;
const MARK_MAX_BYTES = 40 * KIB;
const PAGE_BACKGROUND = [0x0f, 0x12, 0x16] as const;

export const BRAND_MASTER_SOURCE_PATH = 'brand/amaleh-logo-transparent.png';

export const LOCKUP_MARK: BrandImage = { publicPath: 'brand/amaleh-mark.png', size: 30, maxBytes: MARK_MAX_BYTES };

export const LOCKUP_MARK_2X: BrandImage = { publicPath: 'brand/amaleh-mark@2x.png', size: 60, maxBytes: MARK_MAX_BYTES };

export const HERO_MARK: BrandImage = { publicPath: 'brand/amaleh-hero-mark.png', size: 176, maxBytes: 64 * KIB };

export const FAVICONS: readonly BrandImage[] = [
  { publicPath: 'brand/favicon-32.png', size: 32, maxBytes: MARK_MAX_BYTES },
  { publicPath: 'brand/favicon-16.png', size: 16, maxBytes: MARK_MAX_BYTES },
];

export const APPLE_TOUCH_ICON: BrandImage = {
  publicPath: 'brand/apple-touch-icon.png',
  size: 180,
  maxBytes: MARK_MAX_BYTES,
  backdrop: { color: PAGE_BACKGROUND, markFraction: 0.85 },
};

export const SHARE_IMAGE: BrandImage = {
  publicPath: 'brand/amaleh-share.png',
  size: 600,
  maxBytes: 300 * KIB,
  backdrop: { color: PAGE_BACKGROUND, markFraction: 0.6 },
};

export const BRAND_IMAGES: readonly BrandImage[] = [LOCKUP_MARK, LOCKUP_MARK_2X, HERO_MARK, ...FAVICONS, APPLE_TOUCH_ICON, SHARE_IMAGE];
