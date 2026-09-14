// The one map component screens use. Picks the provider from the build:
// Mappls when a key is configured (and only Mappls), Leaflet for keyless demo.
import { useMapProvider } from "../../lib/mapProvider";
import type { MapProps } from "./mapTypes";
import MapplsMap from "./MapplsMap";
import LeafletMap from "./LeafletMap";

export default function MapView(props: MapProps) {
  const provider = useMapProvider();
  return provider === "mappls" ? <MapplsMap {...props} /> : <LeafletMap {...props} />;
}
