import { For } from 'solid-js';
import { MODELS, type ModelId, type ModelIdentity } from '../../lib/models';
import { asset } from '../../lib/paths';
import { DECISION, REPAIR, WORKER_NAMES, joinNames } from '../../lib/pool';
import type { HeroNode, HeroScene } from '../../lib/hero-layout';

const TILE_RADIUS = 0.25;
const TILE_EDGE = 0.045;
const HUB_EDGE = 0.07;
const MONOGRAM = 0.36;
const PATCH_SIDE = 0.1;
const LABEL_BASELINE = 0.63;
const LINK_STROKE = 1.7;
const REVIEW_STROKE = 1.1;
const LINK_OPACITY = 0.7;
const REVIEW_OPACITY = 0.4;

const ARIA_LABEL =
  `Claude Code or Codex runs the coordinator, which hands chunks of work to the Flash worker families ${joinNames(WORKER_NAMES)}. ` +
  `Workers put bounded questions to ${DECISION.name}. A model from another Flash family reviews each finished chunk, ` +
  `a chunk that keeps failing its repairs escalates to ${REPAIR.name}, and accepted chunks travel back to the coordinator.`;

function identityOf(node: HeroNode): ModelIdentity {
  const found = node.family ? MODELS[node.family as ModelId] : undefined;
  if (node.family && !found) {
    throw new Error(
      `website/src/components/landing/HeroGraph.tsx has no identity for the family '${node.family}' in website/src/lib/models.ts. ` +
      `Add that family to MODELS in website/src/lib/models.ts before building.`,
    );
  }
  return found as ModelIdentity;
}

const centre = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

export default function HeroGraph(props: { scene: HeroScene; fallbackRef: (element: SVGGElement) => void }) {
  const scene = () => props.scene;
  return (
    <svg
      viewBox={`0 0 ${scene().width} ${scene().height}`}
      class="absolute inset-0 size-full"
      role="img"
      aria-label={ARIA_LABEL}
      data-hero-layout={scene().direction}
    >
      <defs>
        <For each={scene().nodes.filter((node) => node.family)}>
          {(node) => (
            <clipPath id={`hero-tile-${scene().direction}-${node.id}`}>
              <rect
                x={node.tile.x}
                y={node.tile.y}
                width={node.tile.width}
                height={node.tile.height}
                rx={node.tile.width * TILE_RADIUS}
              />
            </clipPath>
          )}
        </For>
      </defs>
      <g ref={props.fallbackRef} class="transition-opacity duration-500 ease-out-soft" opacity="0.25">
        <For each={scene().links}>
          {(link) => (
            <polyline
              data-link={link.id}
              data-kind={link.kind}
              points={link.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={link.kind === 'review' ? 'var(--color-secondary)' : linkHue(scene(), link)}
              stroke-width={link.kind === 'review' ? REVIEW_STROKE : LINK_STROKE}
              stroke-linecap="butt"
              stroke-linejoin="miter"
              opacity={link.kind === 'review' ? REVIEW_OPACITY : LINK_OPACITY}
            />
          )}
        </For>
      </g>
      <For each={scene().nodes}>
        {(node) => {
          if (!node.family) {
            return (
              <circle
                data-role={node.role}
                cx={centre(node.tile).x}
                cy={centre(node.tile).y}
                r={node.tile.width / 2}
                fill="var(--color-base-100)"
                stroke="var(--color-primary)"
                stroke-width={HUB_EDGE}
              />
            );
          }
          const identity = identityOf(node);
          const tile = node.tile;
          const radius = tile.width * TILE_RADIUS;
          const label = node.labelBox;
          const side = tile.width * PATCH_SIDE;
          const gap = label ? label.y - (tile.y + tile.height) : 0;
          return (
            <g data-model={node.family} data-role={node.role}>
              {label ? (
                <rect
                  data-label-patch
                  x={label.x - side}
                  y={label.y - gap}
                  width={label.width + side * 2}
                  height={label.height + gap}
                  fill="var(--color-base-100)"
                  fill-opacity="1"
                  opacity="1"
                />
              ) : null}
              {label ? (
                <text
                  x={centre(tile).x}
                  y={label.y + label.height * LABEL_BASELINE}
                  font-size={`${scene().labelSize}`}
                  letter-spacing="normal"
                  text-anchor="middle"
                  fill="var(--color-dim)"
                >
                  {node.label}
                </text>
              ) : null}
              <rect
                data-tile
                x={tile.x}
                y={tile.y}
                width={tile.width}
                height={tile.height}
                rx={radius}
                fill={identity.tileFill ?? 'var(--color-base-200)'}
              />
              {identity.logo ? (
                <image
                  href={asset(identity.logo)}
                  x={tile.x}
                  y={tile.y}
                  width={tile.width}
                  height={tile.height}
                  preserveAspectRatio="xMidYMid meet"
                  clip-path={`url(#hero-tile-${scene().direction}-${node.id})`}
                />
              ) : (
                <text
                  x={centre(tile).x}
                  y={centre(tile).y}
                  font-size={`${tile.width * MONOGRAM}`}
                  font-weight="600"
                  text-anchor="middle"
                  dominant-baseline="central"
                  fill={identity.hue}
                >
                  {identity.monogram}
                </text>
              )}
              <rect
                x={tile.x}
                y={tile.y}
                width={tile.width}
                height={tile.height}
                rx={radius}
                fill="none"
                stroke={identity.hue}
                stroke-width={TILE_EDGE * tile.width}
              />
            </g>
          );
        }}
      </For>
    </svg>
  );
}

function linkHue(scene: HeroScene, link: { from: string; to: string }): string {
  const from = scene.nodes.find((candidate) => candidate.id === link.from);
  const to = scene.nodes.find((candidate) => candidate.id === link.to);
  const end = from?.family ? from : to;
  return (end ? identityOf(end).hue : undefined) ?? 'var(--color-primary)';
}
