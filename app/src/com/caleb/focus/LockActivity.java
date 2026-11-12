package com.caleb.focus;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Focus's lock screen. It sits on top of Android's own lock: the time, the block you're in,
 * what's next and today's verse. Swipe up and Android asks for your face, fingerprint or PIN as usual.
 */
public class LockActivity extends Activity {
    private final Handler h = new Handler(Looper.getMainLooper());
    private SkyView sky;
    private LinearLayout content;
    private TextView clock, date, blockTitle, blockLeft, next, verse, ref, hint, note;
    private DialView dial;
    private float downY;
    private boolean dragging;

    private final Runnable tick = new Runnable() {
        @Override public void run() { render(); h.postDelayed(this, 15_000); }
    };

    public static boolean enabled(Context c) {
        return Store.get(c).prefs().getBoolean("lockScreen", true);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        setShowWhenLocked(true);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        sky = new SkyView(this, false);
        sky.setVeil(0.2f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));

        content = Ui.column(this);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(content, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, content, Ui.dp(this, 24), Ui.dp(this, 36), Ui.dp(this, 20));

        date = Ui.mono(this, "", 12, 0xFFB4B7BE);
        date.setLetterSpacing(0.14f);
        content.addView(date, Ui.lp(Ui.WRAP, Ui.WRAP));
        clock = Ui.text(this, "", 92, Ui.INK, Ui.SORA_LIGHT);
        clock.setLetterSpacing(-0.04f);
        clock.setFontFeatureSettings("tnum");
        clock.setGravity(Gravity.CENTER);
        content.addView(clock, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 10)));

        // the block you're in
        LinearLayout card = Ui.row(this);
        card.setBackground(new Ui.StoneDrawable(this, Ui.STONE, Ui.ice(0x1F), 22));
        card.setPadding(Ui.dp(this, 14), Ui.dp(this, 14), Ui.dp(this, 18), Ui.dp(this, 14));
        dial = new DialView(this, false);
        dial.setConstellation(false);
        card.addView(dial, new LinearLayout.LayoutParams(Ui.dp(this, 84), Ui.dp(this, 84)));
        LinearLayout info = Ui.column(this);
        info.setPadding(Ui.dp(this, 14), 0, 0, 0);
        blockTitle = Ui.text(this, "", 19, Ui.INK, Ui.SORA_MED);
        blockLeft = Ui.mono(this, "", 11, Ui.MUTED);
        next = Ui.text(this, "", 13, Ui.MUTED, Ui.SORA);
        note = Ui.text(this, "", 13, 0xFFC9CCD2, Ui.SORA);
        note.setMaxLines(3);
        note.setLineSpacing(0, 1.25f);
        info.addView(blockTitle);
        info.addView(note, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        info.addView(blockLeft, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 8)));
        info.addView(next, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 8)));
        card.addView(info, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        content.addView(card, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 34)));

        content.addView(Ui.space(this));

        verse = Ui.text(this, "", 18, 0xFFF4F2EC, Ui.NEWS_IT);
        verse.setGravity(Gravity.CENTER);
        verse.setLineSpacing(0, 1.2f);
        content.addView(verse, Ui.lp(Ui.MATCH, Ui.WRAP));
        ref = Ui.mono(this, "", 10, Ui.MUTED);
        ref.setGravity(Gravity.CENTER);
        content.addView(ref, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        TextView chevron = Ui.text(this, "︿", 20, 0x99EEF0F3, Ui.SORA);
        chevron.setGravity(Gravity.CENTER);
        content.addView(chevron, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 34)));
        hint = Ui.mono(this, "Swipe up to unlock", 11, 0xFF8E9198);
        hint.setGravity(Gravity.CENTER);
        hint.setLetterSpacing(0.14f);
        content.addView(hint, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 2)));
        chevron.animate().translationY(-Ui.dpf(this, 6)).setDuration(1200).setInterpolator(new DecelerateInterpolator()).withEndAction(new Bob(chevron)).start();

        root.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View v, MotionEvent e) { return drag(e); }
        });
        setContentView(root);
    }

    /** The little arrow drifts up and back to hint at the swipe. */
    private class Bob implements Runnable {
        private final View v;
        private boolean up = true;
        Bob(View v) { this.v = v; }
        @Override public void run() {
            if (isFinishing()) return;
            up = !up;
            v.animate().translationY(up ? -Ui.dpf(LockActivity.this, 6) : 0).setDuration(1200)
                    .setInterpolator(new DecelerateInterpolator()).withEndAction(this).start();
        }
    }

    private boolean drag(MotionEvent e) {
        float th = Ui.dpf(this, 140);
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downY = e.getRawY();
                dragging = true;
                content.animate().cancel();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!dragging) return false;
                float dy = Math.max(0, downY - e.getRawY());
                content.setTranslationY(-dy * 0.55f);
                content.setAlpha(Math.max(0.15f, 1f - dy / (th * 2.2f)));
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                float d = downY - e.getRawY();
                if (d > th) unlock();
                else springBack();
                return true;
        }
        return false;
    }

    private void springBack() {
        content.animate().translationY(0).alpha(1f).setDuration(420).setInterpolator(new OvershootInterpolator(1.4f)).start();
    }

    private void unlock() {
        content.animate().translationY(-Ui.dpf(this, 120)).alpha(0f).setDuration(220).start();
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (km == null || !km.isKeyguardLocked()) {
            leave();
            return;
        }
        km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
            @Override public void onDismissSucceeded() { leave(); }
            @Override public void onDismissCancelled() { springBack(); }
            @Override public void onDismissError() { leave(); }
        });
    }

    private void leave() {
        finish();
        overridePendingTransition(0, R.anim.fade_out);
    }

    @Override
    public void onBackPressed() { /* stay put; swipe up to unlock */ }

    @Override
    protected void onResume() {
        super.onResume();
        content.setTranslationY(0);
        content.setAlpha(1f);
        render();
        h.removeCallbacks(tick);
        h.postDelayed(tick, 15_000);
    }

    @Override
    protected void onPause() {
        h.removeCallbacks(tick);
        super.onPause();
    }

    private void render() {
        try {
            long now = System.currentTimeMillis();
            Store s = Store.get(this);
            Store.Slot cur = s.current(now);
            boolean god = "god".equals(cur.preset);
            sky.setDawn(god);
            dial.setGold(god);
            date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.US).format(new Date(now)).toUpperCase(Locale.US));
            clock.setText(new SimpleDateFormat("h:mm", Locale.US).format(new Date(now)));
            long left = cur.minutesLeft(now), len = cur.lengthMin();
            dial.setRemaining(left / (float) len, false);
            blockTitle.setText(cur.index < 0 ? "Open time" : cur.title);
            blockTitle.setTextColor(god ? Ui.GOLD : Ui.INK);
            note.setText(cur.note);
            note.setVisibility(cur.note == null || cur.note.isEmpty() ? View.GONE : View.VISIBLE);
            blockLeft.setText((Ui.hm(left) + " left · until " + Ui.clock(cur.end)).toUpperCase(Locale.US));
            List<Store.Slot> up = s.upcoming(now, 1);
            next.setText(up.isEmpty() ? s.presetName(cur.preset) : "Next: " + up.get(0).title + " at " + Ui.clock(up.get(0).start));
            Bible.load(this, new Runnable() {
                @Override public void run() {
                    Bible.Ref r = Bible.verseOfDay(System.currentTimeMillis());
                    verse.setText("“" + r.text + "”");
                    ref.setText(r.label().toUpperCase(Locale.US) + " · KJV");
                }
            });
        } catch (Throwable ignored) { }
    }
}
