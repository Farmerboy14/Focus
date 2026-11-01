package com.caleb.focus;

import android.app.PendingIntent;
import android.content.Intent;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick setting: send what's on the clipboard to the PC. */
public class ClipTileService extends TileService {
    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        t.setState(Sync.paired(this) ? Tile.STATE_INACTIVE : Tile.STATE_UNAVAILABLE);
        t.setLabel("Clipboard to PC");
        t.updateTile();
    }

    @Override
    public void onClick() {
        Intent i = new Intent(this, SendToPcActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            startActivityAndCollapse(pi);
        } catch (Throwable t) {
            try { startActivity(i); } catch (Throwable ignored) { }
        }
    }
}
