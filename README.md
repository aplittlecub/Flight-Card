# Flight Card

Home Assistant Lovelace custom card that polls SkyAware `aircraft.json`, converts aircraft records to GeoJSON, and renders them on a live map.

## References

This setup follows Home Assistant frontend guidance for custom cards and development environments:

- [Custom cards](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/)
- [Frontend development setup](https://developers.home-assistant.io/docs/frontend/development)
- [Devcontainer environment](https://developers.home-assistant.io/docs/setup_devcontainer_environment/)

## Project Layout

- `src/flight-card.ts`: card source (polling, GeoJSON conversion, Leaflet rendering)
- `dist/flight-card.js`: compiled card bundle (generated)
- `.devcontainer/`: VS Code devcontainer config
- `.vscode/tasks.json`: build + Home Assistant helper tasks
- `docker-compose.home-assistant.yml`: optional local Home Assistant for testing

## VS Code + Devcontainer Quick Start

1. Open this repo in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. Wait for the `postCreateCommand` (`npm ci`) to finish.
4. Build once:

```bash
npm run build
```

5. For continuous rebuilds while editing:

```bash
npm run build:watch
```

`build:watch` keeps updating `dist/flight-card.js`.

## Local Home Assistant Test Stack (optional)

Use the included compose file to run Home Assistant and auto-mount this card bundle:

```bash
docker compose -f docker-compose.home-assistant.yml up -d
```

- Home Assistant UI: `http://localhost:8123`
- Card bundle mounted at: `/config/www/flight-card/flight-card.js`
- Lovelace resource URL to add: `/local/flight-card/flight-card.js`

Stop stack:

```bash
docker compose -f docker-compose.home-assistant.yml down
```

## Add The Card

```yaml
type: custom:flight-card
title: Nearby Aircraft
data_url: http://10.10.0.249/skyaware/data/aircraft.json
update_interval: 10
max_age: 60
hexdb_enabled: true
map_height: 420
default_zoom: 8
fit_bounds: true
```

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | string | `Nearby Aircraft` | Card title |
| `data_url` | string | `http://10.10.0.249/skyaware/data/aircraft.json` | SkyAware endpoint |
| `update_interval` | number | `10` | Poll interval (seconds) |
| `max_age` | number | `60` | Max `seen` age in seconds |
| `hexdb_enabled` | boolean | `true` | Enrich with HexDB aircraft metadata and image |
| `map_height` | number | `420` | Map height in px |
| `default_zoom` | number | `8` | Initial zoom |
| `fit_bounds` | boolean | `true` | Auto-fit map to aircraft |
| `center_lat` | number | `null` | Optional initial center latitude |
| `center_lon` | number | `null` | Optional initial center longitude |
| `tile_url` | string | OSM | Map tile URL |
| `attribution` | string | OSM | Tile attribution |

## Notes

- Aircraft with missing `lat`/`lon` are skipped.
- Aircraft older than `max_age` are filtered out.
- When `hexdb_enabled` is true, the card queries `https://hexdb.io/api/v1/aircraft/{hex}` and shows an airframe image from `https://hexdb.io/hex-image-thumb?hex={hex}`.
- If Home Assistant is HTTPS and `data_url` is HTTP, browser mixed-content rules can block requests.
- SkyAware endpoint must allow requests from your Home Assistant frontend origin (CORS).

## Third-Party Licensing & Attribution

This project uses third-party libraries, map data/tiles, icon assets, and API services.

### 1) Leaflet (map rendering)

- Package: `leaflet`
- License: BSD 2-Clause
- Copyright:
  - Volodymyr Agafonkin (2010-2023)
  - CloudMade (2010-2011)
- Source: `node_modules/leaflet/LICENSE`

### 2) OpenStreetMap (map tiles/data)

- Tile URL default: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- Attribution is required when using OSM data/tiles.
- This card includes OSM attribution by default via:
  - `attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>"`
- If you change `tile_url`, ensure you keep the required attribution for that provider.

### 3) ADS-B Radar SVG icon pack

- Asset source: `ADS-B_Radar_Free_Aircraft_SVG_Icons.zip`
- License summary (from icon pack readme):
  - Free for personal and commercial use.
  - Requirement: provide a backlink to ADS-B Radar in your project, website, or documentation (or buy the app).
- Required attribution example:
  - `Icons by ADS-B Radar for macOS - https://adsb-radar.com - https://apps.apple.com/app/id1538149835`

### 4) HexDB API + airframe image lookup

- Endpoints used:
  - `https://hexdb.io/api/v1/aircraft/{hex}`
  - `https://hexdb.io/hex-image-thumb?hex={hex}`
- Attribution recommended in project/docs:
  - `Aircraft metadata and airframe image lookup by HexDB - https://hexdb.io`
- HexDB homepage credits its upstream data sources as:
  - Federal Aviation Administration (FAA)
  - OpenSky Network
  - Plane-Spotters.net
  - Flightradar24

### 5) Your SkyAware/receiver data source

- Endpoint configured in this card: `data_url`
- Ensure your use of that data complies with the terms/policies of your own receiver setup and any upstream feeds.

### Copy/Paste Attribution Block

Use this block in docs, repo README, or project website:

```text
Map data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)
Icons by ADS-B Radar for macOS - https://adsb-radar.com - https://apps.apple.com/app/id1538149835
Aircraft metadata and airframe image lookup by HexDB - https://hexdb.io
```
