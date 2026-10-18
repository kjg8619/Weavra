# Mobile notifications

Weavra has no hosted push service. **Settings → Notifications** can display or
request device notification permission, but permission alone does not enable
remote delivery.

Remote alerts for completion, failure, approvals and input requests, including
ongoing Android activity and iOS Live Activity delivery, are unavailable.
Direct LAN or Tailscale pairing does not provide background push delivery.

Keep the app open and connected to inspect live work. There is no hosted
foreground suppression or cross-device alert behavior to configure.

Device permission and Android notification channels remain controlled by system
Settings. Local preferences do not create a remote notification or OTA service.
