package com.caleb.focus;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffColorFilter;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.BufferedInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * "Night lines": thin line icons for every app, drawn in Focus's own ice blue (gold during Time with God).
 * The lines come from Lawnicons (Apache 2.0), converted by tools/make-icons.py into assets/icons/lines.bin.
 * An app Lawnicons doesn't cover uses its own themed (monochrome) icon if it has one, else its first letter.
 */
public final class Icons {
    private Icons() { }

    /** One app's drawing, in the 192 x 192 units of the original icons. */
    static final class Glyph {
        final List<Path> paths = new ArrayList<>();
        final List<Float> widths = new ArrayList<>();   // 0 = filled
    }

    private static final Map<String, Glyph> glyphs = new HashMap<>();
    private static final Set<String> loadedFor = new HashSet<>();
    private static boolean loading;
    private static final List<Runnable> waiting = new ArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());

    public static boolean night(Context c) { return Store.get(c).prefs().getBoolean("iconNight", true); }
    public static void setNight(Context c, boolean on) { Store.get(c).prefs().edit().putBoolean("iconNight", on).apply(); }

    /** Loads the lines for every installed app in the background; then runs done on the main thread. */
    public static void load(Context ctx, final Runnable done) {
        final Context c = ctx.getApplicationContext();
        final Set<String> want = new HashSet<>();
        for (Apps.AppInfo a : Apps.launchable(c, false)) want.add(a.pkg);
        want.add("@ledger");
        synchronized (Icons.class) {
            if (loadedFor.containsAll(want)) { if (done != null) main.post(done); return; }
            if (done != null) waiting.add(done);
            if (loading) return;
            loading = true;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                Map<String, Glyph> got = new HashMap<>();
                try { got = read(c, want); } catch (Throwable ignored) { }
                final List<Runnable> run;
                synchronized (Icons.class) {
                    glyphs.putAll(got);
                    loadedFor.addAll(want);
                    loading = false;
                    run = new ArrayList<>(waiting);
                    waiting.clear();
                }
                main.post(new Runnable() { @Override public void run() { for (Runnable r : run) r.run(); } });
            }
        }, "icons").start();
    }

    private static Map<String, Glyph> read(Context c, Set<String> want) throws Exception {
        Map<Integer, List<String>> byIcon = new HashMap<>();
        BufferedReader br = new BufferedReader(new InputStreamReader(c.getAssets().open("icons/index.txt"), "UTF-8"));
        try {
            String line;
            while ((line = br.readLine()) != null) {
                int tab = line.indexOf('\t');
                if (tab < 0) continue;
                String pkg = line.substring(0, tab);
                if (!want.contains(pkg)) continue;
                int n = Integer.parseInt(line.substring(tab + 1));
                List<String> l = byIcon.get(n);
                if (l == null) { l = new ArrayList<>(); byIcon.put(n, l); }
                l.add(pkg);
            }
        } finally { br.close(); }
        Map<String, Glyph> out = new HashMap<>();
        if (byIcon.isEmpty()) return out;
        InputStream raw = c.getAssets().open("icons/lines.bin");
        DataInputStream in = new DataInputStream(new BufferedInputStream(raw, 65536));
        try {
            byte[] magic = new byte[4];
            in.readFully(magic);
            if (magic[0] != 'F' || magic[1] != 'L' || magic[2] != 'I' || magic[3] != '1') return out;
            int count = in.readInt();
            byte[] buf = new byte[65536];
            for (int i = 0; i < count; i++) {
                int len = in.readUnsignedShort();
                in.readFully(buf, 0, len);
                List<String> pk = byIcon.get(i);
                if (pk == null) continue;
                Glyph g = parse(buf, len);
                if (g != null) for (String p : pk) out.put(p, g);
            }
        } finally { in.close(); }
        return out;
    }

    private static int s16(byte[] b, int i) { return (short) (((b[i] & 0xFF) << 8) | (b[i + 1] & 0xFF)); }

    static Glyph parse(byte[] b, int len) {
        Glyph g = new Glyph();
        Path p = null;
        float w = 12f, cur = 12f;
        int i = 0;
        while (i < len) {
            char op = (char) b[i++];
            switch (op) {
                case 'W': w = s16(b, i) / 4f; i += 2; break;
                case 'S': case 'F':
                    p = new Path();
                    cur = op == 'F' ? 0f : w;
                    g.paths.add(p); g.widths.add(cur);
                    break;
                case 'M': if (p != null) p.moveTo(s16(b, i) / 4f, s16(b, i + 2) / 4f); i += 4; break;
                case 'L': if (p != null) p.lineTo(s16(b, i) / 4f, s16(b, i + 2) / 4f); i += 4; break;
                case 'C':
                    if (p != null) p.cubicTo(s16(b, i) / 4f, s16(b, i + 2) / 4f, s16(b, i + 4) / 4f, s16(b, i + 6) / 4f, s16(b, i + 8) / 4f, s16(b, i + 10) / 4f);
                    i += 12; break;
                case 'Z': if (p != null) p.close(); break;
                default: return g.paths.isEmpty() ? null : g;   // unknown op: keep what we have
            }
        }
        return g.paths.isEmpty() ? null : g;
    }

    static synchronized Glyph glyph(String pkg) { return glyphs.get(pkg); }

    /**
     * The icon for an app. Night lines: a line drawing on a dark stone disc (plate) or bare.
     * With night lines off, the app's own icon.
     */
    public static Drawable of(Context c, String pkg, String label, boolean plate, boolean gold) {
        boolean ledger = Apps.isLedger(c, pkg);
        if (!night(c)) return ledger ? new Picture(c, R.drawable.ledger_icon, 0xFFC4902F) : Apps.icon(c, pkg);
        // Till & Ledger: Focus's own line drawing of the register (tools/icons/ledger.svg)
        if (ledger) return new Night(c, "@ledger", label, plate, gold);
        return new Night(c, pkg, label, plate, gold);
    }

    /** A line icon. Draws whatever is best available at draw time, so it fills in once the pack has loaded. */
    public static final class Night extends Drawable {
        private final Context c;
        private final String pkg, letter;
        private final boolean plate, gold;
        private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint disc = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint rim = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Matrix m = new Matrix();
        private final Path scratch = new Path();
        private Drawable mono;
        private boolean monoTried;
        private int alpha = 255;

        Night(Context c, String pkg, String label, boolean plate, boolean gold) {
            this.c = c.getApplicationContext();
            this.pkg = pkg;
            this.plate = plate;
            this.gold = gold;
            String l = label == null ? "" : label.trim();
            letter = l.isEmpty() ? "·" : l.substring(0, 1).toUpperCase(Locale.US);
            line.setStyle(Paint.Style.STROKE);
            line.setStrokeCap(Paint.Cap.ROUND);
            line.setStrokeJoin(Paint.Join.ROUND);
            disc.setColor(0xD90B1019);
            rim.setStyle(Paint.Style.STROKE);
            rim.setColor(gold ? 0x40F2D38A : 0x2EAACFF6);
            text.setTypeface(Ui.SORA_LIGHT);
            text.setTextAlign(Paint.Align.CENTER);
        }

        private int ink() { return gold ? Ui.GOLD : Ui.ICE_SOFT; }

        @Override
        public void draw(Canvas canvas) {
            Rect b = getBounds();
            float size = Math.min(b.width(), b.height());
            if (size <= 0) return;
            float cx = b.exactCenterX(), cy = b.exactCenterY();
            int col = ink();
            if (plate) {
                disc.setAlpha(Math.round(0xD9 * alpha / 255f));
                canvas.drawCircle(cx, cy, size / 2f, disc);
                rim.setStrokeWidth(Math.max(1f, size / 64f));
                rim.setAlpha(Math.round(((gold ? 0x40 : 0x2E)) * alpha / 255f));
                canvas.drawCircle(cx, cy, size / 2f - rim.getStrokeWidth() / 2f, rim);
            }
            // the drawing fills about 56% of a plate, or 84% bare
            float art = size * (plate ? 0.56f : 0.84f);
            Glyph g = glyph(pkg);
            if (g != null) {
                float k = art / 192f;
                m.setScale(k, k);
                m.postTranslate(cx - art / 2f, cy - art / 2f);
                line.setColor(col);
                line.setAlpha(Math.round(Color.alpha(col) * alpha / 255f));
                for (int i = 0; i < g.paths.size(); i++) {
                    float w = g.widths.get(i);
                    scratch.reset();
                    g.paths.get(i).transform(m, scratch);
                    if (w <= 0) { line.setStyle(Paint.Style.FILL); }
                    else { line.setStyle(Paint.Style.STROKE); line.setStrokeWidth(Math.max(1f, w * k * 0.82f)); }
                    canvas.drawPath(scratch, line);
                }
                return;
            }
            Drawable mo = monochrome();
            if (mo != null) {
                // the monochrome layer is 108 units with the art in the middle 72; match the line icons' size
                float full = art * 108f / 72f * 0.92f;
                mo.setBounds(Math.round(cx - full / 2f), Math.round(cy - full / 2f), Math.round(cx + full / 2f), Math.round(cy + full / 2f));
                mo.setColorFilter(new PorterDuffColorFilter(col, PorterDuff.Mode.SRC_IN));
                mo.setAlpha(alpha);
                mo.draw(canvas);
                return;
            }
            text.setColor(col);
            text.setAlpha(Math.round(255 * alpha / 255f));
            text.setTextSize(art * 0.72f);
            Paint.FontMetrics fm = text.getFontMetrics();
            canvas.drawText(letter, cx, cy - (fm.ascent + fm.descent) / 2f, text);
        }

        private Drawable monochrome() {
            if (monoTried) return mono;
            monoTried = true;
            if (Build.VERSION.SDK_INT < 33) return null;
            try {
                Drawable d = c.getPackageManager().getApplicationIcon(pkg);
                if (d instanceof AdaptiveIconDrawable) {
                    Drawable mm = ((AdaptiveIconDrawable) d).getMonochrome();
                    if (mm != null) mono = mm.mutate();
                }
            } catch (Throwable ignored) { }
            return mono;
        }

        @Override public void setAlpha(int a) { alpha = a; invalidateSelf(); }
        @Override public void setColorFilter(ColorFilter cf) { }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }

    /** A picture on a round tile of its own background colour (the Till & Ledger register). */
    public static final class Picture extends Drawable {
        private final android.graphics.Bitmap bmp;
        private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint pic = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Path clip = new Path();
        private final RectF dst = new RectF();

        Picture(Context c, int res, int color) {
            bmp = android.graphics.BitmapFactory.decodeResource(c.getResources(), res);
            bg.setColor(color);
        }

        @Override
        public void draw(Canvas canvas) {
            Rect b = getBounds();
            float size = Math.min(b.width(), b.height());
            if (size <= 0) return;
            float cx = b.exactCenterX(), cy = b.exactCenterY(), r = size / 2f;
            canvas.drawCircle(cx, cy, r, bg);
            if (bmp == null) return;
            int save = canvas.save();
            clip.reset();
            clip.addCircle(cx, cy, r, Path.Direction.CW);
            canvas.clipPath(clip);
            float s = size * 0.86f;
            dst.set(cx - s / 2f, cy - s / 2f, cx + s / 2f, cy + s / 2f);
            canvas.drawBitmap(bmp, null, dst, pic);
            canvas.restoreToCount(save);
        }

        @Override public void setAlpha(int a) { bg.setAlpha(a); pic.setAlpha(a); invalidateSelf(); }
        @Override public void setColorFilter(ColorFilter cf) { }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }

    private static final class Color {
        static int alpha(int c) { return (c >>> 24) & 0xFF; }
    }
}
