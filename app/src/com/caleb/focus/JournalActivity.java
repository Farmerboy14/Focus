package com.caleb.focus;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Prayer journal, locked behind face, fingerprint or the phone PIN, and encrypted on the phone. */
public class JournalActivity extends Activity {
    private FrameLayout root;
    private LinearLayout locked, open;
    private DialView dial;
    private LinearLayout entriesBox;
    private EditText entry;
    private String kind = "Request";
    private final TextView[] kindChips = new TextView[3];
    private JSONArray entries = new JSONArray();
    private boolean unlocked;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        SkyView sky = new SkyView(this, true);
        sky.setVeil(0.3f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        buildLocked();
        buildOpen();
        setContentView(root);
    }

    private void buildLocked() {
        locked = Ui.column(this);
        locked.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(locked, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, locked, Ui.dp(this, 20), Ui.dp(this, 8), Ui.dp(this, 20));
        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        top.addView(Ui.space(this));
        locked.addView(top, Ui.lp(Ui.MATCH, Ui.WRAP));
        locked.addView(Ui.space(this));
        FrameLayout df = new FrameLayout(this);
        int size = Ui.dp(this, 230);
        dial = new DialView(this, true);
        dial.setConstellation(false);
        dial.setRemaining(0, false);
        df.addView(dial, new FrameLayout.LayoutParams(size, size));
        LockIcon li = new LockIcon(this);
        df.addView(li, new FrameLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40), Gravity.CENTER));
        locked.addView(df, new LinearLayout.LayoutParams(size, size));
        TextView t = Ui.text(this, "Prayer journal", 32, Ui.INK, Ui.NEWS_MED);
        locked.addView(t, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        TextView p = Ui.text(this, "Locked. Your entries stay encrypted on this phone.", 14, Ui.MUTED, Ui.SORA);
        p.setGravity(Gravity.CENTER);
        p.setMaxWidth(Ui.dp(this, 260));
        p.setLineSpacing(0, 1.3f);
        locked.addView(p, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 10)));
        TextView unlock = Ui.goldButton(this, "Unlock with face or fingerprint");
        unlock.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { authenticate(); } });
        locked.addView(unlock, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 30)));
        TextView pin = Ui.plain(this, "Use PIN instead", 0xFFC9C5BA);
        pin.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { authenticate(); } });
        locked.addView(pin, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));
        locked.addView(Ui.space(this));
        locked.addView(Ui.space(this));
    }

    static class LockIcon extends View {
        private final android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        LockIcon(android.content.Context c) {
            super(c);
            p.setStyle(android.graphics.Paint.Style.STROKE);
            p.setColor(Ui.GOLD);
            p.setStrokeCap(android.graphics.Paint.Cap.ROUND);
            p.setStrokeJoin(android.graphics.Paint.Join.ROUND);
        }
        @Override protected void onDraw(android.graphics.Canvas c) {
            float s = getWidth() / 24f;
            p.setStrokeWidth(1.6f * s);
            c.drawRoundRect(new android.graphics.RectF(4 * s, 11 * s, 20 * s, 21 * s), 2 * s, 2 * s, p);
            android.graphics.Path path = new android.graphics.Path();
            path.moveTo(8 * s, 11 * s);
            path.lineTo(8 * s, 7 * s);
            path.arcTo(new android.graphics.RectF(8 * s, 3 * s, 16 * s, 11 * s), 180, 180);
            path.lineTo(16 * s, 11 * s);
            c.drawPath(path, p);
        }
    }

    private void buildOpen() {
        open = Ui.column(this);
        open.setVisibility(View.GONE);
        root.addView(open, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, open, Ui.dp(this, 20), Ui.dp(this, 8), Ui.dp(this, 8));
        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        top.addView(Ui.space(this));
        TextView lockBtn = Ui.pill(this, "Lock");
        lockBtn.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { relock(); } });
        top.addView(lockBtn);
        open.addView(top, Ui.lp(Ui.MATCH, Ui.WRAP));

        ScrollView sc = new ScrollView(this);
        sc.setVerticalScrollBarEnabled(false);
        LinearLayout inner = Ui.column(this);
        inner.setPadding(0, Ui.dp(this, 16), 0, Ui.dp(this, 30));
        inner.addView(Ui.text(this, "Prayer journal", 32, Ui.INK, Ui.NEWS_MED));

        LinearLayout card = Ui.column(this);
        card.setBackground(new Ui.StoneDrawable(this, 0x99060910, 0x29F2D38A, 20));
        card.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
        Bible.Ref v = Bible.verseOfDay(System.currentTimeMillis());
        TextView today = Ui.mono(this, "Today · " + v.label(), 11, Ui.GOLD_DEEP);
        today.setLetterSpacing(0.12f);
        card.addView(today);
        entry = new EditText(this);
        entry.setHint("Write what's on your heart…");
        entry.setHintTextColor(Ui.QUIET);
        entry.setTextColor(Ui.INK);
        entry.setTypeface(Ui.NEWS);
        entry.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        entry.setBackground(null);
        entry.setMinLines(2);
        entry.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 8));
        card.addView(entry, Ui.lp(Ui.MATCH, Ui.WRAP));
        LinearLayout kinds = Ui.row(this);
        String[] ks = {"Request", "Thanks", "Confession"};
        for (int i = 0; i < 3; i++) {
            final String k = ks[i];
            TextView c = Ui.chip(this, k, true);
            c.setMinHeight(Ui.dp(this, 34));
            c.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View vv) { kind = k; paintKinds(); } });
            kindChips[i] = c;
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
            if (i > 0) lp.leftMargin = Ui.dp(this, 8);
            kinds.addView(c, lp);
        }
        card.addView(kinds, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 4)));
        TextView save = Ui.goldButton(this, "Save prayer");
        save.setMinHeight(Ui.dp(this, 46));
        save.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View vv) { saveEntry(); } });
        card.addView(save, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 12)));
        inner.addView(card, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));
        paintKinds();

        inner.addView(Ui.label(this, "Earlier"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        entriesBox = Ui.column(this);
        inner.addView(entriesBox, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 4)));
        sc.addView(inner);
        open.addView(sc, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
    }

    private void paintKinds() {
        for (TextView c : kindChips) {
            boolean on = c.getText().toString().equals(kind);
            c.setTextColor(on ? Ui.GOLD : 0xFFC9C5BA);
            c.setBackground(new Ui.StoneDrawable(this, on ? 0x1AF2D38A : Ui.STONE, on ? 0x66F2D38A : 0x0FFFFFFF, 999));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!unlocked && !autoTried) {
            autoTried = true;
            root.postDelayed(new Runnable() { @Override public void run() { if (!unlocked && !isFinishing()) authenticate(); } }, 450);
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        autoTried = false;
        if (unlocked && !isChangingConfigurations()) relockQuietly();
    }

    private boolean authing, autoTried;

    private void authenticate() {
        if (authing || unlocked) return;
        try {
            BiometricManager bm = (BiometricManager) getSystemService(BIOMETRIC_SERVICE);
            int auths = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
            if (bm != null && bm.canAuthenticate(auths) != BiometricManager.BIOMETRIC_SUCCESS) {
                auths = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
            }
            if (bm != null && bm.canAuthenticate(auths) != BiometricManager.BIOMETRIC_SUCCESS) {
                // No lock set on this phone: open anyway, but say so.
                android.widget.Toast.makeText(this, "Set a screen lock in Settings to protect your journal.", android.widget.Toast.LENGTH_LONG).show();
                onUnlocked();
                return;
            }
            BiometricPrompt bp = new BiometricPrompt.Builder(this)
                    .setTitle("Prayer journal")
                    .setSubtitle("Unlock to read and write")
                    .setAllowedAuthenticators(auths)
                    .build();
            authing = true;
            Executor ex = getMainExecutor();
            bp.authenticate(new CancellationSignal(), ex, new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) { authing = false; onUnlocked(); }
                @Override public void onAuthenticationError(int code, CharSequence msg) { authing = false; }
                @Override public void onAuthenticationFailed() { }
            });
        } catch (Throwable t) {
            authing = false;
        }
    }

    private void onUnlocked() {
        unlocked = true;
        Ui.vibrate(this);
        dial.setRemaining(1f, true);
        root.postDelayed(new Runnable() {
            @Override public void run() {
                if (!unlocked || isFinishing()) return;
                load();
                renderEntries();
                locked.animate().alpha(0f).setDuration(260).withEndAction(new Runnable() {
                    @Override public void run() { locked.setVisibility(View.GONE); }
                }).start();
                open.setVisibility(View.VISIBLE);
                open.setAlpha(1f);
                Ui.stagger(open.getChildAt(0), open.getChildAt(1));
            }
        }, 900);
    }

    private void relock() {
        relockQuietly();
        locked.setVisibility(View.VISIBLE);
        locked.setAlpha(0f);
        locked.animate().alpha(1f).setDuration(400).start();
    }

    private void relockQuietly() {
        unlocked = false;
        entries = new JSONArray();
        if (entriesBox != null) entriesBox.removeAllViews();
        open.setVisibility(View.GONE);
        locked.setVisibility(View.VISIBLE);
        locked.setAlpha(1f);
        dial.setRemaining(0, false);
    }

    // ---------- entries ----------

    private boolean loadFailed;

    private void saveEntry() {
        if (loadFailed) {
            android.widget.Toast.makeText(this, "The journal couldn't be opened, so nothing was saved. Your old entries are untouched.", android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        String t = entry.getText().toString().trim();
        if (t.isEmpty()) return;
        try {
            JSONObject e = new JSONObject();
            e.put("t", System.currentTimeMillis());
            e.put("kind", kind);
            e.put("text", t);
            e.put("answered", 0);
            JSONArray n = new JSONArray();
            n.put(e);
            for (int i = 0; i < entries.length(); i++) n.put(entries.get(i));
            entries = n;
            store();
            entry.setText("");
            Ui.vibrate(this);
            renderEntries();
        } catch (Exception ignored) { }
    }

    private void renderEntries() {
        entriesBox.removeAllViews();
        if (entries.length() == 0) {
            TextView empty = Ui.text(this, "Your prayers will show up here. Mark them answered when God answers.", 14, Ui.MUTED, Ui.SORA);
            empty.setLineSpacing(0, 1.3f);
            entriesBox.addView(empty, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 10)));
            return;
        }
        SimpleDateFormat f = new SimpleDateFormat("MMM d", Locale.US);
        for (int i = 0; i < entries.length(); i++) {
            final JSONObject e = entries.optJSONObject(i);
            if (e == null) continue;
            final int idx = i;
            long ans = e.optLong("answered", 0);
            LinearLayout row = Ui.row(this);
            row.setGravity(Gravity.TOP);
            row.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
            View mark = new View(this);
            android.graphics.drawable.GradientDrawable gd = new android.graphics.drawable.GradientDrawable();
            gd.setShape(android.graphics.drawable.GradientDrawable.OVAL);
            String k = e.optString("kind");
            if (ans > 0) gd.setColor(Ui.GOLD_LIGHT);
            else if ("Thanks".equals(k)) gd.setColor(0x73F2D38A);
            else { gd.setColor(0); gd.setStroke(Ui.dp(this, 1.5f), 0x80F2D38A); }
            mark.setBackground(gd);
            LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(Ui.dp(this, 10), Ui.dp(this, 10));
            mp.topMargin = Ui.dp(this, 6);
            mp.rightMargin = Ui.dp(this, 14);
            row.addView(mark, mp);
            LinearLayout txt = Ui.column(this);
            TextView body = Ui.text(this, e.optString("text"), 17, Ui.INK, Ui.NEWS);
            body.setLineSpacing(0, 1.2f);
            txt.addView(body);
            String meta = (k + " · " + f.format(new Date(e.optLong("t")))).toUpperCase(Locale.US);
            if (ans > 0) meta += " · ANSWERED " + f.format(new Date(ans)).toUpperCase(Locale.US);
            txt.addView(Ui.text(this, meta, 11, ans > 0 ? Ui.GOLD : Ui.QUIET, Ui.MONO), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 5)));
            row.addView(txt, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
            row.setClickable(true);
            row.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { entryMenu(idx); }
            });
            entriesBox.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP));
            View ln = new View(this);
            ln.setBackgroundColor(0x0FFFFFFF);
            entriesBox.addView(ln, Ui.lp(Ui.MATCH, Math.max(1, Ui.dp(this, 1))));
        }
    }

    private void entryMenu(final int idx) {
        final JSONObject e = entries.optJSONObject(idx);
        if (e == null) return;
        boolean ans = e.optLong("answered", 0) > 0;
        String[] items = {ans ? "Mark as not answered yet" : "Mark answered", "Delete"};
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setItems(items, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        try {
                            if (which == 0) {
                                e.put("answered", e.optLong("answered", 0) > 0 ? 0 : System.currentTimeMillis());
                            } else {
                                JSONArray n = new JSONArray();
                                for (int i = 0; i < entries.length(); i++) if (i != idx) n.put(entries.get(i));
                                entries = n;
                            }
                            store();
                            renderEntries();
                        } catch (Exception ignored) { }
                    }
                }).show();
    }

    // ---------- encryption ----------

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias("journal")) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder("journal", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
            kg.generateKey();
        }
        return (SecretKey) ks.getKey("journal", null);
    }

    private void store() {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = c.doFinal(entries.toString().getBytes(StandardCharsets.UTF_8));
            String v = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
            Store.get(this).prefs().edit().putString("journal", v).apply();
        } catch (Exception e) {
            android.widget.Toast.makeText(this, "Couldn't save: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
        }
    }

    private void load() {
        entries = new JSONArray();
        loadFailed = false;
        String v = Store.get(this).prefs().getString("journal", null);
        if (v == null) return;
        try {
            String[] parts = v.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            byte[] pt = c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            entries = new JSONArray(new String(pt, StandardCharsets.UTF_8));
        } catch (Exception e) {
            loadFailed = true;
            android.widget.Toast.makeText(this, "Couldn't open the journal.", android.widget.Toast.LENGTH_LONG).show();
        }
    }
}
