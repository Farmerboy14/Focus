package com.caleb.focus;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.View;

/** The rendered sky, slowly drifting, with a few twinkling specks of dust. */
public class SkyView extends View {
    private static Bitmap night, dawn;
    private Bitmap sky;
    private final Paint img = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint veil = new Paint();
    private final float[] dx = new float[16], dy = new float[16], ds = new float[16], dop = new float[16], dper = new float[16], dph = new float[16];
    private final Rect src = new Rect(), dst = new Rect();
    private float veilAlpha;
    private boolean running;

    public SkyView(Context c, boolean isDawn) {
        super(c);
        if (night == null) night = BitmapFactory.decodeResource(c.getResources(), R.drawable.sky_night);
        if (dawn == null) dawn = BitmapFactory.decodeResource(c.getResources(), R.drawable.sky_dawn);
        sky = isDawn ? dawn : night;
        dot.setColor(0xFFF2F4FF);
        veil.setColor(0xFF05070C);
        long seed = 13;
        for (int i = 0; i < 16; i++) {
            seed = (seed * 16807) % 2147483647; dx[i] = seed / 2147483647f;
            seed = (seed * 16807) % 2147483647; dy[i] = seed / 2147483647f;
            seed = (seed * 16807) % 2147483647; ds[i] = 1f + 1.4f * seed / 2147483647f;
            seed = (seed * 16807) % 2147483647; dop[i] = 0.12f + 0.35f * seed / 2147483647f;
            dper[i] = 3000 + (i % 4) * 1000;
            dph[i] = i * 500;
        }
    }

    public void setDawn(boolean d) { sky = d ? dawn : night; invalidate(); }

    /** 0..1 darkening over the sky. */
    public void setVeil(float a) { veilAlpha = a; invalidate(); }

    @Override
    protected void onAttachedToWindow() { super.onAttachedToWindow(); running = true; invalidate(); }

    @Override
    protected void onWindowVisibilityChanged(int v) {
        super.onWindowVisibilityChanged(v);
        running = v == VISIBLE;
        if (running) invalidate();
    }

    @Override
    protected void onDetachedFromWindow() { running = false; super.onDetachedFromWindow(); }

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth(), hgt = getHeight();
        if (sky != null && w > 0 && hgt > 0) {
            float bw = sky.getWidth(), bh = sky.getHeight();
            float scale = Math.max(w / bw, hgt / bh) * 1.06f;
            float vw = w / scale, vh = hgt / scale;
            long t = SystemClock.uptimeMillis();
            // a very slow drift, like the sky moving
            float drift = (float) Math.sin(t / 60000.0 * Math.PI * 2) * 0.5f + 0.5f;
            float ox = (bw - vw) * (0.3f + 0.4f * drift), oy = (bh - vh) * (0.6f - 0.3f * drift);
            src.set((int) ox, (int) oy, (int) (ox + vw), (int) (oy + vh));
            dst.set(0, 0, w, hgt);
            c.drawBitmap(sky, src, dst, img);
        } else {
            c.drawColor(Ui.BG);
        }
        long t = SystemClock.uptimeMillis();
        float d = getResources().getDisplayMetrics().density;
        for (int i = 0; i < 16; i++) {
            double ph = ((t + dph[i]) % (long) dper[i]) / dper[i];
            float o = dop[i] * (0.25f + 0.75f * (float) (0.5 + 0.5 * Math.cos(ph * Math.PI * 2)));
            dot.setAlpha((int) (255 * o));
            c.drawCircle(dx[i] * w, dy[i] * hgt, ds[i] * d / 2f, dot);
        }
        if (veilAlpha > 0) {
            veil.setAlpha((int) (255 * veilAlpha));
            c.drawRect(0, 0, w, hgt, veil);
        }
        if (running && isShown()) postInvalidateDelayed(90);
    }
}
