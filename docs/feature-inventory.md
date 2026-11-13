# Sidebar panel feature inventory: macOS, Windows 11, GNOME 51

Compiled 2026-11-12. Purpose: catalogue what the macOS and Windows side panels do, so we can
decide what a GNOME Shell extension should replicate.

**Target platform:** GNOME Shell 51.1, Wayland (Fedora 45).

**Confidence markers**

- no marker — confirmed against the vendor's current support page, or (GNOME column) against the
  GNOME Shell 51 source shipped with Fedora 45
- `[K]` — from general knowledge of the product, not re-verified against a current source
- `[news]` — from tech press only; may be Insider-only or changed since

## 1. What "the sidebar" actually is on each OS

| | macOS | Windows 11 | GNOME 51 (today) |
|---|---|---|---|
| Notifications + glanceable info | **Notification Center**: one right-edge panel, notifications on top, widgets below | **Notification center**: right-edge flyout, notifications on top, calendar below | Date menu: centred popover under the clock, notifications left, calendar right |
| Quick toggles | Control Center (separate menu bar popover) `[K]` | **Quick Settings** (separate right-edge flyout, Win+A) | Quick Settings (separate top-right popover) |
| Widgets | Inside Notification Center, and on the desktop | **Widgets board**: separate left-edge panel, Win+W | None (weather and world clocks are fixed sections in the date menu) |

The closest single thing to "the sidebar" is macOS Notification Center: one full-height panel on
the right edge. Windows splits the same job across three surfaces.

## 2. Panel behaviour

| ID | Feature | macOS | Windows 11 | GNOME 51 |
|---|---|---|---|---|
| P1 | Anchored to right screen edge | Yes, full height, no visible chrome (items float over the desktop) `[K]` | Yes, a flyout above the taskbar clock | No, centred popover |
| P2 | Open by clicking the clock | Click date/time in menu bar | Click clock or bell on taskbar | Click clock in top bar |
| P3 | Keyboard shortcut | None by default; assignable in Keyboard settings `[K]` | Win+N | Super+V |
| P4 | Touchpad / touch gesture | Two-finger swipe left from right trackpad edge; swipe right to close | Swipe in from the side of the screen | None |
| P5 | Dismiss | Click anywhere on the desktop | Click outside, Esc `[K]` | Click outside, Esc |
| P6 | Slide-in animation from the edge | Yes `[K]` | Yes `[K]` | No (popover fade) |
| P7 | Multi-monitor | Opens on the display with the menu bar `[K]` | Opens on whichever monitor's tray you click `[news]` | Primary monitor only |
| P8 | New-notification indicator when closed | None in the menu bar `[K]` | Bell icon lights up; count badge `[K]` | Dot next to the clock |
| P9 | Scrolls as one column | Yes, notifications then widgets | Notifications scroll, calendar pinned at the bottom | Notification list scrolls; calendar column fixed |

## 3. Notification banners (pop-ups)

| ID | Feature | macOS | Windows 11 | GNOME 51 |
|---|---|---|---|---|
| B1 | Position | Top-right | Bottom-right `[K]` | Top-centre |
| B2 | Auto-dismiss vs persistent | Per app: temporary (banner) or persistent (alert) `[K]` | Banners time out; duration set in Accessibility `[K]` | Times out; critical urgency stays |
| B3 | Inline action buttons | Yes (Reply, Snooze, Archive…) | Yes (dismiss, snooze…) | Yes, up to 3 buttons |
| B4 | Inline text reply | Yes `[K]` | Yes | No |
| B5 | Hover to reveal options / expand | Yes | Arrow next to the time expands | Hover expands |
| B6 | Swipe/drag banner away | Swipe right `[K]` | Swipe right `[K]` | No |
| B7 | Queueing of several banners | Stacks `[K]` | Stacks `[K]` | One at a time, queue of 3 |

## 4. Notification list

| ID | Feature | macOS | Windows 11 | GNOME 51 |
|---|---|---|---|---|
| N1 | Group by app | Yes, as a collapsed stack | Yes, under an app header | Yes, as a collapsed stack (3 visible layers) |
| N2 | Expand / collapse a group | Click stack; "Show Less" collapses | Always expanded under header; each item has an expand arrow | Click stack; click outside or Esc collapses |
| N3 | Grouping mode per app | Automatic / By App / Off `[K]` | No | No |
| N4 | Dismiss one | Remove (X) button | Close (X) button | X button |
| N5 | Dismiss all from one app | Click-and-hold X, or X on the stack | X next to the app name | Clear on the expanded group |
| N6 | Clear everything | No single button; per stack only `[K]` | "Clear all" button | "Clear" button |
| N7 | Click opens the source app | Yes | Yes | Yes |
| N8 | Actions and reply from the list | Yes | Yes | Actions yes, reply no |
| N9 | Per-notification menu: mute / turn off app | "…" menu: mute 1 hour, mute today, turn off `[K]` | "…" menu: turn off all notifications for app, go to settings | No |
| N10 | Ordering | Newest first `[K]` | By app priority (Top / High / Normal), then newest | Newest first; critical first |
| N11 | Timestamps | Relative ("5m ago") `[K]` | Clock time `[K]` | Relative |
| N12 | Rich content: images, thumbnails | Yes `[K]` | Yes, hero image, progress bars `[K]` | App icon and body only |
| N13 | History retained | Until dismissed; survives restart `[K]` | Until dismissed; survives restart `[K]` | Max 10 per app; lost on logout |
| N14 | AI summary of long or stacked notifications | Yes, when Apple Intelligence is on | No | No |
| N15 | Notifications mirrored from phone | iPhone notifications `[K]` | Via Phone Link `[K]` | Only with GSConnect or similar |
| N16 | Empty state | "No Notifications" `[K]` | "No new notifications" `[K]` | "No Notifications" |

## 5. Do Not Disturb and Focus

| ID | Feature | macOS | Windows 11 | GNOME 51 |
|---|---|---|---|---|
| D1 | One-click DND | In Control Center, not in the panel | Bell "zZ" button in the panel header | Switch at the bottom of the notification list, plus a Quick Settings toggle |
| D2 | What DND does | Silences banners; items still collect in the panel | Only alarms, reminders and chosen apps show banners; rest goes straight to the panel | Suppresses banners; critical still shows |
| D3 | Allow-list of apps | Per Focus | "Priority notifications": add apps | No |
| D4 | Allow-list of people, repeated calls | Per Focus | Calls and reminders checkboxes | No |
| D5 | Time-sensitive breakthrough | Yes, toggle per Focus and per app | Alarms and reminders always | Critical urgency always |
| D6 | Scheduled DND | By time and days, by location, by app opened | By time of day | No |
| D7 | Automatic DND | — | When duplicating display, gaming, full-screen app, first hour after a feature update | No |
| D8 | Named modes | Multiple Focus modes (Work, Sleep, custom) | Single DND plus Focus sessions | Single DND |
| D9 | Timed focus session | No | Focus session: countdown timer, hides badges and taskbar flashing, turns on DND `[K]` | No |
| D10 | Hide while screen sharing | "Mirroring or sharing the display: Notifications Off / Allow" | Automatic DND when duplicating display | No |
| D11 | App filters during focus | Focus Filters (Calendar, Mail, Messages, Safari, some third-party) | No | No |

## 6. Notification settings

| ID | Feature | macOS | Windows 11 | GNOME 51 |
|---|---|---|---|---|
| S1 | Per-app on/off | Yes | Yes | Yes (`enable`) |
| S2 | Per-app banners on/off | Style: None / Banners / Alerts `[K]` | Yes | Yes (`show-banners`) |
| S3 | Per-app show in panel | Yes `[K]` | Yes | No |
| S4 | Per-app sound | Yes `[K]` | Yes | Yes (`enable-sound-alerts`) |
| S5 | Per-app lock screen visibility and content | Yes `[K]` | Hide content on lock screen | Yes (`show-in-lock-screen`, `details-in-lock-screen`) |
| S6 | Per-app priority | No | Top / High / Normal | No |
| S7 | Per-app badge on app icon | Yes `[K]` | Yes `[K]` | No |
| S8 | Global preview visibility | Always / When Unlocked / Never | — | Lock-screen toggle only |
| S9 | Show when display sleeping / locked | Two toggles | — | Lock-screen toggle |
| S10 | Per-app force expanded banners | No | No | Yes (`force-expanded`) |

## 7. Calendar, clock and agenda

| ID | Feature | macOS | Windows 11 | GNOME 51 |
|---|---|---|---|---|
| C1 | Month calendar in the panel | Only as a widget | Yes, built in, collapsible to a single date row | Yes, built in |
| C2 | Clock in the panel | Only as a widget | Optional large clock with seconds; extra clocks for other time zones `[news]` | Date heading only; world clocks section |
| C3 | Upcoming events | Calendar widget | Agenda view, with join-meeting buttons `[news]`, rollout status unverified | Events for the selected day |
| C4 | Week numbers | Widget dependent | Optional `[K]` | Optional |
| C5 | Click a day to see its events | In widget | Agenda view `[news]` | Yes |

## 8. Widgets

| ID | Feature | macOS | Windows 11 (Widgets board) | GNOME 51 |
|---|---|---|---|---|
| W1 | Widgets in the same panel as notifications | Yes, below notifications | No, separate left panel (Win+W) | Fixed weather and world clock sections |
| W2 | Widget gallery with search and categories | Yes, "Edit Widgets" at the panel bottom | "+ Add widgets", then Pin | No |
| W3 | Sizes | Small / medium / large / extra large via context menu `[K]` | Small / medium / large `[K]` | No |
| W4 | Reorder by dragging | Yes | Yes `[K]` | No |
| W5 | Remove | Context menu, or Option-hover minus button | Unpin from the widget's "…" menu `[K]` | No |
| W6 | Configure a widget | "Edit <widget>" in context menu, when supported | "Customize" in the widget's "…" menu `[K]` | No |
| W7 | Interactive widgets (buttons, toggles) | Yes `[K]` | Yes `[K]` | No |
| W8 | Click-through to the app | Yes | Yes `[K]` | Weather and clocks open their apps |
| W9 | Third-party widgets | Yes, shipped with apps | Yes, shipped with apps; adoption is thin | Extensions only |
| W10 | Phone widgets | iPhone widgets (iOS 17+) | No | No |
| W11 | Widgets on the desktop | Yes, drag out of the panel; dim/monochrome options | No | No |
| W12 | News feed | No | Yes (MSN, moving to Copilot Discover `[news]`) | No |
| W13 | Lock screen widgets | No `[K]` | Yes, managed separately `[news]` | No |
| W14 | Typical built-ins | Calendar, Weather, Stocks, Clock, Reminders, Notes, Batteries, Screen Time `[K]` | Weather, Calendar, To Do, Photos, Sports, Traffic, Watchlist `[K]` | Weather, world clocks |

## 9. Quick settings and media

Listed for completeness. Both OSes keep these outside the notification panel, and GNOME already
has an equivalent Quick Settings menu.

| ID | Feature | macOS (Control Center) `[K]` | Windows 11 (Quick Settings) | GNOME 51 |
|---|---|---|---|---|
| Q1 | Toggle tiles | Wi-Fi, Bluetooth, AirDrop, Focus, Stage Manager, Screen Mirroring | Wi-Fi, Bluetooth, Airplane mode, Battery saver, Night light, Cast, Project, Mobile hotspot, Nearby sharing, Accessibility | Wi-Fi, Bluetooth, power mode, Night Light, Dark Style, DND, Airplane |
| Q2 | Sliders | Display brightness, sound | Brightness, volume, with output device picker and volume mixer | Volume, brightness |
| Q3 | Editable tile set | Yes | Yes (pencil icon; add, remove, reorder) | Via extensions |
| Q4 | Media controls | Now Playing tile | Media card above Quick Settings `[K]` | Media card at the top of the **notification list** (MPRIS) |

## 10. What GNOME 51 already gives us

Read from the Shell source shipped with Fedora 45 (`messageList.js`, `messageTray.js`, `calendar.js`,
`dateMenu.js`, `status/doNotDisturb.js`):

- Per-app grouping into expandable stacks, clear per group and clear all
- Up to 3 action buttons per notification, URL highlighting in bodies
- MPRIS media controls as a card in the list
- DND switch and Quick Settings toggle
- Month calendar, day events, world clocks, weather
- Per-app settings: enable, banners, sound, lock screen, force-expanded
- Limits: 10 notifications kept per app, 3 queued banners, history lost on logout

The reusable pieces are `MessageView` / `NotificationMessageGroup` (the list) and `Calendar`
plus the date menu sections. An extension can re-host these in a new container instead of
rewriting them.

## 11. Gaps: what neither GNOME nor a simple re-skin provides

Grouped by how much work they imply for an extension.

**Layout only (re-host existing Shell widgets)**

- P1, P6, P9 — full-height right-edge panel that slides in, single scrolling column
- P7 — open on the monitor where it was invoked
- C1 — collapsible calendar

**New behaviour inside the Shell process**

- P4 — edge swipe gesture
- N9 — per-notification "mute for 1 hour / today / turn off app" menu
- N10, S6 — per-app priority ordering
- N13 — persistent history across logout, higher per-app limit
- D3, D6, D7 — DND allow-list, schedule, automatic triggers (full-screen, screen sharing)
- D9 — focus session timer
- B1 — banner position (top-right)

**Needs a new subsystem**

- W2–W9 — a widget host: gallery, sizes, drag reorder, per-widget config. GNOME has no widget
  API, so widgets would be defined by this extension (or by a plugin format it invents).
- B4, N8 — inline reply. The freedesktop notification spec has `inline-reply` only as a
  non-standard hint `[K]`; app support is sparse.
- N12 — rich images beyond the icon (the spec carries `image-data`; Shell shows it only as the
  icon `[K]`)

**Not realistic on Linux**

- N14 AI summaries, N15/W10 phone integration, D11 Focus Filters, W12 news feed

## Sources

- Apple, *Get notifications on Mac*: https://support.apple.com/guide/mac-help/mchle7f8a9b0/mac
- Apple, *Notifications settings on Mac*: https://support.apple.com/guide/mac-help/mchl205da693/mac
- Apple, *Add and customize widgets on Mac*: https://support.apple.com/guide/mac-help/mchl52be5da5/mac
- Apple, *Set up a Focus on Mac*: https://support.apple.com/guide/mac-help/mchl613dc43f/
- Apple, *Notification Center on your Mac*: https://support.apple.com/guide/imac/apd6d7eb47b9/mac
- Microsoft, *Notifications and Do Not Disturb in Windows*: https://support.microsoft.com/en-us/help/4014934
- Microsoft, *How to use widgets on Windows 11*: https://www.microsoft.com/en-us/windows/learning-center/how-to-use-laptop-and-desktop-widgets-on-windows-11
- Windows Latest, notification center on secondary displays and clock: https://www.windowslatest.com/2025/10/04/windows-11s-notification-center-opens-on-secondary-display-gets-a-clock-and-more
- Windows Central, Agenda view announcement: https://www.windowscentral.com/microsoft/windows-11/windows-11-taskbar-calendar-flyout-agenda-view-announcement
- Windows Central, Widgets board redesign: https://www.windowscentral.com/microsoft/windows-11/whats-next-for-windows-11-in-2026-first-look-at-new-features-arriving-in-the-coming-months
- Digital Citizen, Quick Settings: https://digitalcitizen.life/windows-11-quick-settings
- GNOME Shell 51.1 source, extracted from `/usr/lib64/gnome-shell/libshell-51.so`
