# Contributing

Bug reports and pull requests are welcome at
<https://github.com/bradvrudney/notification-sidebar>.

## Reporting a bug

Please include your GNOME Shell version (`gnome-shell --version`), your distribution, and any
lines the extension logged:

```
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i notification-sidebar
```

Notification titles and bodies can appear in logs and in `history.json`. Remove anything
private before posting.

## Making a change

```
make test    # unit tests under gjs
make smoke   # headless Shell in a temporary, isolated session; prints SMOKE OK
```

Both must pass. Neither touches your own session or settings. Changes to anything visible
also need the relevant checks in [docs/manual-test.md](docs/manual-test.md), since nothing
automated looks at the screen.

A few rules the code keeps to:

- Files under `extension/lib/core/` import only GLib and Gio, so they run under plain `gjs`.
- Private GNOME Shell members (names starting with `_`) are touched only in
  `extension/lib/shellTakeover.js`.
- No exception may escape a handler connected to the Shell's message tray. A failure here must
  never stop GNOME showing a notification.
- `disable()` removes everything `enable()` created.

The reasoning behind the structure is in [docs/design.md](docs/design.md).

## Licence

By contributing you agree that your contribution is released under the [MIT licence](LICENSE).
