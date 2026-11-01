package com.caleb.focus;

import android.animation.Animator;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** "Put the phone down": the screen dims and one star breathes. Tap anywhere to wake. */
public class RestActivity extends Activity {
    private final java.util.List<Animator> anims = new java.util.ArrayList<>();

    static class Ring extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        Ring(Context c) {
            super(c);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(Ui.dpf(c, 1));
            p.setColor(0x59F2D38A);
        }
        @Override protected void onDraw(Canvas c) {
            c.drawCircle(getWidth() / 2f, getHeight() / 2f, getWidth() / 2f - 2, p);
        }
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = 0.06f;
        getWindow().setAttributes(lp);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        SkyView sky = new SkyView(this, true);
        sky.setVeil(0.6f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));

        LinearLayout col = Ui.column(this);
        col.setGravity(Gravity.CENTER);
        root.addView(col, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, col, 0, 0, 0);

        FrameLayout starBox = new FrameLayout(this);
        int box = Ui.dp(this, 170);
        Ring ring = new Ring(this);
        int rs = Ui.dp(this, 150);
        starBox.addView(ring, new FrameLayout.LayoutParams(rs, rs, Gravity.CENTER));
        ImageView star = new ImageView(this);
        star.setImageResource(R.drawable.star_gold);
        starBox.addView(star, new FrameLayout.LayoutParams(Ui.dp(this, 124), Ui.dp(this, 124), Gravity.CENTER));
        col.addView(starBox, new LinearLayout.LayoutParams(box, box));

        Store s = Store.get(this);
        long now = System.currentTimeMillis();
        Store.Slot cur = s.current(now);
        TextView time = Ui.text(this, Ui.hm(cur.minutesLeft(now)), 40, 0xFFC9C5BA, Ui.SORA_LIGHT);
        time.setLetterSpacing(-0.04f);
        col.addView(time, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 14)));
        TextView still = Ui.text(this, "Be still.", 18, Ui.QUIET, Ui.NEWS_IT);
        col.addView(still, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        FrameLayout breath = new FrameLayout(this);
        TextView in = Ui.mono(this, "Breathe in", 11, Ui.QUIET);
        in.setLetterSpacing(0.16f);
        TextView out = Ui.mono(this, "Breathe out", 11, Ui.QUIET);
        out.setLetterSpacing(0.16f);
        breath.addView(in, new FrameLayout.LayoutParams(Ui.WRAP, Ui.WRAP, Gravity.CENTER));
        breath.addView(out, new FrameLayout.LayoutParams(Ui.WRAP, Ui.WRAP, Gravity.CENTER));
        col.addView(breath, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        TextView wake = Ui.mono(this, "Tap to wake", 11, 0xFF5E5B55);
        col.addView(wake, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 70)));

        root.setClickable(true);
        root.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        setContentView(root);

        // The star gathers in, then everything breathes on a ten-second cycle.
        starBox.setScaleX(0.4f); starBox.setScaleY(0.4f); starBox.setAlpha(0f);
        starBox.animate().scaleX(1f).scaleY(1f).alpha(1f).setStartDelay(300).setDuration(1200)
                .setInterpolator(new android.view.animation.DecelerateInterpolator(2f)).start();
        View[] late = {time, still, breath, wake};
        for (int i = 0; i < late.length; i++) {
            late[i].setAlpha(0f);
            late[i].animate().alpha(1f).setStartDelay(900 + i * 140L).setDuration(900).start();
        }
        ObjectAnimator st = ObjectAnimator.ofPropertyValuesHolder(star,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.12f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.12f),
                PropertyValuesHolder.ofFloat(View.ROTATION, 0f, 8f));
        breathe(st);
        ObjectAnimator rg = ObjectAnimator.ofPropertyValuesHolder(ring,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 0.7f, 1.15f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.7f, 1.15f),
                PropertyValuesHolder.ofFloat(View.ALPHA, 0.2f, 0.75f));
        breathe(rg);
        ObjectAnimator inA = ObjectAnimator.ofFloat(in, View.ALPHA, 0f, 1f);
        breathe(inA);
        ObjectAnimator outA = ObjectAnimator.ofFloat(out, View.ALPHA, 1f, 0f);
        breathe(outA);
    }

    private void breathe(ObjectAnimator a) {
        a.setDuration(5000);
        a.setRepeatCount(ValueAnimator.INFINITE);
        a.setRepeatMode(ValueAnimator.REVERSE);
        a.setInterpolator(new AccelerateDecelerateInterpolator());
        a.start();
        anims.add(a);
    }

    @Override
    protected void onDestroy() {
        for (Animator a : anims) a.cancel();
        super.onDestroy();
    }
}
