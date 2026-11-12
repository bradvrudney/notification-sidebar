# Manual test checklist

Run after `make install`, a logout and login, and `gnome-extensions enable notification-sidebar@bradvrudney.github.io`. Send test notifications with `notify-send`. A GTK app that sends notifications with buttons is useful for the live-button checks. Open the panel with the bell or Super+V.

## Recording

- [ ] Run `notify-send -a Test "Hello" "first body"`. The banner appears as usual, the bell count goes up by one, and the entry is in the open panel with app name, time, title and body.
- [ ] Run `notify-send -a Test -h boolean:transient:true "Transient" "x"`. The banner appears but no entry is added.
- [ ] Send 12 notifications from one app. All 12 are in the panel; none is dropped at 10.
- [ ] Update a live notification in place (same replace id). The entry changes in place, moves to the top and counts as new.

## Live buttons and app exit

- [ ] Send a notification with buttons from a GTK app. The row shows up to three buttons; pressing one runs its action.
- [ ] Press a button. The panel closes.
- [ ] Click a live row. The notification activates and its app comes to the front.
- [ ] Quit the app that sent a notification with buttons. The entry stays and its buttons are gone.

## Sessions

- [ ] Log out and back in, without rebooting. Entries from before are still there and are marked as from a previous session: dimmed and outlined, with no buttons. Clicking one with an app opens that app; one without an app is not clickable.
- [ ] Disable and re-enable the extension without logging out. Entries from this login are not marked as from a previous session.
- [ ] Leave a notification from a GTK or Flatpak app in the tray (do not dismiss it), log out and back in. GNOME restores it, and the panel shows it once, not twice; it is not marked as from a previous session while GNOME still holds it. Log out and in again and it is still there once.
- [ ] Lock the screen, send a notification, unlock. The entry is in the panel. While locked, nothing from the extension was visible: no bell, no panel, and Super+V did nothing.
- [ ] An entry from a previous session whose icon file no longer exists shows a sensible fallback icon, not a blank or broken one.

## Views

- [ ] Timeline: newest first, with headings "New since HH:MM", "Earlier today", "Yesterday" and a heading per older day.
- [ ] By app: one block per app, ordered by newest item, with icon, name, an "N new" pill and a time. Older items are behind "Show N earlier".
- [ ] New, then history: new items are full cards (first three, then "Show N more new"); seen items are one compact line each under day headings.
- [ ] Each view matches the mockup in `.superpowers/brainstorm/255498-1794512223/content/panel-layouts-v2.html` in layout, spacing and the accent dot on new rows.
- [ ] Switch views from the three-dots menu. The layout changes at once and the menu shows the chosen view.
- [ ] In settings, change View while the panel is open. The panel's layout follows, and the menu's choice follows.
- [ ] A live notification with buttons is a full card in every view, new or seen.

## Search, remove and clear

- [ ] Type part of an app name, a title and a body, in different case. Each filters the active view. Text that matches nothing shows "Nothing matches". With no history the panel shows "No notifications yet".
- [ ] In settings, turn off Show search. The search field disappears from the open panel. Turn it on and it returns.
- [ ] Hover a row. A remove button appears. Remove a row and it is gone, also after closing and reopening the panel. Removing a live row also dismisses the notification.
- [ ] Three dots, Clear all history. Every entry is removed, live notifications are dismissed, and the bell shows no count.

## Retention

- [ ] Set Keep history for to 1 day while older entries exist. Entries older than a day are gone from the panel at once. Set it back to 7.

## Panel behaviour

- [ ] Click the bell. The panel opens. Click the bell again. The panel closes.
- [ ] Super+V opens and closes the panel.
- [ ] Super+V works with Num Lock on.
- [ ] Super+V works while another top-bar menu (for example Quick Settings) is open: that menu closes and the panel opens.
- [ ] Esc, a click outside, the bell and Super+V each close the panel.
- [ ] Opening the panel and closing it clears the count on the bell. The divider stays where it was while the panel was open.
- [ ] With animations turned off in GNOME settings, the panel appears and disappears without sliding.
- [ ] Tab and Shift+Tab move focus through the search field, the three-dots button, the rows and the Do Not Disturb row, in that order and back. Space and Enter toggle Do Not Disturb on that row.

## Do Not Disturb

- [ ] Click the Do Not Disturb switch on its knob. It toggles once.
- [ ] Click it on its track. It toggles once.
- [ ] Click it on its label. It toggles once.
- [ ] After each click the state matches GNOME's Do Not Disturb toggle in Quick Settings, and changing it there changes the panel's switch.

## Media

- [ ] Start a media player (for example play audio in a browser or a music app). Media controls appear at the top of the panel with title, artist, previous, play/pause and next, and each button works.
- [ ] Quit the player. The controls go away.

## Clock menu

- [ ] Open the clock menu. The calendar, events, weather and world clocks are there; the notification list is gone, and nothing looks broken or leaves an empty column or gap.
- [ ] A new notification does not show the dot on the clock.
- [ ] Lock, unlock, and open the clock menu again. The notification list has not come back.

## Disable

- [ ] Run `gnome-extensions disable notification-sidebar@bradvrudney.github.io`. The bell is gone, the clock menu shows its notification list and dot again, and Super+V opens the clock menu list as it did before.
- [ ] Enable it again. Everything is replaced and the history is still there.
- [ ] Check `journalctl --user -b | grep notification-sidebar` after the whole run. There are no errors.
