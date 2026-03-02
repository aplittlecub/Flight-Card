import type { Feature, FeatureCollection, Point } from "geojson";
import leafletCss from "leaflet/dist/leaflet.css?inline";

const CARD_VERSION = "0.2.0";
const CARD_TYPE = "flight-card";
const HEXDB_LOOKUP_ENDPOINT = "https://hexdb.io/api/v1/aircraft/";
const HEXDB_IMAGE_THUMB_ENDPOINT = "https://hexdb.io/hex-image-thumb?hex=";
const MAX_HEXDB_LOOKUPS_PER_POLL = 6;
const ADSB_ICON_MODULES = import.meta.glob("./assets/adsb-icons/*.svg", {
  eager: true,
  import: "default",
}) as Record<string, string>;
const ADSB_ICON_URLS = Object.fromEntries(
  Object.entries(ADSB_ICON_MODULES)
    .map(([modulePath, url]) => {
      const match = modulePath.match(/\/([^/]+)\.svg$/i);
      return match ? [match[1].toLowerCase(), url] : null;
    })
    .filter((entry): entry is [string, string] => entry !== null)
);
const ADSB_DEFAULT_ICON_KEY = "a320";
const ALTITUDE_COLOR_STOPS: Array<{ altitudeFt: number; color: [number, number, number] }> = [
  { altitudeFt: 0, color: [198, 44, 22] },
  { altitudeFt: 500, color: [233, 79, 23] },
  { altitudeFt: 1000, color: [242, 121, 28] },
  { altitudeFt: 2000, color: [245, 164, 30] },
  { altitudeFt: 4000, color: [239, 204, 38] },
  { altitudeFt: 6000, color: [204, 220, 48] },
  { altitudeFt: 8000, color: [138, 221, 63] },
  { altitudeFt: 10000, color: [48, 216, 85] },
  { altitudeFt: 20000, color: [94, 212, 206] },
  { altitudeFt: 30000, color: [86, 140, 242] },
  { altitudeFt: 40000, color: [224, 82, 248] },
];

interface HomeAssistant {
  config?: {
    latitude?: number;
    longitude?: number;
  };
}

interface FlightCardConfig {
  title: string;
  data_url: string;
  update_interval: number;
  max_age: number;
  hexdb_enabled: boolean;
  map_height: number;
  default_zoom: number;
  fit_bounds: boolean;
  center_lat: number | null;
  center_lon: number | null;
  tile_url: string;
  attribution: string;
}

interface AircraftEntry {
  hex?: string;
  flight?: string;
  category?: string;
  t?: string;
  type?: string;
  ac_type?: string;
  aircraft_type?: string;
  desc?: string;
  lat?: number | string | null;
  lon?: number | string | null;
  alt_baro?: number | string | null;
  alt_geom?: number | string | null;
  altitude?: number | string | null;
  gs?: number | string | null;
  speed?: number | string | null;
  track?: number | string | null;
  seen?: number | string | null;
  seen_pos?: number | string | null;
}

interface AircraftPayload {
  aircraft?: AircraftEntry[];
}

interface HexDbAircraftResponse {
  ICAOTypeCode?: string;
  Manufacturer?: string;
  ModeS?: string;
  OperatorFlagCode?: string;
  RegisteredOwners?: string;
  Registration?: string;
  Type?: string;
  status?: string;
  error?: string;
}

interface HexDbAircraftInfo {
  icaoTypeCode: string;
  manufacturer: string;
  modeS: string;
  operatorFlagCode: string;
  registeredOwners: string;
  registration: string;
  type: string;
  imageUrl: string;
}

interface FlightFeatureProperties {
  hex: string;
  flight: string;
  category: string;
  aircraft_type: string;
  registration: string;
  manufacturer: string;
  icao_type_code: string;
  operator_flag_code: string;
  registered_owners: string;
  airframe_image_url: string;
  altitude_ft: number | null;
  speed_kt: number | null;
  track_deg: number | null;
  seen_s: number | null;
}

interface CustomCardRegistration {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

type FlightFeature = Feature<Point, FlightFeatureProperties>;
type FlightCollection = FeatureCollection<Point, FlightFeatureProperties>;
type LeafletModule = typeof import("leaflet");

const DEFAULT_CONFIG: FlightCardConfig = {
  title: "Nearby Aircraft",
  data_url: "http://10.10.0.249/skyaware/data/aircraft.json",
  update_interval: 10,
  max_age: 60,
  hexdb_enabled: true,
  map_height: 420,
  default_zoom: 8,
  fit_bounds: true,
  center_lat: null,
  center_lon: null,
  tile_url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap contributors</a>",
};

class FlightCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config: FlightCardConfig = { ...DEFAULT_CONFIG };

  private _map?: import("leaflet").Map;
  private _leaflet?: LeafletModule;
  private _aircraftLayer?: import("leaflet").GeoJSON;
  private _mapInitPromise?: Promise<void>;
  private _mapResizeObserver?: ResizeObserver;
  private _resizeFixTimeouts: number[] = [];

  private _pollTimer?: number;
  private _fetchController?: AbortController;
  private _hasAutofit = false;
  private _root?: ShadowRoot;
  private _latestGeoJson?: FlightCollection;
  private _hexDbCache = new Map<string, HexDbAircraftInfo | null>();
  private _hexDbInFlight = new Set<string>();
  private _hexDbRefreshDebounce?: number;

  private _els: {
    card?: HTMLElement;
    title?: HTMLElement;
    status?: HTMLElement;
    count?: HTMLElement;
    updated?: HTMLElement;
    map?: HTMLElement;
  } = {};

  static getStubConfig(): Partial<FlightCardConfig> {
    return {
      title: DEFAULT_CONFIG.title,
      data_url: DEFAULT_CONFIG.data_url,
    };
  }

  static getConfigForm(): Record<string, unknown> {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "data_url", required: true, selector: { text: {} } },
        {
          type: "grid",
          name: "",
          flatten: true,
          schema: [
            { name: "update_interval", selector: { number: { min: 2, max: 600, mode: "box" } } },
            { name: "max_age", selector: { number: { min: 1, max: 3600, mode: "box" } } },
            { name: "default_zoom", selector: { number: { min: 1, max: 18, mode: "box" } } },
            { name: "map_height", selector: { number: { min: 200, max: 1200, mode: "box" } } },
          ],
        },
        { name: "fit_bounds", selector: { boolean: {} } },
        { name: "hexdb_enabled", selector: { boolean: {} } },
        {
          type: "expandable",
          name: "advanced",
          title: "Advanced",
          flatten: false,
          schema: [
            { name: "center_lat", selector: { number: { min: -90, max: 90, step: 0.000001, mode: "box" } } },
            { name: "center_lon", selector: { number: { min: -180, max: 180, step: 0.000001, mode: "box" } } },
            { name: "tile_url", selector: { text: {} } },
            { name: "attribution", selector: { text: {} } },
          ],
        },
      ],
      computeLabel(schema: { name?: string }) {
        if (schema.name === "data_url") return "Data URL";
        if (schema.name === "update_interval") return "Update interval (seconds)";
        if (schema.name === "max_age") return "Max aircraft age (seconds)";
        if (schema.name === "default_zoom") return "Default zoom";
        if (schema.name === "map_height") return "Map height (px)";
        if (schema.name === "fit_bounds") return "Auto-fit map to aircraft";
        if (schema.name === "hexdb_enabled") return "Enable HexDB aircraft enrichment";
        if (schema.name === "center_lat") return "Center latitude";
        if (schema.name === "center_lon") return "Center longitude";
        if (schema.name === "tile_url") return "Tile URL";
        if (schema.name === "attribution") return "Tile attribution";
        return undefined;
      },
    };
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  setConfig(config: Partial<FlightCardConfig> & Record<string, unknown>): void {
    this._config = normalizeConfig(config);
    this._hasAutofit = false;

    this._render();
    this._applyVisualConfig();

    if (this._map) {
      // Apply center/zoom updates when card config changes in-place.
      const center = this._resolveInitialCenter();
      this._map.setView(center, this._config.default_zoom, { animate: false });
      this._hasAutofit = false;
      this._scheduleResizeFixes();
    }

    if (this.isConnected) {
      void this._ensureMap();
      this._restartPolling();
    }
  }

  connectedCallback(): void {
    this._render();
    this._applyVisualConfig();
    void this._ensureMap();
    this._restartPolling();
  }

  disconnectedCallback(): void {
    this._stopPolling();

    if (this._map) {
      this._map.remove();
      this._map = undefined;
      this._aircraftLayer = undefined;
    }

    if (this._mapResizeObserver) {
      this._mapResizeObserver.disconnect();
      this._mapResizeObserver = undefined;
    }

    this._resizeFixTimeouts.forEach((id) => window.clearTimeout(id));
    this._resizeFixTimeouts = [];
    if (this._hexDbRefreshDebounce !== undefined) {
      window.clearTimeout(this._hexDbRefreshDebounce);
      this._hexDbRefreshDebounce = undefined;
    }
    this._mapInitPromise = undefined;
  }

  getCardSize(): number {
    const rows = Math.ceil((this._config.map_height + 110) / 50);
    return Math.max(4, rows);
  }

  getGridOptions(): Record<string, number> {
    const rows = Math.ceil((this._config.map_height + 70) / 56);
    return {
      columns: 12,
      rows: Math.max(4, rows),
      min_rows: 4,
    };
  }

  private _render(): void {
    if (!this._root) {
      this._root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    }
    if (this._els.card) {
      return;
    }

    this._root.innerHTML = `
      <style>
        ${leafletCss}

        :host {
          display: block;
        }

        .flight-card {
          display: block;
        }

        .flight-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }

        .flight-card__title {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--primary-text-color);
          margin: 0;
        }

        .flight-card__meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
          margin-bottom: 12px;
          font-size: 0.875rem;
          color: var(--secondary-text-color);
        }

        .flight-card__status {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-radius: 999px;
          padding: 4px 10px;
          line-height: 1;
        }

        .flight-card__status--idle {
          color: var(--secondary-text-color);
          background: var(--secondary-background-color);
        }

        .flight-card__status--ok {
          color: #14632f;
          background: #d8f7e2;
        }

        .flight-card__status--error {
          color: #7a2020;
          background: #ffe2e2;
        }

        .flight-card__map {
          position: relative;
          width: 100%;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
        }

        .flight-card__map .leaflet-container {
          width: 100%;
          height: 100%;
        }

        /* Prevent HA/global img styles from shrinking tiles and breaking layout. */
        .flight-card__map .leaflet-tile,
        .flight-card__map .leaflet-marker-icon,
        .flight-card__map .leaflet-marker-shadow,
        .flight-card__map .leaflet-container img {
          max-width: none !important;
          max-height: none !important;
        }

        .flight-card__map .flight-card__aircraft-marker {
          background: transparent;
          border: 0;
        }

        .flight-card__aircraft-icon {
          width: 24px;
          height: 24px;
          display: block;
          transform: rotate(var(--aircraft-rotation, 0deg));
          transform-origin: 50% 50%;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
        }

        .flight-card__aircraft-icon-mask {
          width: 100%;
          height: 100%;
          display: block;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-size: contain;
          mask-size: contain;
          -webkit-mask-position: center;
          mask-position: center;
          pointer-events: none;
        }

        .flight-card__aircraft-fallback {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          display: block;
          background: var(--aircraft-color, #ef4444);
          border: 2px solid rgba(15, 23, 42, 0.65);
        }

        .flight-card__popup {
          margin: 0;
          line-height: 1.35;
        }

        .flight-card__popup-image {
          margin-top: 6px;
          width: 160px;
          max-width: 100%;
          height: auto;
          border-radius: 6px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
        }
      </style>
      <ha-card>
        <div class="card-content flight-card">
          <div class="flight-card__header">
            <h2 class="flight-card__title"></h2>
            <span class="flight-card__status flight-card__status--idle">Idle</span>
          </div>
          <div class="flight-card__meta">
            <span class="flight-card__count">Aircraft: 0</span>
            <span class="flight-card__updated">Updated: never</span>
          </div>
          <div class="flight-card__map"></div>
        </div>
      </ha-card>
    `;

    this._els = {
      card: this._root.querySelector<HTMLElement>("ha-card") ?? undefined,
      title: this._root.querySelector<HTMLElement>(".flight-card__title") ?? undefined,
      status: this._root.querySelector<HTMLElement>(".flight-card__status") ?? undefined,
      count: this._root.querySelector<HTMLElement>(".flight-card__count") ?? undefined,
      updated: this._root.querySelector<HTMLElement>(".flight-card__updated") ?? undefined,
      map: this._root.querySelector<HTMLElement>(".flight-card__map") ?? undefined,
    };
  }

  private _applyVisualConfig(): void {
    if (!this._els.title || !this._els.map) {
      return;
    }

    this._els.title.textContent = this._config.title;
    this._els.map.style.height = `${this._config.map_height}px`;
    this._invalidateMapSize(false);
  }

  private async _ensureMap(): Promise<void> {
    if (this._map || !this._els.map) {
      return;
    }

    if (this._mapInitPromise) {
      return this._mapInitPromise;
    }

    this._mapInitPromise = (async () => {
      try {
        this._setStatus("idle", "Loading map");
        this._leaflet = await loadLeaflet();
        await this._waitForMapContainerReady();

        const L = this._leaflet;
        const center = this._resolveInitialCenter();

        this._map = L.map(this._els.map as HTMLElement, {
          zoomControl: true,
          scrollWheelZoom: true,
          zoomAnimation: false,
          fadeAnimation: false,
          markerZoomAnimation: false,
        });

        L.tileLayer(this._config.tile_url, {
          attribution: this._config.attribution,
          maxZoom: 19,
          updateWhenIdle: true,
          keepBuffer: 4,
        }).addTo(this._map);

        this._map.setView(center, this._config.default_zoom);
        this._aircraftLayer = L.geoJSON([], {
          pointToLayer: (feature, latlng) => {
            const props = feature?.properties as FlightFeatureProperties | undefined;
            return L.marker(latlng, {
              icon: L.divIcon({
                className: "flight-card__aircraft-marker",
                html: aircraftIconHtml(props),
                iconSize: [24, 24],
                iconAnchor: [12, 12],
                popupAnchor: [0, -10],
              }),
              keyboard: false,
            });
          },
          onEachFeature: (feature, layer) => {
            layer.bindPopup(this._popupHtml(feature.properties as FlightFeatureProperties));
          },
        });

        this._aircraftLayer.addTo(this._map);
        this._startResizeObserver();
        this._setStatus("ok", "Waiting for data");

        this._map.whenReady(() => this._scheduleResizeFixes());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown map error";
        this._setStatus("error", `Map error: ${message}`);
      } finally {
        this._mapInitPromise = undefined;
      }
    })();

    return this._mapInitPromise;
  }

  private _restartPolling(): void {
    this._stopPolling();

    void this._pollOnce();
    this._pollTimer = window.setInterval(() => {
      void this._pollOnce();
    }, this._config.update_interval * 1000);
  }

  private _stopPolling(): void {
    if (this._pollTimer !== undefined) {
      window.clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    }

    if (this._fetchController) {
      this._fetchController.abort();
      this._fetchController = undefined;
    }
  }

  private async _pollOnce(): Promise<void> {
    if (!this._map) {
      await this._ensureMap();
      if (!this._map) {
        return;
      }
    }

    if (this._fetchController) {
      return;
    }

    try {
      this._setStatus("idle", "Updating");

      this._fetchController = new AbortController();
      const response = await fetch(this._config.data_url, {
        method: "GET",
        cache: "no-store",
        signal: this._fetchController.signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as AircraftPayload;
      const geoJson = aircraftToGeoJson(payload, this._config.max_age);
      this._latestGeoJson = geoJson;
      if (this._config.hexdb_enabled) {
        this._applyCachedHexDbData(geoJson);
        this._queueHexDbLookups(geoJson);
      }
      this._renderGeoJson(geoJson);

      if (this._els.count) {
        this._els.count.textContent = `Aircraft: ${geoJson.features.length}`;
      }

      if (this._els.updated) {
        this._els.updated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
      }

      this._setStatus("ok", "Live");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown update error";
      this._setStatus("error", `Update failed: ${message}`);
    } finally {
      this._fetchController = undefined;
    }
  }

  private _renderGeoJson(geoJson: FlightCollection): void {
    if (!this._aircraftLayer || !this._map) {
      return;
    }

    this._aircraftLayer.clearLayers();
    this._aircraftLayer.addData(geoJson as unknown as GeoJSON.FeatureCollection);

    if (geoJson.features.length === 0) {
      this._hasAutofit = false;
    }

    if (this._config.fit_bounds && geoJson.features.length > 0) {
      const bounds = this._aircraftLayer.getBounds();
      if (bounds.isValid() && !this._hasAutofit) {
        this._map.fitBounds(bounds, {
          padding: [24, 24],
          maxZoom: this._config.default_zoom + 3,
        });
        this._hasAutofit = true;
      }
    }
  }

  private _setStatus(type: "idle" | "ok" | "error", text: string): void {
    if (!this._els.status) {
      return;
    }

    this._els.status.className = `flight-card__status flight-card__status--${type}`;
    this._els.status.textContent = text;
  }

  private _resolveInitialCenter(): [number, number] {
    if (Number.isFinite(this._config.center_lat) && Number.isFinite(this._config.center_lon)) {
      return [this._config.center_lat as number, this._config.center_lon as number];
    }

    if (
      this._hass?.config &&
      Number.isFinite(this._hass.config.latitude) &&
      Number.isFinite(this._hass.config.longitude)
    ) {
      return [this._hass.config.latitude as number, this._hass.config.longitude as number];
    }

    return [51.5072, -0.1276];
  }

  private _popupHtml(props: FlightFeatureProperties): string {
    const lines: string[] = [];
    const title = firstNonEmptyString([props.flight, props.registration, props.aircraft_type, "Aircraft"]);

    lines.push(`<strong>${escapeHtml(title)}</strong>`);
    if (props.aircraft_type) {
      lines.push(`Type: ${escapeHtml(props.aircraft_type)}`);
    }
    if (props.registration) {
      lines.push(`Registration: ${escapeHtml(props.registration)}`);
    }
    if (props.manufacturer) {
      lines.push(`Manufacturer: ${escapeHtml(props.manufacturer)}`);
    }
    if (props.registered_owners) {
      lines.push(`Owner: ${escapeHtml(props.registered_owners)}`);
    }

    if (Number.isFinite(props.altitude_ft)) {
      lines.push(`Altitude: ${Math.round(props.altitude_ft as number).toLocaleString()} ft`);
    }

    if (Number.isFinite(props.speed_kt)) {
      lines.push(`Speed: ${Math.round(props.speed_kt as number)} kt`);
    }

    if (Number.isFinite(props.track_deg)) {
      lines.push(`Track: ${Math.round(props.track_deg as number)}°`);
    }

    if (Number.isFinite(props.seen_s)) {
      lines.push(`Seen: ${(props.seen_s as number).toFixed(1)} s ago`);
    }

    const imageHtml = props.airframe_image_url
      ? `<img class="flight-card__popup-image" src="${escapeHtml(props.airframe_image_url)}" alt="Airframe image" loading="lazy" referrerpolicy="no-referrer" />`
      : "";

    return `<p class="flight-card__popup">${lines.join("<br>")}${imageHtml ? `<br>${imageHtml}` : ""}</p>`;
  }

  private _startResizeObserver(): void {
    if (this._mapResizeObserver || !this._els.map || !this._map) {
      return;
    }

    this._mapResizeObserver = new ResizeObserver(() => {
      this._invalidateMapSize(false);
    });
    this._mapResizeObserver.observe(this._els.map);
  }

  private _scheduleResizeFixes(): void {
    this._resizeFixTimeouts.forEach((id) => window.clearTimeout(id));
    this._resizeFixTimeouts = [];

    [0, 150, 600, 1200, 2500].forEach((delayMs) => {
      const id = window.setTimeout(() => this._invalidateMapSize(false), delayMs);
      this._resizeFixTimeouts.push(id);
    });
  }

  private _invalidateMapSize(pan: boolean): void {
    if (!this._map) {
      return;
    }

    requestAnimationFrame(() => {
      if (!this._map) {
        return;
      }
      this._map.invalidateSize({ pan });
    });
  }

  private async _waitForMapContainerReady(): Promise<void> {
    const mapEl = this._els.map;
    if (!mapEl) {
      return;
    }

    const hasUsableSize = () => mapEl.clientWidth >= 280 && mapEl.clientHeight >= 200;
    if (hasUsableSize()) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 5000);
      this._resizeFixTimeouts.push(timeoutId);

      const observer = new ResizeObserver(() => {
        if (!hasUsableSize()) {
          return;
        }
        observer.disconnect();
        window.clearTimeout(timeoutId);
        resolve();
      });

      observer.observe(mapEl);
    });
  }

  private _applyCachedHexDbData(geoJson: FlightCollection): boolean {
    let changed = false;
    for (const feature of geoJson.features) {
      const props = feature.properties;
      const hex = normalizeHex(props.hex);
      if (!hex) {
        continue;
      }

      const info = this._hexDbCache.get(hex);
      if (!info) {
        continue;
      }

      changed = mergeHexDbIntoProperties(props, info) || changed;
    }
    return changed;
  }

  private _queueHexDbLookups(geoJson: FlightCollection): void {
    if (!this._config.hexdb_enabled) {
      return;
    }

    const candidates = new Set<string>();
    for (const feature of geoJson.features) {
      const hex = normalizeHex(feature.properties.hex);
      if (!hex) {
        continue;
      }
      if (this._hexDbCache.has(hex) || this._hexDbInFlight.has(hex)) {
        continue;
      }
      candidates.add(hex);
    }

    let started = 0;
    for (const hex of candidates) {
      if (started >= MAX_HEXDB_LOOKUPS_PER_POLL) {
        break;
      }
      started += 1;
      this._hexDbInFlight.add(hex);

      void this._fetchHexDbAircraft(hex)
        .then((info) => {
          this._hexDbCache.set(hex, info);
          if (this._latestGeoJson && this._applyCachedHexDbData(this._latestGeoJson)) {
            this._scheduleHexDbRefresh();
          }
        })
        .catch(() => {
          this._hexDbCache.set(hex, null);
        })
        .finally(() => {
          this._hexDbInFlight.delete(hex);
        });
    }
  }

  private _scheduleHexDbRefresh(): void {
    if (this._hexDbRefreshDebounce !== undefined) {
      window.clearTimeout(this._hexDbRefreshDebounce);
    }

    this._hexDbRefreshDebounce = window.setTimeout(() => {
      this._hexDbRefreshDebounce = undefined;
      if (!this._latestGeoJson) {
        return;
      }
      this._renderGeoJson(this._latestGeoJson);
    }, 120);
  }

  private async _fetchHexDbAircraft(hex: string): Promise<HexDbAircraftInfo | null> {
    const [aircraftResponse, imageUrl] = await Promise.all([
      fetch(`${HEXDB_LOOKUP_ENDPOINT}${encodeURIComponent(hex)}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      }),
      this._fetchHexDbImageUrl(hex),
    ]);

    if (!aircraftResponse.ok) {
      return null;
    }

    const payload = (await aircraftResponse.json()) as HexDbAircraftResponse;
    if (String(payload.status) === "404" || payload.error) {
      return null;
    }

    const info: HexDbAircraftInfo = {
      icaoTypeCode: firstNonEmptyString([payload.ICAOTypeCode]),
      manufacturer: firstNonEmptyString([payload.Manufacturer]),
      modeS: firstNonEmptyString([payload.ModeS]),
      operatorFlagCode: firstNonEmptyString([payload.OperatorFlagCode]),
      registeredOwners: firstNonEmptyString([payload.RegisteredOwners]),
      registration: firstNonEmptyString([payload.Registration]),
      type: firstNonEmptyString([payload.Type]),
      imageUrl,
    };

    if (
      !info.icaoTypeCode &&
      !info.manufacturer &&
      !info.modeS &&
      !info.operatorFlagCode &&
      !info.registeredOwners &&
      !info.registration &&
      !info.type &&
      !info.imageUrl
    ) {
      return null;
    }

    return info;
  }

  private async _fetchHexDbImageUrl(hex: string): Promise<string> {
    const response = await fetch(`${HEXDB_IMAGE_THUMB_ENDPOINT}${encodeURIComponent(hex)}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "text/plain",
      },
    });

    if (!response.ok) {
      return "";
    }

    const text = (await response.text()).trim();
    if (!text) {
      return "";
    }
    if (text.startsWith("http://") || text.startsWith("https://")) {
      return text;
    }
    if (text.startsWith("/")) {
      return `https://hexdb.io${text}`;
    }
    return "";
  }
}

function normalizeConfig(config: Partial<FlightCardConfig> & Record<string, unknown>): FlightCardConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid configuration");
  }

  const merged: FlightCardConfig = {
    ...DEFAULT_CONFIG,
    ...(config as Partial<FlightCardConfig>),
  };

  merged.title = String(merged.title || DEFAULT_CONFIG.title);
  merged.data_url = String(merged.data_url || DEFAULT_CONFIG.data_url);
  merged.update_interval = clampNumber(merged.update_interval, 2, 600, DEFAULT_CONFIG.update_interval);
  merged.max_age = clampNumber(merged.max_age, 1, 3600, DEFAULT_CONFIG.max_age);
  merged.hexdb_enabled = merged.hexdb_enabled !== false;
  merged.map_height = clampNumber(merged.map_height, 200, 1200, DEFAULT_CONFIG.map_height);
  merged.default_zoom = clampNumber(merged.default_zoom, 1, 18, DEFAULT_CONFIG.default_zoom);
  merged.fit_bounds = merged.fit_bounds !== false;

  merged.center_lat = optionalNumber(merged.center_lat);
  merged.center_lon = optionalNumber(merged.center_lon);

  const advanced = (config as { advanced?: Record<string, unknown> }).advanced;
  if (advanced && typeof advanced === "object") {
    merged.center_lat = optionalNumber((advanced.center_lat as number | string | null | undefined) ?? merged.center_lat);
    merged.center_lon = optionalNumber((advanced.center_lon as number | string | null | undefined) ?? merged.center_lon);

    if (typeof advanced.tile_url === "string" && advanced.tile_url.length > 0) {
      merged.tile_url = advanced.tile_url;
    }

    if (typeof advanced.attribution === "string" && advanced.attribution.length > 0) {
      merged.attribution = advanced.attribution;
    }
  }

  merged.tile_url = String(merged.tile_url || DEFAULT_CONFIG.tile_url);
  merged.attribution = String(merged.attribution || DEFAULT_CONFIG.attribution);

  if (!merged.data_url) {
    throw new Error("Please set data_url in card configuration");
  }

  return merged;
}

function optionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, num));
}

function markerColor(altitudeFt: number | null | undefined): string {
  if (!Number.isFinite(altitudeFt)) {
    return "#64748b";
  }

  const altitude = Math.max(0, altitudeFt as number);
  const maxStop = ALTITUDE_COLOR_STOPS[ALTITUDE_COLOR_STOPS.length - 1];
  if (altitude >= maxStop.altitudeFt) {
    return rgbToHex(maxStop.color);
  }

  for (let index = 1; index < ALTITUDE_COLOR_STOPS.length; index += 1) {
    const lower = ALTITUDE_COLOR_STOPS[index - 1];
    const upper = ALTITUDE_COLOR_STOPS[index];
    if (altitude > upper.altitudeFt) {
      continue;
    }

    const range = upper.altitudeFt - lower.altitudeFt;
    const t = range > 0 ? (altitude - lower.altitudeFt) / range : 0;
    return rgbToHex([
      lerp(lower.color[0], upper.color[0], t),
      lerp(lower.color[1], upper.color[1], t),
      lerp(lower.color[2], upper.color[2], t),
    ]);
  }

  return rgbToHex(maxStop.color);
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function rgbToHex(rgb: [number, number, number]): string {
  const byteToHex = (value: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${byteToHex(rgb[0])}${byteToHex(rgb[1])}${byteToHex(rgb[2])}`;
}

function normalizeHeading(headingDeg: number | null | undefined): number {
  if (!Number.isFinite(headingDeg)) {
    return 0;
  }

  const heading = headingDeg as number;
  return ((heading % 360) + 360) % 360;
}

function aircraftIconHtml(props: FlightFeatureProperties | undefined): string {
  const rotation = normalizeHeading(props?.track_deg);
  const color = markerColor(props?.altitude_ft);
  const iconKey = resolveAircraftIconKey(props);
  const iconUrl = ADSB_ICON_URLS[iconKey] ?? ADSB_ICON_URLS[ADSB_DEFAULT_ICON_KEY];

  if (!iconUrl) {
    return `<span class="flight-card__aircraft-fallback" style="--aircraft-color: ${color};"></span>`;
  }

  const safeIconUrl = escapeHtml(iconUrl);
  const maskStyle = `background: ${color}; -webkit-mask-image: url(&quot;${safeIconUrl}&quot;); mask-image: url(&quot;${safeIconUrl}&quot;);`;

  return `
    <span class="flight-card__aircraft-icon" style="--aircraft-rotation: ${rotation}deg;">
      <span class="flight-card__aircraft-icon-mask" style="${maskStyle}"></span>
    </span>
  `;
}

function resolveAircraftIconKey(props: FlightFeatureProperties | undefined): string {
  if (!props) {
    return ADSB_DEFAULT_ICON_KEY;
  }

  const seen = new Set<string>();
  const candidates = [
    ...extractTypeTokens(props.icao_type_code),
    ...extractTypeTokens(props.aircraft_type),
    ...extractTypeTokens(props.category),
  ];

  for (const token of candidates) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);

    const icon = iconFromTypeToken(token);
    if (icon && ADSB_ICON_URLS[icon]) {
      return icon;
    }
  }

  const fallbackCategory = normalizeEmitterCategory(props.category);
  if (fallbackCategory && ADSB_ICON_URLS[fallbackCategory]) {
    return fallbackCategory;
  }

  return ADSB_DEFAULT_ICON_KEY;
}

function extractTypeTokens(value: string): string[] {
  if (!value) {
    return [];
  }

  const rawTokens = value
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const expanded: string[] = [];
  for (const token of rawTokens) {
    expanded.push(token);

    const compact = token.replace(/[^A-Z0-9]/g, "");
    if (compact && compact !== token) {
      expanded.push(compact);
    }

    if (compact.length >= 5) {
      expanded.push(compact.slice(0, 4));
    }
    if (compact.length >= 4) {
      expanded.push(compact.slice(0, 3));
    }

    const icaoMatch = compact.match(/^([A-Z]{1,3}\d{1,3}[A-Z]?)/);
    if (icaoMatch && icaoMatch[1] !== compact) {
      expanded.push(icaoMatch[1]);
    }
  }

  return expanded;
}

function normalizeEmitterCategory(value: string): string {
  const token = value.trim().toUpperCase();
  if (!/^[A-F]\d{1,2}$/.test(token)) {
    return "";
  }
  return `${token[0].toLowerCase()}${Number(token.slice(1))}`;
}

function iconFromTypeToken(token: string): string {
  const code = token.toUpperCase();
  if (!code) {
    return "";
  }

  const directCategory = normalizeEmitterCategory(code);
  if (directCategory && ADSB_ICON_URLS[directCategory]) {
    return directCategory;
  }

  if (matchesAny(code, ["A7", "F3", "F03", "EC35", "EC45", "H145"])) return "a7";
  if (matchesAny(code, ["B0", "B5", "B6", "B7", "F13"])) return "b0";
  if (matchesAny(code, ["B1", "F1", "F01", "ULM", "ULTRALIGHT"])) return "b1";
  if (matchesAny(code, ["B2", "F12"])) return "b2";
  if (matchesAny(code, ["B3", "F4", "F04"])) return "b3";
  if (matchesAny(code, ["B4", "F6", "F7", "F06", "F07"])) return "b4";
  if (matchesAny(code, ["C0", "C1", "C2", "C3"])) return "c0";
  if (matchesAny(code, ["F5", "F05"])) return "f5";
  if (matchesAny(code, ["F11"])) return "f11";
  if (matchesAny(code, ["F15"])) return "f15";

  if (code.startsWith("A32") || matchesAny(code, ["A318", "A319", "A320", "A321", "A20N", "A21N"])) return "a320";
  if (code.startsWith("A33") || matchesAny(code, ["A300", "A306", "A310", "A332", "A333", "A339"])) return "a330";
  if (code.startsWith("A34") || code.startsWith("A35") || matchesAny(code, ["A340", "A350", "A359", "A35K"])) return "a340";
  if (code.startsWith("A38") || matchesAny(code, ["A380", "A388"])) return "a380";

  if (
    code.startsWith("B73") ||
    code.startsWith("B38") ||
    code.startsWith("B39") ||
    matchesAny(code, ["B727", "B737", "B738", "B739", "B37M", "B38M", "B39M"])
  ) {
    return "b737";
  }
  if (code.startsWith("B74") || matchesAny(code, ["B741", "B742", "B743", "B744", "B748"])) return "b747";
  if (code.startsWith("B76") || matchesAny(code, ["B761", "B762", "B763", "B764", "B767"])) return "b767";
  if (code.startsWith("B77") || matchesAny(code, ["B772", "B773", "B77L", "B77W"])) return "b777";
  if (code.startsWith("B78") || matchesAny(code, ["B788", "B789", "B78X"])) return "b787";

  if (code.startsWith("C13") || code.startsWith("C30") || matchesAny(code, ["C130", "C135", "C17"])) return "c130";
  if (code.startsWith("CRJ") || matchesAny(code, ["CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX"])) return "crjx";
  if (code.startsWith("DH8") || code.startsWith("AT7") || code.startsWith("AT4") || matchesAny(code, ["DHC8"])) return "dh8a";
  if (code.startsWith("E17") || code.startsWith("E19") || matchesAny(code, ["E170", "E175", "E190", "E195"])) return "e195";
  if (code.startsWith("E13") || code.startsWith("E14") || matchesAny(code, ["ERJ", "E135", "E145"])) return "erj";
  if (code.startsWith("F10") || code.startsWith("MD8") || matchesAny(code, ["F100", "MD80", "MD81", "MD82", "MD83", "MD87", "MD88"])) return "f100";
  if (code.startsWith("FA7") || code.startsWith("FA8") || matchesAny(code, ["E35L"])) return "fa7x";
  if (code.startsWith("GLF") || code.startsWith("G5") || code.startsWith("G6") || matchesAny(code, ["GLEX"])) return "glf5";
  if (code.startsWith("C25") || code.startsWith("LJ") || code.startsWith("LEAR")) return "learjet";
  if (code.startsWith("C15") || code.startsWith("C17") || code.startsWith("C18") || code.startsWith("C20")) return "cessna";
  if (code.startsWith("CESS")) return "cessna";
  if (code.startsWith("MD11") || matchesAny(code, ["MD11"])) return "md11";

  return "";
}

function matchesAny(value: string, expected: string[]): boolean {
  return expected.includes(value);
}

function firstNonEmptyString(values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const cleaned = value.trim();
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return "";
}

function normalizeHex(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const cleaned = value.trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(cleaned) ? cleaned : "";
}

function mergeHexDbIntoProperties(props: FlightFeatureProperties, info: HexDbAircraftInfo): boolean {
  let changed = false;

  const applyIfPresent = (key: keyof FlightFeatureProperties, value: string) => {
    if (!value) {
      return;
    }
    if (props[key] !== value) {
      props[key] = value as never;
      changed = true;
    }
  };

  if (!props.aircraft_type && info.type) {
    props.aircraft_type = info.type;
    changed = true;
  } else {
    applyIfPresent("aircraft_type", props.aircraft_type || info.type);
  }
  applyIfPresent("registration", info.registration);
  applyIfPresent("manufacturer", info.manufacturer);
  applyIfPresent("icao_type_code", info.icaoTypeCode);
  applyIfPresent("operator_flag_code", info.operatorFlagCode);
  applyIfPresent("registered_owners", info.registeredOwners);
  applyIfPresent("airframe_image_url", info.imageUrl);

  return changed;
}

function resolveAircraftType(item: AircraftEntry): string {
  return firstNonEmptyString([item.t, item.type, item.ac_type, item.aircraft_type, item.desc]);
}

function aircraftToGeoJson(payload: AircraftPayload, maxAgeSeconds: number): FlightCollection {
  const aircraft = Array.isArray(payload.aircraft) ? payload.aircraft : [];

  const features: FlightFeature[] = aircraft
    .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
    .filter((item) => {
      const seen = Number(item.seen ?? item.seen_pos ?? 0);
      return !Number.isFinite(seen) || seen <= maxAgeSeconds;
    })
    .map((item) => {
      const hex = String(item.hex || "unknown").toLowerCase();
      const flight = typeof item.flight === "string" ? item.flight.trim() : "";
      const category = typeof item.category === "string" ? item.category.trim() : "";
      const aircraftType = resolveAircraftType(item);

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [Number(item.lon), Number(item.lat)],
        },
        properties: {
          hex,
          flight,
          category,
          aircraft_type: aircraftType,
          registration: "",
          manufacturer: "",
          icao_type_code: "",
          operator_flag_code: "",
          registered_owners: "",
          airframe_image_url: "",
          altitude_ft: numberOrNull(item.alt_baro ?? item.altitude ?? item.alt_geom),
          speed_kt: numberOrNull(item.gs ?? item.speed),
          track_deg: numberOrNull(item.track),
          seen_s: numberOrNull(item.seen ?? item.seen_pos),
        },
      };
    });

  return {
    type: "FeatureCollection",
    features,
  };
}

function numberOrNull(value: number | string | null | undefined): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let leafletPromise: Promise<LeafletModule> | undefined;

function loadLeaflet(): Promise<LeafletModule> {
  if (!leafletPromise) {
    leafletPromise = import("leaflet");
  }

  return leafletPromise;
}

function registerCustomCard(): void {
  window.customCards = window.customCards || [];
  if (!window.customCards.find((card) => card.type === CARD_TYPE)) {
    window.customCards.push({
      type: CARD_TYPE,
      name: "Flight Card",
      description: "Poll SkyAware aircraft.json, convert to GeoJSON, and display aircraft on a live map.",
      documentationURL: "https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/",
    });
  }
}

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, FlightCard);
}

registerCustomCard();

console.info(
  `%c FLIGHT-CARD %c ${CARD_VERSION} `,
  "color: white; background: #3b82f6; font-weight: 700;",
  "color: #3b82f6; background: white; font-weight: 700;"
);

declare global {
  interface Window {
    customCards?: CustomCardRegistration[];
  }
}
