export type TopologyVariant = 'narrow' | 'wide';

export type PoolTextKind = 'title' | 'name' | 'note';

export type PoolText = {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  anchor: 'start' | 'middle' | 'end';
  mono: boolean;
  kind: PoolTextKind;
};

export type PoolBox = {
  box: { x: number; y: number; width: number; height: number };
  texts: PoolText[];
};

type VariantMetrics = {
  box: { x: number; y: number; width: number; height: number };
  title: string;
  titleFontSize: number;
  noteFontSize: number;
  padX: number;
  titleOffsetY: number;
  gridOffsetY: number;
  rowPitch: number;
  notes: string[];
  noteOffsetsY: number[];
};

const NAME_FONT_SIZE = 10;
const MAX_ROWS = 3;
const MAX_POOL = MAX_ROWS * 2;
const COLUMN_GAP = 7;
const WIDE_PAD_X = 10;

const VARIANTS: Record<TopologyVariant, VariantMetrics> = {
  narrow: {
    box: { x: 16, y: 80, width: 144, height: 84 },
    title: 'Flash pool',
    titleFontSize: 11,
    noteFontSize: 9,
    padX: COLUMN_GAP,
    titleOffsetY: 13,
    gridOffsetY: 28,
    rowPitch: 14,
    notes: ['routed per chunk'],
    noteOffsetsY: [70],
  },
  wide: {
    box: { x: 50, y: 110, width: 180, height: 90 },
    title: 'Flash worker pool',
    titleFontSize: 10,
    noteFontSize: 8,
    padX: WIDE_PAD_X,
    titleOffsetY: 12,
    gridOffsetY: 26,
    rowPitch: 14,
    notes: ['round-robin across families', 'checks and repairs each chunk'],
    noteOffsetsY: [68, 80],
  },
};

const rowsFor = (count: number): number => Math.min(Math.max(Math.ceil(count / 2), 1), MAX_ROWS);

export function topologyPoolBox(names: string[], variant: TopologyVariant): PoolBox {
  const metrics = VARIANTS[variant];
  if (!metrics) {
    throw new Error(
      `topologyPoolBox was asked for the unknown variant '${variant}'; it draws the narrow stack or the wide panel only.`,
    );
  }
  if (names.length < 2 || names.length > MAX_POOL) {
    throw new Error(
      `topologyPoolBox lays out a flash pool of 2 to ${MAX_POOL} names in the ${variant} Flash pool box, ` +
        `and was handed ${names.length}. Widen the grid in website/src/lib/topology-layout.ts and the box around it ` +
        `before the pool grows past that.`,
    );
  }
  const { box } = metrics;
  const texts: PoolText[] = [
    {
      x: box.x + metrics.padX,
      y: box.y + metrics.titleOffsetY,
      text: metrics.title,
      fontSize: metrics.titleFontSize,
      anchor: 'start',
      mono: false,
      kind: 'title',
    },
  ];

  const rows = rowsFor(names.length);
  const firstRowY = box.y + metrics.gridOffsetY + (MAX_ROWS - rows) * (metrics.rowPitch / 2);
  const rightColumnX = box.x + box.width - metrics.padX;
  names.forEach((name, index) => {
    const right = index % 2 === 1;
    texts.push({
      x: right ? rightColumnX : box.x + metrics.padX,
      y: firstRowY + Math.floor(index / 2) * metrics.rowPitch,
      text: name,
      fontSize: NAME_FONT_SIZE,
      anchor: right ? 'end' : 'start',
      mono: true,
      kind: 'name',
    });
  });

  metrics.notes.forEach((note, index) => {
    texts.push({
      x: box.x + metrics.padX,
      y: box.y + metrics.noteOffsetsY[index],
      text: note,
      fontSize: metrics.noteFontSize,
      anchor: 'start',
      mono: false,
      kind: 'note',
    });
  });

  return { box, texts };
}
