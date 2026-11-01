package com.caleb.focus;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Shared look: colors, fonts, stone buttons, chips, insets and page transitions. */
public final class Ui {
    private Ui() { }

    public static final int BG = 0xFF07090E;
    public static final int INK = 0xFFEEF0F3;
    public static final int MUTED = 0xFFA9ACB2;
    public static final int QUIET = 0xFF8E8A80;
    public static final int GOLD = 0xFFF2D38A;
    public static final int GOLD_DEEP = 0xFFC9A85A;
    public static final int GOLD_LIGHT = 0xFFF7E2AE;
    public static final int ICE = 0xFFAACFF6;
    public static final int ICE_SOFT = 0xFFCFE0FA;
    public static final int STONE = 0x99060910;
    public static final int LINE = 0x14FFFFFF;
    public static final int BORDER_ICE = 0x1FAACFF6;
    public static final int BORDER_GOLD = 0x24F2D38A;
    public static final int BORDER_GOLD_STRONG = 0x4DF2D38A;

    public static Typeface SORA_LIGHT, SORA, SORA_MED, SORA_SEMI, NEWS, NEWS_MED, NEWS_IT, MONO;
    private static Bitmap grain;

    public static void init(Context c) {
        if (SORA != null) return;
        SORA_LIGHT = font(c, "sora_light");
        SORA = font(c, "sora_regular");
        SORA_MED = font(c, "sora_medium");
        SORA_SEMI = font(c, "sora_semibold");
        NEWS = font(c, "news_regular");
        NEWS_MED = font(c, "news_medium");
        NEWS_IT = font(c, "news_italic");
        MONO = font(c, "mono_regular");
    }

    private static Typeface font(Context c, String name) {
        try {
            return Typeface.createFromAsset(c.getAssets(), "fonts/" + name + ".ttf");
        } catch (Throwable t) {
            return Typeface.DEFAULT;
        }
    }

    public static Bitmap grain(Context c) {
        if (grain == null) {
            try { grain = BitmapFactory.decodeResource(c.getResources(), R.drawable.grain); } catch (Throwable ignored) { }
        }
        return grain;
    }

    public static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    public static float dpf(Context c, float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics());
    }

    public static TextView text(Context c, CharSequence s, float sp, int color, Typeface tf) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTypeface(tf);
        t.setIncludeFontPadding(false);
        return t;
    }

    public static TextView label(Context c, String s) {
        TextView t = text(c, s.toUpperCase(Locale.US), 11, MUTED, MONO);
        t.setLetterSpacing(0.12f);
        return t;
    }

    public static TextView mono(Context c, String s, float sp, int color) {
        TextView t = text(c, s.toUpperCase(Locale.US), sp, color, MONO);
        t.setLetterSpacing(0.08f);
        return t;
    }

    /** A dark stone surface: deep fill, grain, a soft inner shadow and a hairline edge. */
    public static class StoneDrawable extends Drawable {
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint grainPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final float radius;
        private final float density;
        private final RectF r = new RectF();
        private int alpha = 255;

        public StoneDrawable(Context c, int fillColor, int edgeColor, float radiusDp) {
            density = c.getResources().getDisplayMetrics().density;
            radius = radiusDp * density;
            fill.setColor(fillColor);
            edge.setStyle(Paint.Style.STROKE);
            edge.setStrokeWidth(Math.max(1f, density * 0.75f));
            edge.setColor(edgeColor);
            Bitmap g = grain(c);
            if (g != null) {
                BitmapShader sh = new BitmapShader(g, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT);
                Matrix m = new Matrix();
                float s = (120f * density) / g.getWidth();
                m.setScale(s, s);
                sh.setLocalMatrix(m);
                grainPaint.setShader(sh);
                grainPaint.setAlpha(150);
            }
        }

        @Override
        public void draw(Canvas canvas) {
            Rect b = getBounds();
            r.set(b.left + 0.5f, b.top + 0.5f, b.right - 0.5f, b.bottom - 0.5f);
            float rad = Math.min(radius, r.height() / 2f);
            canvas.drawRoundRect(r, rad, rad, fill);
            if (grainPaint.getShader() != null) canvas.drawRoundRect(r, rad, rad, grainPaint);
            shade.setShader(new LinearGradient(0, r.top, 0, r.top + 4 * density, 0x8C000000, 0x00000000, Shader.TileMode.CLAMP));
            canvas.drawRoundRect(r, rad, rad, shade);
            canvas.drawRoundRect(r, rad, rad, edge);
        }

        @Override public void setAlpha(int a) { alpha = a; invalidateSelf(); }
        @Override public void setColorFilter(ColorFilter cf) { }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }

    public static TextView stone(Context c, String s, int textColor, int edgeColor, float radiusDp, float sp) {
        TextView t = text(c, s, sp, textColor, SORA_MED);
        t.setGravity(Gravity.CENTER);
        t.setBackground(new StoneDrawable(c, STONE, edgeColor, radiusDp));
        t.setShadowLayer(1.2f, 0, -dpf(c, 0.8f), 0xAA000000);
        t.setClickable(true);
        t.setFocusable(true);
        press(t);
        return t;
    }

    public static TextView chip(Context c, String s, boolean gold) {
        TextView t = stone(c, s, 0xFFE6E9EF, gold ? 0x1FF2D38A : 0x1FAACFF6, 999, 13);
        t.setTypeface(SORA);
        t.setMinHeight(dp(c, 38));
        t.setPadding(dp(c, 14), 0, dp(c, 14), 0);
        return t;
    }

    public static TextView pill(Context c, String s) {
        TextView t = stone(c, s, GOLD, BORDER_GOLD, 999, 13);
        t.setTypeface(SORA);
        t.setMinHeight(dp(c, 40));
        t.setMinWidth(dp(c, 40));
        t.setPadding(dp(c, 14), 0, dp(c, 14), 0);
        return t;
    }

    public static TextView goldButton(Context c, String s) {
        TextView t = stone(c, s, GOLD, BORDER_GOLD_STRONG, 16, 15);
        t.setTypeface(SORA_SEMI);
        t.setMinHeight(dp(c, 54));
        t.setPadding(dp(c, 20), 0, dp(c, 20), 0);
        return t;
    }

    public static TextView plain(Context c, String s, int color) {
        TextView t = text(c, s, 14, color, SORA);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(c, 44));
        t.setPadding(dp(c, 16), 0, dp(c, 16), 0);
        t.setClickable(true);
        t.setFocusable(true);
        return t;
    }

    /** Springy press: sinks a touch on press and bounces back on release. */
    public static void press(final View v) {
        v.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View view, MotionEvent e) {
                int a = e.getActionMasked();
                if (a == MotionEvent.ACTION_DOWN) {
                    view.animate().scaleX(0.97f).scaleY(0.97f).alpha(0.86f).translationY(dpf(view.getContext(), 1)).setDuration(60)
                            .setInterpolator(new DecelerateInterpolator()).start();
                } else if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) {
                    view.animate().scaleX(1f).scaleY(1f).alpha(1f).translationY(0).setDuration(260)
                            .setInterpolator(new OvershootInterpolator(2.2f)).start();
                }
                return false;
            }
        });
    }

    public static LinearLayout.LayoutParams lp(int w, int h) {
        return new LinearLayout.LayoutParams(w, h);
    }

    public static LinearLayout.LayoutParams lp(int w, int h, int topMarginPx) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.topMargin = topMarginPx;
        return p;
    }

    public static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT;
    public static final int WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    public static LinearLayout column(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    public static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    public static View space(Context c) {
        View v = new View(c);
        v.setLayoutParams(new LinearLayout.LayoutParams(0, 0, 1f));
        return v;
    }

    /** Draw behind the bars, then pad the content by the bar sizes. */
    public static void edgeToEdge(Activity a, final View padded, final int sidePx, final int topExtraPx, final int bottomExtraPx) {
        a.getWindow().setDecorFitsSystemWindows(false);
        padded.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
                int bottom = Math.max(bars.bottom, ime.bottom);
                v.setPadding(sidePx + bars.left, bars.top + topExtraPx, sidePx + bars.right, bottom + bottomExtraPx);
                return in;
            }
        });
    }

    /** Deeper pages settle in from behind; going back they shrink away. */
    public static void deeperTransitions(Activity a) {
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                a.overrideActivityTransition(Activity.OVERRIDE_TRANSITION_OPEN, R.anim.deeper_in, R.anim.deeper_out);
                a.overrideActivityTransition(Activity.OVERRIDE_TRANSITION_CLOSE, R.anim.back_in, R.anim.back_out);
            } catch (Throwable ignored) { }
        }
    }

    public static void open(Activity from, Class<?> cls) {
        from.startActivity(new Intent(from, cls));
    }

    /** Items rise in on a short stagger. */
    public static void stagger(View... views) {
        long d = 60;
        for (View v : views) {
            if (v == null) continue;
            v.setAlpha(0f);
            v.setTranslationY(dpf(v.getContext(), 10));
            v.animate().alpha(1f).translationY(0).setStartDelay(d).setDuration(520)
                    .setInterpolator(new DecelerateInterpolator(2.2f)).start();
            d += 45;
        }
    }

    public static String clock(long ms) {
        return new SimpleDateFormat("h:mm a", Locale.US).format(new Date(ms));
    }

    public static String clockShort(long ms) {
        return new SimpleDateFormat("h:mm", Locale.US).format(new Date(ms));
    }

    /** Minutes as H:MM. */
    public static String hm(long minutes) {
        if (minutes < 0) minutes = 0;
        return (minutes / 60) + ":" + String.format(Locale.US, "%02d", minutes % 60);
    }

    public static String lengthWords(int minutes) {
        int h = minutes / 60, m = minutes % 60;
        if (h == 0) return m + " min";
        if (m == 0) return h + (h == 1 ? " hour" : " hours");
        return h + " h " + m + " min";
    }

    public static FrameLayout.LayoutParams flp(int w, int h, int gravity) {
        return new FrameLayout.LayoutParams(w, h, gravity);
    }

    public static void vibrate(Context c) {
        try {
            android.os.Vibrator v = (android.os.Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(android.os.VibrationEffect.createPredefined(android.os.VibrationEffect.EFFECT_TICK));
        } catch (Throwable ignored) { }
    }
}
