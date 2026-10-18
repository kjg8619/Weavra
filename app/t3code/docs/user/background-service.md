# Running the Weavra App server in the background

On Linux and macOS, an explicitly installed Weavra App server can run as a
service for your user so you do not need to keep a terminal open.

## Manage the service

Build and explicitly install the App CLI first ([Install Weavra](./install.md)),
then run these commands on the host. Its declared executable is `weavra-server`;
the separate coding Runtime CLI is `weavra`.

| Task                            | Command                           |
| ------------------------------- | --------------------------------- |
| Install and start               | `weavra-server service install`   |
| Inspect status and log location | `weavra-server service status`    |
| Restart                         | `weavra-server service restart`   |
| Stop and remove from startup    | `weavra-server service uninstall` |

Uninstalling the service leaves your projects, threads, and settings intact.
Running `weavra-server service install` again repairs a service that `weavra-server service status`
reports as broken.

The service runs the local build you explicitly provisioned. Automatic release
downloads and update channels are unavailable. See [Updating Weavra](./updating.md)
before replacing a build. Restarting can interrupt active agents, terminals and
remote clients.

## Platform support

Linux needs systemd user services. Setup enables lingering so T3 Code starts at
boot and keeps running after logout. If this needs administrator permission,
setup prints a recovery command before changing the service.

macOS starts the service when you log in and stops it when you log out. Keep the
Mac logged in and awake for unattended remote access. Installing over SSH while
nobody is logged in at the Mac's screen can fail at the final start step; the
service is still installed and will start at the next login.

Windows background services are not supported.

## Troubleshooting

Start with `weavra-server service status` on the host. It prints the log path and, on Linux,
checks whether the installed service is running, enabled, and allowed to survive
logout.

If it stops when your SSH session closes, check for `linger-disabled`. An
administrator can enable lingering with:

```sh
sudo loginctl enable-linger "$(id -un)"
```

Over SSH, allow sudo to prompt:

```sh
ssh -t your-server 'sudo loginctl enable-linger "$(id -un)"'
```

Then retry service setup as your normal user. Run only the `loginctl` command
with sudo; running the App as root uses a separate installation and home
directory. Without administrator access, run `weavra-server serve` in a terminal and keep
that session open.

| Status problem                          | Next step                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `linger-unavailable`                    | Run `loginctl show-user "$(id -un)" --property=Linger` and check that systemd-logind is available.                             |
| `user-manager-unavailable`              | Run `systemctl --user status` in a login session for the service user; check your distribution's systemd user-session support. |
| `service-disabled` or `service-stopped` | Read the log and `systemctl --user status weavra-server.service`, then use the repair command printed by the App.              |
| `restart-pending`                       | A newer local runtime is installed but the service still runs the previous one. Run `weavra-server service restart`.           |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/weavra.server.service.plist`.
