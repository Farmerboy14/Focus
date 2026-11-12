package com.caleb.focus;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

/**
 * The dial: sixty ticks that show how much of the block is left, an outer
 * 24-hour ring with a star for each block, and a bright star at the current time.
 */
public class DialView extends View {
    private static Bitmap starGold, starBlue;
    private final Paint tick = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotEdge = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint halo = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint img = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final RectF rf = new RectF();
    private boolean gold;
    private float remaining = 1f;   // fraction of ticks lit
    private float shown = 0f;       // animated sweep
    private float[] stars = new float[0]; // hours of day for constellation dots
    private float nowHour = -1;
    private boolean glint;
    private boolean constellation = true;
    private ValueAnimator sweep;
    private boolean visible = true;

    @Override
    protected void onWindowVisibilityChanged(int v) {
        super.onWindowVisibilityChanged(v);
        visible = v == VISIBLE;
        if (visible) invalidate();
    }

    public DialView(Context c, boolean gold) {
        super(c);
        this.gold = gold;
        if (starGold == null) starGold = BitmapFactory.decodeResource(c.getResources(), R.drawable.star_gold);
        if (starBlue == null) starBlue = BitmapFactory.decodeResource(c.getResources(), R.drawable.star_blue);
        tick.setStrokeCap(Paint.Cap.ROUND);
        ring.setStyle(Paint.Style.STROKE);
        dotFill.setColor(0xFF0B1020);
        dotEdge.setStyle(Paint.Style.STROKE);
        dotEdge.setColor(0x996E9BE0);
    }

    public void setGold(boolean g) { gold = g; invalidate(); }
    public void setGlint(boolean g) { glint = g; invalidate(); }
    public void setConstellation(boolean c) { constellation = c; invalidate(); }

    public void setStars(float[] hours, float now) { stars = hours; nowHour = now; invalidate(); }

    /** Set the lit fraction; animate=true sweeps the ticks on one by one. */
    public void setRemaining(float frac, boolean animate) {
        remaining = Math.max(0, Math.min(1, frac));
        if (sweep != null) sweep.cancel();
        if (!animate) { shown = remaining; invalidate(); return; }
        sweep = ValueAnimator.ofFloat(0, remaining);
        sweep.setDuration(1000);
        sweep.setStartDelay(160);
        sweep.setInterpolator(new DecelerateInterpolator(1.6f));
        sweep.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override public void onAnimationUpdate(ValueAnimator a) { shown = (Float) a.getAnimatedValue(); invalidate(); }
        });
        shown = 0;
        sweep.start();
    }

    @Override
    protected void onMeasure(int wSpec, int hSpec) {
        int w = MeasureSpec.getSize(wSpec);
        setMeasuredDimension(w, w);
    }

    @Override
    protected void onDraw(Canvas c) {
        float size = getWidth();
        float k = size / 300f;
        float cx = size / 2f, cy = size / 2f;
        int lit = gold ? 0xFFF2D38A : Ui.ice(0xFF);
        int dim = gold ? 0x24F2D38A : Ui.ice(0x24);
        int bigDim = gold ? 0x66F2D38A : Ui.ice(0x40);

        if (constellation) {
            ring.setColor(0x0FFFFFFF);
            ring.setStrokeWidth(2 * k);
            c.drawCircle(cx, cy, 136 * k, ring);
            dotEdge.setStrokeWidth(1.5f * k);
            for (float hr : stars) {
                double a = hr / 24.0 * Math.PI * 2 - Math.PI / 2;
                float x = cx + (float) (136 * k * Math.cos(a)), y = cy + (float) (136 * k * Math.sin(a));
                c.drawCircle(x, y, 3 * k, dotFill);
                c.drawCircle(x, y, 3 * k, dotEdge);
            }
            if (nowHour >= 0) {
                double a = nowHour / 24.0 * Math.PI * 2 - Math.PI / 2;
                float x = cx + (float) (136 * k * Math.cos(a)), y = cy + (float) (136 * k * Math.sin(a));
                Bitmap b = gold ? starGold : starBlue;
                float s = (gold ? 96 : 84) * k;
                long t = SystemClock.uptimeMillis();
                float br = 1f + 0.08f * (float) Math.sin(t / 10000.0 * Math.PI * 2);
                s *= br;
                rf.set(x - s / 2, y - s / 2, x + s / 2, y + s / 2);
                if (b != null) c.drawBitmap(b, null, rf, img);
            }
        }
        ring.setColor(gold ? 0x12F2D38A : Ui.ice(0x12));
        ring.setStrokeWidth(1 * k);
        c.drawCircle(cx, cy, 117 * k, ring);

        int litCount = Math.round(shown * 60);
        long t = SystemClock.uptimeMillis();
        float glintPos = glint ? ((t % 7000) / 7000f) * 60f * 1.6f - 6 : -100;
        for (int i = 0; i < 60; i++) {
            double a = -Math.PI / 2 + i / 60.0 * Math.PI * 2;
            boolean big = i % 5 == 0;
            float r1 = (big ? 94 : 97) * k, r2 = 112 * k;
            boolean on = i < litCount;
            int col = on ? lit : (big ? bigDim : dim);
            if (on && glint) {
                float dist = Math.abs(i - glintPos);
                if (dist < 3) col = blend(0xFFFFF4D6, lit, dist / 3f);
            }
            tick.setColor(col);
            tick.setStrokeWidth((big ? 3 : 2) * k);
            float cos = (float) Math.cos(a), sin = (float) Math.sin(a);
            c.drawLine(cx + r1 * cos, cy + r1 * sin, cx + r2 * cos, cy + r2 * sin, tick);
        }
        if (litCount > 0 && litCount < 60) {
            double a = -Math.PI / 2 + (litCount / 60.0) * Math.PI * 2;
            float x = cx + (float) (104 * k * Math.cos(a)), y = cy + (float) (104 * k * Math.sin(a));
            halo.setColor(gold ? 0x40F7E2AE : Ui.iceSoft(0x38));
            c.drawCircle(x, y, 8 * k, halo);
            halo.setColor(gold ? 0xFFFFF8E6 : 0xFFF3F8FF);
            c.drawCircle(x, y, 3 * k, halo);
        }
        if ((glint || (constellation && nowHour >= 0)) && visible && isShown()) postInvalidateDelayed(glint ? 50 : 200);
    }

    private static int blend(int a, int b, float f) {
        int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        int br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        return 0xFF000000 | ((int) (ar + (br - ar) * f) << 16) | ((int) (ag + (bg - ag) * f) << 8) | (int) (ab + (bb - ab) * f);
    }
}
