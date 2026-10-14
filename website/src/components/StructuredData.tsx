import type { Graph } from 'schema-dts';
import { scriptJson } from '../lib/script-json';

type StructuredDataProps = { graph: Graph };

export default function StructuredData(props: StructuredDataProps) {
  return <script type="application/ld+json" innerHTML={scriptJson(props.graph)} />;
}
