// The one map component screens use. Mappls only — there is no other provider.
// Without VITE_MAPPLS_KEY at build time the map shows an explicit configuration
// error instead of silently swapping to another map.
import type { MapProps } from "./mapTypes";
import MapplsMap from "./MapplsMap";

export default function MapView(props: MapProps) {
  return <MapplsMap {...props} />;
}
