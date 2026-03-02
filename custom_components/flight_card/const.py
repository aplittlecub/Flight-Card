"""Constants for the Flight Card integration."""

from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "flight_card"
PLATFORMS: list[Platform] = [Platform.SENSOR]

CONF_NAME = "name"
CONF_DATA_URL = "data_url"
CONF_UPDATE_INTERVAL = "update_interval"
CONF_MAX_AGE = "max_age"
CONF_HEXDB_ENABLED = "hexdb_enabled"

DEFAULT_NAME = "Flight Card"
DEFAULT_DATA_URL = "http://192.168.1.250/skyaware/data/aircraft.json"
DEFAULT_UPDATE_INTERVAL = 10
DEFAULT_MAX_AGE = 60
DEFAULT_HEXDB_ENABLED = True

HEXDB_LOOKUP_ENDPOINT = "https://hexdb.io/api/v1/aircraft/"
HEXDB_IMAGE_THUMB_ENDPOINT = "https://hexdb.io/hex-image-thumb?hex="
MAX_HEXDB_LOOKUPS_PER_UPDATE = 6
