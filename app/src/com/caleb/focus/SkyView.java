package com.caleb.focus;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.View;

/**
 * The rendered sky, slowly drifting, with a few twinkling specks of dust.
 * In the fall theme: your photo instead, drifting the same way, shaded so text stays readable, with leaves falling.
 */
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
    private boolean fall, dawnNow;
    private Bitmap photo;
    private final Paint scrim = new Paint(), leaf = new Paint(Paint.ANTI_ALIAS_FLAG), warm = new Paint();
    private final android.graphics.Path leafPath = new android.graphics.Path();
    private int scrimH = -1;
    private static final int LEAVES = 14;
    private final float[] lx = new float[LEAVES], lsp = new float[LEAVES], lsw = new float[LEAVES], lph = new float[LEAVES], lsz = new float[LEAVES], lrot = new float[LEAVES];
    private final int[] lcol = new int[LEAVES];

    public SkyView(Context c, boolean isDawn) {
        super(c);
        if (night == null) night = BitmapFactory.decodeResource(c.getResources(), R.drawable.sky_night);
        if (dawn == null) dawn = BitmapFactory.decodeResource(c.getResources(), R.drawable.sky_dawn);
        sky = isDawn ? dawn : night;
        dawnNow = isDawn;
        fall = Theme.fall(c);
        if (fall) photo = Theme.photo(c);
        // a leaf: two curves meeting at the tips, unit length along x
        leafPath.moveTo(-0.5f, 0f);
        leafPath.cubicTo(-0.2f, -0.32f, 0.2f, -0.30f, 0.5f, 0f);
        leafPath.cubicTo(0.2f, 0.30f, -0.2f, 0.32f, -0.5f, 0f);
        leafPath.close();
        int[] cols = {0xFFD9822B, 0xFFB5491E, 0xFFE8B04A, 0xFF8C4A22, 0xFFC86A2C};
        long ls = 29;
        for (int i = 0; i < LEAVES; i++) {
            ls = (ls * 16807) % 2147483647; lx[i] = ls / 2147483647f;
            ls = (ls * 16807) % 2147483647; lsp[i] = 0.018f + 0.022f * ls / 2147483647f;       // screen heights per second
            ls = (ls * 16807) % 2147483647; lsw[i] = 0.02f + 0.04f * ls / 2147483647f;
            ls = (ls * 16807) % 2147483647; lph[i] = (float) (Math.PI * 2 * ls / 2147483647f);
            ls = (ls * 16807) % 2147483647; lsz[i] = 7f + 9f * ls / 2147483647f;
            ls = (ls * 16807) % 2147483647; lrot[i] = 20f + 50f * ls / 2147483647f;
            lcol[i] = cols[i % cols.length];
        }
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

    public void setDawn(boolean d) { sky = d ? dawn : night; dawnNow = d; invalidate(); }

    private boolean fallNow() { return fall && !dawnNow; }

    private void drawFall(Canvas c, int w, int hgt) {
        long t = SystemClock.uptimeMillis();
        if (photo != null) {
            float bw = photo.getWidth(), bh = photo.getHeight();
            float scale = Math.max(w / bw, hgt / bh) * 1.05f;
            float vw = w / scale, vh = hgt / scale;
            float drift = (float) Math.sin(t / 90000.0 * Math.PI * 2) * 0.5f + 0.5f;
            float ox = (bw - vw) * (0.35f + 0.3f * drift), oy = (bh - vh) * 0.5f;
            src.set((int) ox, (int) oy, (int) (ox + vw), (int) (oy + vh));
            dst.set(0, 0, w, hgt);
            c.drawBitmap(photo, src, dst, img);
        } else {
            if (warm.getShader() == null || scrimH != hgt)
                warm.setShader(new android.graphics.LinearGradient(0, 0, 0, hgt, 0xFF3A1E0E, 0xFF120A06, android.graphics.Shader.TileMode.CLAMP));
            c.drawRect(0, 0, w, hgt, warm);
        }
        // darker at the top (the clock) and the bottom (the apps), lighter through the middle
        if (scrimH != hgt) {
            scrimH = hgt;
            scrim.setShader(new android.graphics.LinearGradient(0, 0, 0, hgt,
                    new int[]{0xB80B0705, 0x660B0705, 0x4D0B0705, 0x990B0705, 0xD90B0705},
                    new float[]{0f, 0.3f, 0.5f, 0.75f, 1f}, android.graphics.Shader.TileMode.CLAMP));
        }
        c.drawRect(0, 0, w, hgt, scrim);
        float d = getResources().getDisplayMetrics().density, secs = t / 1000f;
        for (int i = 0; i < LEAVES; i++) {
            float size = lsz[i] * d;
            float span = hgt + size * 4;
            float y = ((secs * lsp[i] * hgt + lx[i] * span * 7.3f) % span) - size * 2;
            float x = (lx[i] + (float) Math.sin(secs * 0.7f + lph[i]) * lsw[i]) * w;
            c.save();
            c.translate(x, y);
            c.rotate((float) Math.sin(secs * 0.5f + lph[i]) * lrot[i] + i * 37);
            c.scale(size, size * (0.75f + 0.25f * (float) Math.cos(secs * 1.3f + lph[i])));   // a little tumble
            leaf.setColor(lcol[i]);
            leaf.setAlpha(170);
            c.drawPath(leafPath, leaf);
            c.restore();
        }
    }

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
        if (fallNow() && w > 0 && hgt > 0) {
            drawFall(c, w, hgt);
            if (veilAlpha > 0) { veil.setAlpha((int) (255 * veilAlpha)); c.drawRect(0, 0, w, hgt, veil); }
            if (running && isShown()) postInvalidateDelayed(45);
            return;
        }
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
