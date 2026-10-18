# Updating Weavra

Weavra has no automatic updater, public release download channel, app-store
distribution, or mobile over-the-air updates. Upstream T3 Code packages and
releases do not update Weavra.

Build from a Weavra source checkout and explicitly install or run that build.
See the [repository README](../../../../README.md) for the separate App and
Runtime build roots. Local archive helpers do not establish a release channel.

The app and the server running your agents can be on different machines.
Replace the build on the machine that runs the environment you intend to update,
not merely the device used to connect to it.

## Before you update

Server updates restart the connection and can interrupt active agents and
terminal commands. Saved threads, settings, and project files remain.

**Settings → General → Continue threads after restarts** is off by default.
Enable it to resume supported active threads after an update, crash, or machine
restart. Changes are saved to connected environments that support this setting;
update older servers first. If a supported environment was offline or has a
different value, use **Apply to all** in Settings after it connects.
The App server must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.

## Mobile updates

Rebuild and explicitly install the native client from the matching Weavra
source. See the [mobile README](../../apps/mobile/README.md) for local builds.
Store releases and background OTA delivery are unavailable. A mobile-width web
page and an installed native client are different clients.
