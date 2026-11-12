import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {MprisSource} from 'resource:///org/gnome/shell/ui/mpris.js';
import {MediaMessage} from 'resource:///org/gnome/shell/ui/messageList.js';

// Media player controls, one Shell `MediaMessage` per MPRIS player, as the
// Shell's own `MessageView` does it (ui/messageList.js `_setupMpris`). The
// clock menu's list that normally shows them is hidden by the takeover.
export class MediaSection {
    /**
     * `closePanel` is called after a message is clicked: the Shell raises the
     * player's window, which would otherwise sit behind the modal panel.
     */
    constructor({closePanel} = {}) {
        this._closePanel = closePanel;
        this._messages = new Map();

        this.actor = new St.BoxLayout({
            style_class: 'ns-media',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            visible: false,
        });

        // MprisSource finds players asynchronously; both signals are
        // disconnected in destroy(). It has no destroy() of its own: once
        // dropped, its D-Bus proxies are released with it.
        this._source = new MprisSource();
        this._addedId = this._source.connect('player-added', (_s, player) => this._add(player));
        this._removedId = this._source.connect('player-removed', (_s, player) => this._remove(player));
        for (const player of this._source.players)
            this._add(player);
    }

    destroy() {
        if (!this._source)
            return;
        this._source.disconnect(this._addedId);
        this._source.disconnect(this._removedId);
        this._source = null;
        // Destroying a message disconnects everything it connected itself
        // (session mode, player, policy) and the `clicked` handler below.
        this.actor.destroy();
        this.actor = null;
        this._messages.clear();
    }

    _add(player) {
        if (this._messages.has(player))
            return;
        try {
            const message = new MediaMessage(player);
            message.connect_after('clicked', () => {
                try {
                    this._closePanel?.();
                } catch (e) {
                    console.error(e);
                }
            });
            this._messages.set(player, message);
            this.actor.insert_child_at_index(message, 0);
        } catch (e) {
            console.error(e);
        }
        this._sync();
    }

    _remove(player) {
        const message = this._messages.get(player);
        if (!message)
            return;
        this._messages.delete(player);
        message.destroy();
        this._sync();
    }

    _sync() {
        this.actor.visible = this._messages.size > 0;
    }
}
