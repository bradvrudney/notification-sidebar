# Notification Sidebar: design

Written 2026-11-12, before the first version was built.
Background research: [`docs/feature-inventory.md`](feature-inventory.md).

## Intent

A GNOME Shell extension that gives a right-edge panel holding a persistent rollup of
notifications. The aim is to stop relying on catching banners as they appear and instead
check one place periodically, see what arrived since the last check, and still find something
from earlier today or yesterday.

GNOME today works against that: the list lives in the clock menu, keeps at most 10 items per
app, and is emptied at logout.

## Goals

1. Every notification is recorded and kept for a configurable number of days, across logout and
   reboot, with no per-app cap.
2. One place to look: a right-edge panel opened from a top-bar bell button or Super+V.
3. Opening the panel shows at a glance what is new since it was last opened.
4. Three switchable views of the same history: Timeline, By app, and New then history.
5. Search across the history.
6. The panel is built from stacked sections so a widget area can be added later without
   restructuring.

## Non-goals (for this version)

- Widgets of any kind, and any widget API
- Do Not Disturb schedules, allow-lists, focus timers
- Changing how banners look, where they appear, or how long they stay
- Moving the calendar, weather or world clocks out of the clock menu
- Multi-monitor placement (the panel opens on the primary monitor)
- Inline reply, rich images, phone integration, syncing between machines
- Edge-swipe gesture

## Anti-goals

- **Losing a notification.** A failure anywhere in this extension must never stop GNOME from
  showing a banner, and must never silently drop a record.
- **Leaking content on the lock screen.** Nothing from this extension is visible while locked.
- **Breaking the session.** If the extension throws during enable, the clock menu's own
  notification list must still be there.

## Constraints

- GNOME Shell 51 (developed against 51.1), Wayland, Fedora 45. ESM extension format.
  `shell-version: ["51"]`.
- Built as a normal GNOME Shell extension, installed locally with a
  simple install command (it then appears in Extension Manager under installed extensions).
  **Publishing on extensions.gnome.org is out of scope for this version**.
  Follow the site's review guidelines where that costs nothing, such as cleaning up everything
  on disable, so publishing later stays possible; no licence, packaging or submission work now.
- UUID `notification-sidebar@bradvrudney.github.io`, matching the author's existing
  extension namespace.
- The Shell's notification classes (`ui/messageTray.js`, `ui/messageList.js`, `ui/dateMenu.js`)
  are internal and change between releases. Touch as few of their private members as possible
  and keep every such access in one module.

## Approaches considered

1. **Self-contained extension with its own store and its own list. Chosen.**
   Listens in-process for notifications, writes its own records, draws its own rows.
   Full control over layout, so three views, search and the "new since" divider are simple.
   One thing to install. Costs more UI code.
2. **Re-host the Shell's `MessageView` in a side panel** and re-insert saved notifications at
   login. Least code and looks stock, but that widget only does per-app stacks and enforces the
   10-per-app cap; three views and long history would mean fighting it.
3. **Separate background recorder plus a viewer extension.** Survives the extension being off,
   but is two things to install and run, cannot be shipped through the extensions site alone,
   and cannot invoke notification buttons.

Approach 1 was chosen for layout control and single-package install.

## Key decisions

- **Log, not inbox.** Items are not dismissed to be "done". Opening the panel marks everything
  as seen; items stay in history and age out.
- **History survives logout and reboot**, with the per-app cap lifted.
- **Entries from a previous session are read-only**: they can open their app, but show no
  action buttons.
- **All three layouts ship**, switchable from the panel's "⋯" menu and from settings.
- **Own top-bar button; GNOME's list is removed from the clock menu.** The clock menu keeps
  calendar, events, weather and world clocks. Super+V opens the sidebar instead.
- **Stay loaded on the lock screen to keep recording**, showing nothing.
- Widgets are not built now but must not be designed out.

## Design

### Parts

| Part | Job | Depends on Shell UI? |
|---|---|---|
| **Recorder** | Subscribes to the Shell's message tray, turns each notification into a record, keeps a map from record to live notification object | Yes (the only module that touches `messageTray` internals) |
| **Store** | Holds records in memory, loads and saves the history file, applies retention | No |
| **View models** | Pure functions: records + last-seen time + search text → the rows and section headings for each of the three views | No |
| **Panel** | The sliding right-edge surface: header, search, list, footer; hosts sections | Yes |
| **Indicator** | Bell button with new-item count in the top bar | Yes |
| **Shell integration** | Hides the clock menu's message list and dot, rebinds Super+V, restores both on disable | Yes |
| **Preferences** | Settings window | Adw/GTK only |

Store and view models take no Shell imports so they can be unit-tested under plain `gjs`.

### Recording

- On enable: connect to `Main.messageTray` `source-added`, and walk `getSources()` for sources
  that already exist. For each source connect `notification-added` and `notification-removed`.
- Each added notification becomes a record. While the Shell still holds the notification, the
  record is **live**: the recorder keeps the object so the row can activate it, show its action
  buttons, and follow changes to its title and body.
- When the Shell removes a notification for any reason (app withdrew it, app quit, 10-per-app
  cap, replaced), the record stays and simply stops being live. It is a log.
- If a live notification is updated in place, the record is updated and its time bumped; it
  counts as new again.
- Transient notifications (`isTransient`) are not recorded: apps mark those as not
  worth keeping.
- The recorder's handlers are wrapped so an exception is logged and swallowed, never propagated
  into the Shell's notification path.

### Record

```
id            string   unique, generated
sessionId     string   identifies the login session that recorded it
appId         string?  desktop file id when the source has an app
appName       string   source title
icon          string?  serialised GIcon (Gio.Icon.to_string), else fall back to the app's icon
title         string
body          string
time          int64    unix seconds, local display
urgency       int      Shell urgency enum value
```

"Live" and "has buttons" are runtime state, never written to disk. "Previous session" means
`sessionId` differs from the current one. "New" means `time` is later than the stored
last-seen time; it is derived, not stored per record.

### Storage

- One JSON file under the user data directory for the extension
  (`$XDG_DATA_HOME/notification-sidebar/history.json`), with a format version
  field, mode 0600. Contents are plain text; that is the same exposure as the notification
  already had on screen, but it is now on disk and the README should say so.
- Writes are debounced and atomic (write temp, replace). Flush on disable and on session-mode
  change.
- Retention: drop records older than the retention setting (default 7 days) at load and once
  an hour; also a hard cap of 2000 records, oldest dropped first.
- A corrupt or unreadable file is renamed aside and a fresh history started; this is logged.
- Last-seen time is stored in the same file.

### New and seen

- Last-seen time is set to "now" each time the panel **closes**. While it is open, the divider
  stays where it was when it opened.
- The bell's count is the number of records newer than last-seen. Zero shows a plain bell.
- There is no per-item read state.

### Panel

- Full height below the top bar on the primary monitor, about 360 px wide, floating with
  rounded corners in the Shell's own style, following the system accent colour.
- Slides in from the right edge; honours the reduced-animation setting.
- Closes on Esc, on click outside, and on the bell or Super+V again.
- Top to bottom: title with new count and "⋯" menu; search field (when enabled); scrolling
  section area; footer with the Do Not Disturb switch (bound to the standard GNOME setting).
- "⋯" menu: the three view names as a radio choice, Clear all history, Settings.
- The scrolling area hosts **sections**. A section is a small internal contract: a title, an
  actor, and an order. Version 1 has two: media controls and notifications. A future widget
  area is another section. This is internal structure, not a public plugin API.

### Rows

- A row shows app icon, app name, time, title, and body clamped to two lines.
- New rows carry the accent-colour dot. Rows from a previous session are dimmed and outlined.
- Live rows show the notification's action buttons (up to three, as the Shell does) and
  clicking the row activates the notification. Clicking a non-live row launches or focuses the
  app by `appId`; if there is no app, the row is not clickable.
- **A live notification that has action buttons is always drawn as a full card with its
  buttons, in every view, whether new or seen.** In "New, then history" it stays a card
  under its day heading instead of shrinking to a line; in "By app" it is a card inside its
  block. This is because the Shell's own list is hidden, so the sidebar is the only place those
  buttons can be pressed. Once it stops being live it follows the view's normal rule.
- Compact lines and By-app rows behave like full rows: same click behaviour, same remove button
  on hover.
- Hovering a row shows a remove button. Removing deletes the record and, if live, dismisses the
  notification.
- Times: `HH:MM` for today and yesterday under their headings, weekday and date headings for
  older days.

### The three views

- **Timeline.** One stream, newest first. Headings: "New since HH:MM", "Earlier today",
  "Yesterday", then one per older day. All rows are full cards.
- **By app.** One block per app, ordered by each app's newest item. Block header shows icon,
  name, an "N new" pill, and the time of the newest item. A block shows its new items, or its
  single newest item if none are new; the rest fold behind "Show N earlier". Sources with no
  app are grouped by source name.
- **New, then history.** New items as full cards (first three, then "Show N more new").
  Everything already seen is one compact line each (icon, title, start of body, time) under day
  headings.

Search filters whichever view is active: case-insensitive substring match on app name, title
and body. Empty states: "No notifications yet" and "Nothing matches".

### Media controls

Removing the Shell's message list from the clock menu also removes the media player controls
that live inside it. So the sidebar shows media controls as its first section whenever a player
is active. Reuse the Shell's own media message widget if it can be imported cleanly; otherwise
a minimal title, artist, previous / play-pause / next.

### Shell integration

- Hide the clock menu's notification column and its new-notification dot. The Shell re-shows
  the column on session-mode updates, so re-apply after those. Restore both on disable.
- Take over the Shell's `toggle-message-tray` keybinding (Super+V by default) so it toggles the
  sidebar; restore the original handler on disable. The user's existing binding for that action
  is respected rather than adding a second shortcut setting.
- Session modes `user` and `unlock-dialog`. In `unlock-dialog` the recorder and store keep
  running; the indicator, panel and keybinding are removed.
- Order of enable: start recorder and store first; build UI; hide the Shell's list last, and
  only if everything before it succeeded.

### Settings

GSettings schema, with an Adwaita preferences window:

| Key | Values | Default |
|---|---|---|
| `view` | `timeline`, `by-app`, `new-then-history` | `new-then-history` |
| `retention-days` | 1 to 90 | 7 |
| `show-search` | boolean | true |

The "⋯" menu's view choice writes `view` directly; there is no separate "default view".

### Testing

- Unit tests under `gjs` for the store (load, save, retention, corrupt file) and the three view
  models (grouping, headings, new/seen boundaries, search), with fixed clocks.
- Manual checklist run in a development Shell session, driven by `notify-send` and a GTK test
  app: recording, live buttons, app exit, 10-per-app overflow, logout and back in, lock and
  unlock, disable and re-enable restoring the clock menu and Super+V.

## Left to the builder

- File and module layout, class names, styling details within the Shell's visual language
- How the panel grabs input for click-outside and Esc
- How to launch a development Shell session on GNOME 51
- Test runner choice
- Exact debounce interval and icon fallback order

## Known limits

- Notifications arriving while the extension is disabled, or before it loads at login, are not
  recorded (those already in the tray at enable time are picked up).
- Buttons on previous-session entries cannot be made to work.
- Staying loaded on the lock screen draws extra review if published on extensions.gnome.org.
- Other notification-badge extensions (such as `notification-badge@icsanyi.mailbox.org`) overlap with the bell and
  should be turned off if installed; this extension does not touch it.
