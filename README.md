# Flight Card

Flight Card is a Home Assistant solution for showing live nearby aircraft on a Lovelace map.

It includes:

- a backend integration (`flight_card`) that polls SkyAware and enriches data with HexDB
- a Lovelace custom card (`custom:flight-card`) that renders aircraft on the map

![Flight Card preview](docs/preview.svg)

## Requirements

- Home Assistant
- A reachable SkyAware endpoint (for example `http://10.10.0.249/skyaware/data/aircraft.json`)
- HACS (recommended)

## Install (HACS - Recommended)

This repository should be installed in HACS as **both** repository types:

1. Add `https://github.com/aplittlecub/Flight-Card` as **Integration** custom repository.
2. Install **Flight Card** (Integration).
3. Restart Home Assistant.
4. Add the same repo as **Dashboard** custom repository.
5. Install **Flight Card** (Dashboard).
6. Confirm Lovelace resource exists:
   - URL: `/hacsfiles/Flight-Card/flight-card.js`
   - Type: `JavaScript Module`

## Configure Integration

1. Go to **Settings -> Devices & Services -> Add Integration**.
2. Search for **Flight Card**.
3. Configure:
   - `Data URL` (example: `http://10.10.0.249/skyaware/data/aircraft.json`)
   - `Update interval (seconds)`
   - `Max aircraft age (seconds)`
   - `Enable HexDB enrichment`
4. Finish setup.
5. Confirm the sensor exists in **Developer Tools -> States** (usually `sensor.aircraft`).

## Add Card to Dashboard

```yaml
type: custom:flight-card
title: Nearby Aircraft
entity: sensor.aircraft
map_height: 420
default_zoom: 8
fit_bounds: true
```

## Card Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | string | `Nearby Aircraft` | Card title |
| `entity` | string | `sensor.aircraft` | Sensor created by the Flight Card integration |
| `map_height` | number | `420` | Map height in px |
| `default_zoom` | number | `8` | Initial zoom |
| `fit_bounds` | boolean | `true` | Auto-fit map to aircraft once per load |
| `center_lat` | number | `null` | Optional initial center latitude |
| `center_lon` | number | `null` | Optional initial center longitude |
| `tile_url` | string | OSM | Map tile URL |
| `attribution` | string | OSM | Tile attribution |

## Integration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `data_url` | string | `http://10.10.0.249/skyaware/data/aircraft.json` | SkyAware endpoint |
| `update_interval` | number | `10` | Poll interval (seconds) |
| `max_age` | number | `60` | Max `seen` age in seconds |
| `hexdb_enabled` | boolean | `true` | Enrich data with HexDB metadata and airframe image |

## Troubleshooting

- If the card says `Entity not found`, set `entity:` to the exact sensor ID from Developer Tools.
- If the map is empty but sensor has data, hard refresh browser and cache-bust the resource URL.
- If the integration does not appear, restart Home Assistant after installation.
- If the sensor is unavailable, verify Home Assistant can reach your `data_url`.

## Manual / Local Install

If you are not using HACS:

1. Copy `custom_components/flight_card` into your Home Assistant config folder (`/config/custom_components/flight_card`).
2. Build frontend bundle: `npm run build`.
3. Copy `dist/flight-card.js` into `/config/www/flight-card/flight-card.js`.
4. Add Lovelace resource:
   - URL: `/local/flight-card/flight-card.js`
   - Type: `JavaScript Module`
5. Restart Home Assistant.

## Licensing & Attribution (Final Published - v0.3.1)

Flight Card source code is published under **MIT** (see `package.json`).

Third-party assets/services used by this release:

| Component | License / Terms | Required / Recommended attribution |
| --- | --- | --- |
| Leaflet (`leaflet` v1.9.4) | BSD 2-Clause | Keep Leaflet license in redistribution/docs when required (`node_modules/leaflet/LICENSE`) |
| OpenStreetMap tiles/data (default layer) | OSM attribution policy | **Required:** `© OpenStreetMap contributors` with link to https://www.openstreetmap.org/copyright |
| ADS-B Radar aircraft SVG icon pack | Free for personal/commercial use with backlink requirement (per icon pack readme) | **Required:** `Icons by ADS-B Radar for macOS - https://adsb-radar.com - https://apps.apple.com/app/id1538149835` |
| HexDB lookup API + airframe image endpoint | Service usage terms at provider | **Recommended:** `Aircraft metadata and airframe image lookup by HexDB - https://hexdb.io` |

HexDB endpoints used by this project:

- `https://hexdb.io/api/v1/aircraft/{hex}`
- `https://hexdb.io/hex-image-thumb?hex={hex}`

### Copy/paste attribution block (recommended for docs/footer)

```text
Map data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)
Icons by ADS-B Radar for macOS - https://adsb-radar.com - https://apps.apple.com/app/id1538149835
Aircraft metadata and airframe image lookup by HexDB - https://hexdb.io
```

## Developer Notes

- Local test stack: `docker compose -f docker-compose.home-assistant.yml up -d`
- Dev container setup is included in `.devcontainer/`
- Build commands:
  - `npm run check`
  - `npm run build`
  - `npm run build:watch`

## References

- Home Assistant custom cards: https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/
- Home Assistant frontend data model: https://developers.home-assistant.io/docs/frontend/data/
- Home Assistant data fetching best practices: https://developers.home-assistant.io/docs/integration_fetching_data/
- HACS publish guidance: https://www.hacs.xyz/docs/publish/include/
