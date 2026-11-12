package com.caleb.focus;

import android.app.Activity;
import android.app.NotificationManager;
import android.app.role.RoleManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** The few switches Android needs flipped before Focus can do its job. */
public class SetupActivity extends Activity {
    private LinearLayout list;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        SkyView sky = new SkyView(this, false);
        sky.setVeil(0.45f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        ScrollView sc = new ScrollView(this);
        sc.setVerticalScrollBarEnabled(false);
        sc.setClipToPadding(false);
        root.addView(sc, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        LinearLayout col = Ui.column(this);
        sc.addView(col);
        Ui.edgeToEdge(this, sc, Ui.dp(this, 20), Ui.dp(this, 8), Ui.dp(this, 24));
        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        col.addView(top);
        col.addView(Ui.text(this, "Setup", 30, Ui.INK, Ui.SORA_LIGHT), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        TextView sub = Ui.text(this, "Do these in order. Each one opens the right Android screen; come back here when you're done.", 13, Ui.MUTED, Ui.SORA);
        sub.setLineSpacing(0, 1.3f);
        col.addView(sub, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        list = Ui.column(this);
        col.addView(list, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 16)));
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private boolean isHome() {
        try {
            RoleManager rm = (RoleManager) getSystemService(ROLE_SERVICE);
            return rm != null && rm.isRoleHeld(RoleManager.ROLE_HOME);
        } catch (Throwable t) { return false; }
    }

    private boolean dndOk() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }

    private void render() {
        list.removeAllViews();
        final boolean on = FocusService.isOn(this);
        step("1", "Make Focus your home screen", "So the home button always brings you here.", isHome(), new Runnable() {
            @Override public void run() {
                try {
                    RoleManager rm = (RoleManager) getSystemService(ROLE_SERVICE);
                    startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), 7);
                } catch (Throwable t) {
                    startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));
                }
            }
        });
        step("2", "Allow restricted settings", "Android blocks app blocking for apps installed from a file until you allow it. On the App info screen tap ⋮ (top right), then “Allow restricted settings”. If you don't see it, skip to step 3 first, try to turn it on, then come back.", on, new Runnable() {
            @Override public void run() {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            }
        });
        step("3", "Turn on app blocking", "Open Accessibility, tap “Focus app blocking” (it may be under Downloaded apps), and turn it on.", on, new Runnable() {
            @Override public void run() { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
        });
        step("4", "Let Focus turn on Do Not Disturb", "Find Focus in the list and allow it. Strict blocks and Time with God silence notifications.", dndOk(), new Runnable() {
            @Override public void run() { startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)); }
        });

        list.addView(Ui.label(this, "Good to know"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        TextView n = Ui.text(this, "Settings always stays open, so you can never lock yourself out. To pause Focus, turn off app blocking in Accessibility.\n\nRejoiceify is allowed during Time with God once it's installed.", 13, Ui.MUTED, Ui.SORA);
        n.setLineSpacing(0, 1.35f);
        list.addView(n, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        String crash = Store.get(this).prefs().getString("lastCrash", null);
        if (crash != null) {
            list.addView(Ui.label(this, "Last problem"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
            TextView c = Ui.text(this, crash, 10, Ui.QUIET, Ui.MONO);
            c.setTextIsSelectable(true);
            list.addView(c, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
            TextView clear = Ui.plain(this, "Clear", Ui.MUTED);
            clear.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { Store.get(SetupActivity.this).prefs().edit().remove("lastCrash").apply(); render(); }
            });
            list.addView(clear);
        }
        list.addView(Ui.label(this, "Your PC"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        boolean paired = Sync.paired(this);
        long heard = Sync.lastHeard();
        String st = !paired ? "Not connected. Open Focus on your PC → Settings → Pair with phone, then type the code here."
                : heard > 0 ? "Connected. Last heard from the link " + Math.max(0, (System.currentTimeMillis() - heard) / 60000) + " min ago."
                : "Paired. Waiting for the link…";
        TextView pcs = Ui.text(this, st, 13, Ui.MUTED, Ui.SORA);
        pcs.setLineSpacing(0, 1.3f);
        list.addView(pcs, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        TextView pair = Ui.chip(this, paired ? "Pair with a different PC" : "Connect to your PC", true);
        pair.setTextColor(Ui.GOLD);
        pair.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { askCode(); } });
        list.addView(pair, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 10)));
        TextView how = Ui.text(this, "Send things to the PC: Share → Send to PC, or add the “Clipboard to PC” tile to your quick settings.", 12, Ui.QUIET, Ui.SORA);
        how.setLineSpacing(0, 1.3f);
        list.addView(how, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        LinearLayout lr = Ui.row(this);
        TextView lt = Ui.text(this, "Focus lock screen", 15, Ui.INK, Ui.SORA);
        lr.addView(lt, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        android.widget.Switch ls = new android.widget.Switch(this);
        ls.setChecked(LockActivity.enabled(this));
        ls.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override public void onCheckedChanged(android.widget.CompoundButton b, boolean on) {
                Store.get(SetupActivity.this).prefs().edit().putBoolean("lockScreen", on).apply();
            }
        });
        lr.addView(ls);
        list.addView(lr, Ui.lp(Ui.MATCH, Ui.dp(this, 52), Ui.dp(this, 8)));
        TextView lnote = Ui.text(this, "Shows your block, what's next and today's verse when you wake the phone. Swipe up, then unlock as usual. Needs app blocking on.", 12, Ui.MUTED, Ui.SORA);
        lnote.setLineSpacing(0, 1.3f);
        list.addView(lnote, Ui.lp(Ui.MATCH, Ui.WRAP));

        LinearLayout ir = Ui.row(this);
        ir.addView(Ui.text(this, "Night line icons", 15, Ui.INK, Ui.SORA), new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        android.widget.Switch is = new android.widget.Switch(this);
        is.setChecked(Icons.night(this));
        is.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override public void onCheckedChanged(android.widget.CompoundButton b, boolean on) { Icons.setNight(SetupActivity.this, on); }
        });
        ir.addView(is);
        list.addView(ir, Ui.lp(Ui.MATCH, Ui.dp(this, 52), Ui.dp(this, 8)));
        TextView inote = Ui.text(this, "Thin ice-blue line icons for your apps (gold during Time with God), from the open-source Lawnicons pack. Off shows each app's own icon.", 12, Ui.MUTED, Ui.SORA);
        inote.setLineSpacing(0, 1.3f);
        list.addView(inote, Ui.lp(Ui.MATCH, Ui.WRAP));

        // Themes
        list.addView(Ui.label(this, "Theme"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        LinearLayout tr = Ui.row(this);
        final boolean isFall = Theme.fall(this);
        TextView tNight = Ui.chip(this, "Night sky", !isFall);
        TextView tFall = Ui.chip(this, "Fall", isFall);
        tNight.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { if (Theme.fall(SetupActivity.this)) { Theme.set(SetupActivity.this, Theme.NIGHT); recreate(); } }
        });
        tFall.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (!Theme.fall(SetupActivity.this)) { Theme.set(SetupActivity.this, Theme.FALL); if (Theme.hasPhoto(SetupActivity.this)) recreate(); else pickPhoto(); }
            }
        });
        tr.addView(tNight);
        LinearLayout.LayoutParams tfl = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
        tfl.leftMargin = Ui.dp(this, 8);
        tr.addView(tFall, tfl);
        list.addView(tr, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 10)));
        if (isFall) {
            TextView pick = Ui.chip(this, Theme.hasPhoto(this) ? "Choose a different photo" : "Choose your photo", false);
            pick.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { pickPhoto(); } });
            list.addView(pick, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 10)));
        }
        TextView tnote = Ui.text(this, isFall
                ? "Your photo fills the background with leaves drifting down, and the accents turn amber. The photo stays on this phone. Time with God keeps its dawn sky."
                : "Stars and ice blue. Fall puts your own photo behind everything, with warm colors and falling leaves.", 12, Ui.MUTED, Ui.SORA);
        tnote.setLineSpacing(0, 1.3f);
        list.addView(tnote, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        TextView wall = Ui.chip(this, isFall && Theme.hasPhoto(this) ? "Use your photo on the home and lock screen" : "Use the Focus night sky on home and lock screen", false);
        wall.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                HomeActivity.matchWallpaper(SetupActivity.this, true);
                android.widget.Toast.makeText(SetupActivity.this, "Wallpaper set.", android.widget.Toast.LENGTH_SHORT).show();
            }
        });
        list.addView(wall, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 12)));

        list.addView(Ui.label(this, "Updates"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        final TextView upd = Ui.goldButton(this, "Check for updates");
        upd.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Updater.Info a = Updater.available();
                if (a != null) { Updater.install(SetupActivity.this, a); return; }
                upd.setText("Checking…");
                Updater.check(SetupActivity.this, true, new Updater.Callback() {
                    @Override public void done(Updater.Info newer, String error) {
                        if (error != null) upd.setText(error);
                        else if (newer == null) upd.setText("You have the newest version");
                        else upd.setText("Install Focus " + newer.name);
                    }
                });
            }
        });
        list.addView(upd, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
        TextView ver = Ui.mono(this, "Focus " + Updater.installedName(this), 10, 0xFF5E5B55);
        list.addView(ver, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 20)));
    }

    private void askCode() {
        final android.widget.EditText in = new android.widget.EditText(this);
        in.setHint("XXXX-XXXX-XXXX-XXXX");
        in.setSingleLine(true);
        in.setTypeface(Ui.MONO);
        in.setTextColor(Ui.INK);
        in.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        android.widget.FrameLayout box = new android.widget.FrameLayout(this);
        box.setPadding(Ui.dp(this, 24), Ui.dp(this, 8), Ui.dp(this, 24), 0);
        box.addView(in);
        new android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Pairing code from your PC")
                .setView(box)
                .setPositiveButton("Connect", new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface d, int w) {
                        String code = Sync.normalize(in.getText().toString());
                        if (code.length() != 16) {
                            android.widget.Toast.makeText(SetupActivity.this, "That code should be 16 letters and numbers.", android.widget.Toast.LENGTH_LONG).show();
                            return;
                        }
                        Sync.pair(SetupActivity.this, code);
                        android.widget.Toast.makeText(SetupActivity.this, "Connecting to your PC…", android.widget.Toast.LENGTH_SHORT).show();
                        render();
                    }
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void step(String num, String title, String body, boolean done, final Runnable go) {
        LinearLayout row = Ui.column(this);
        row.setBackground(new Ui.StoneDrawable(this, Ui.STONE, done ? 0x14FFFFFF : 0x4DF2D38A, 18));
        row.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
        LinearLayout h = Ui.row(this);
        h.addView(Ui.mono(this, done ? "Done" : "Step " + num, 11, done ? Ui.MUTED : Ui.GOLD));
        row.addView(h);
        row.addView(Ui.text(this, title, 17, done ? Ui.MUTED : Ui.INK, Ui.SORA_MED), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));
        TextView t = Ui.text(this, body, 13, Ui.MUTED, Ui.SORA);
        t.setLineSpacing(0, 1.3f);
        row.addView(t, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        row.setClickable(true);
        Ui.press(row);
        row.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { go.run(); } catch (Throwable ignored) { } }
        });
        list.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
    }

    private static final int PICK_PHOTO = 21;

    @Override
    protected void onActivityResult(int req, int res, android.content.Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK_PHOTO) {
            if (res == RESULT_OK && data != null && data.getData() != null) photoPicked(data.getData());
            else recreate();   // nothing picked: still show the Fall theme's options
        }
    }

    /** The system photo picker: no permission needed, and Focus only sees the one photo you pick. */
    private void pickPhoto() {
        android.content.Intent i;
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            i = new android.content.Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);
        } else {
            i = new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT);
            i.setType("image/*");
        }
        try { startActivityForResult(i, PICK_PHOTO); }
        catch (Exception e) { android.widget.Toast.makeText(this, "Couldn't open the photo picker.", android.widget.Toast.LENGTH_SHORT).show(); }
    }

    private void photoPicked(final android.net.Uri uri) {
        final android.content.Context app = getApplicationContext();
        android.widget.Toast.makeText(this, "Setting your photo…", android.widget.Toast.LENGTH_SHORT).show();
        new Thread(new Runnable() {
            @Override public void run() {
                boolean ok = true;
                try { Theme.savePhoto(app, uri); } catch (Throwable t) { ok = false; }
                final boolean done = ok;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (!done) android.widget.Toast.makeText(SetupActivity.this, "That photo couldn't be opened.", android.widget.Toast.LENGTH_SHORT).show();
                        if (!isFinishing()) recreate();
                    }
                });
            }
        }, "theme-photo").start();
    }
}
