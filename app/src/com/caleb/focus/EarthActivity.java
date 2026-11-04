package com.caleb.focus;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.opengl.GLES30;
import android.opengl.GLSurfaceView;
import android.opengl.GLUtils;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * The Earth right now, the phone's simpler cousin of the PC desktop: day and night where they really are, city
 * lights, live clouds from satellites, and home marked. Drag to turn it, pinch to zoom, double-tap to come home.
 * It only redraws when you touch it (and once a minute as the sun moves), so it costs almost no battery.
 * NASA Blue Marble and Black Marble imagery, public domain. Live clouds: Live Cloud Maps (CC0),
 * contains modified EUMETSAT data.
 */
public class EarthActivity extends Activity {
    static final double HOME_LAT = 40.19, HOME_LON = -92.58;
    static final String CLOUDS_URL = "https://clouds.matteason.co.uk/images/4096x2048/clouds.jpg";
    static final long CLOUDS_EVERY = 3 * 60 * 60 * 1000L;

    private EarthView earth;
    private TextView line, cloudLine;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable minute = new Runnable() {
        @Override public void run() { caption(); earth.requestRender(); h.postDelayed(this, 60_000 - System.currentTimeMillis() % 60_000 + 50); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        FrameLayout root = new FrameLayout(this);   // no background: the Earth's surface shows through
        earth = new EarthView(this);
        root.addView(earth, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));

        LinearLayout col = Ui.column(this);
        root.addView(col, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, col, Ui.dp(this, 20), Ui.dp(this, 8), Ui.dp(this, 18));
        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        top.addView(Ui.space(this));
        top.addView(Ui.mono(this, "EARTH RIGHT NOW", 11, Ui.MUTED));
        col.addView(top);
        col.addView(Ui.space(this));
        // touches go to the Earth, except on the controls
        col.setClickable(false);

        line = Ui.text(this, "", 15, Ui.INK, Ui.SORA);
        line.setGravity(Gravity.CENTER);
        col.addView(line, Ui.lp(Ui.MATCH, Ui.WRAP));
        TextView hint = Ui.mono(this, "DRAG TO TURN · PINCH TO ZOOM · DOUBLE-TAP FOR HOME", 9, Ui.QUIET);
        hint.setGravity(Gravity.CENTER);
        col.addView(hint, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        cloudLine = Ui.mono(this, "", 8, 0xFF5E5B55);
        cloudLine.setGravity(Gravity.CENTER);
        col.addView(cloudLine, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 4)));

        setContentView(root);
    }

    @Override protected void onResume() {
        super.onResume();
        earth.onResume();
        caption();
        h.removeCallbacks(minute);
        h.postDelayed(minute, 60_000 - System.currentTimeMillis() % 60_000 + 50);
        fetchClouds();
    }

    @Override protected void onPause() {
        h.removeCallbacks(minute);
        earth.onPause();
        super.onPause();
    }

    private void caption() {
        long now = System.currentTimeMillis();
        long[] rs = sunTimes(now, HOME_LAT, HOME_LON);
        String tail = "";
        if (rs != null) {
            if (now < rs[0]) tail = " · sunrise " + Ui.clock(rs[0]);
            else if (now < rs[1]) tail = " · daylight until " + Ui.clock(rs[1]);
            else tail = " · night";
        }
        line.setText("Kirksville " + Ui.clock(now) + tail);
        long at = Store.get(this).prefs().getLong("cloudsAt", 0);
        cloudLine.setText(at > 0 ? ("Clouds from " + Ui.clock(at) + " · contains modified EUMETSAT data").toUpperCase(Locale.US) : "");
    }

    // ---------- live clouds ----------

    static File cloudFile(Context c) { return new File(c.getFilesDir(), "clouds.jpg"); }

    /** A fresh satellite cloud map, at most every 3 hours, only while this screen is open. */
    private void fetchClouds() {
        final SharedPreferences sp = Store.get(this).prefs();
        if (System.currentTimeMillis() - sp.getLong("cloudsFetched", 0) < CLOUDS_EVERY && cloudFile(this).exists()) return;
        final Context app = getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection con = null;
                try {
                    con = (HttpURLConnection) new URL(CLOUDS_URL).openConnection();
                    con.setConnectTimeout(15000);
                    con.setReadTimeout(30000);
                    if (con.getResponseCode() != 200) return;
                    long lm = con.getLastModified();
                    File tmp = new File(app.getFilesDir(), "clouds.tmp");
                    InputStream in = con.getInputStream();
                    FileOutputStream out = new FileOutputStream(tmp);
                    byte[] buf = new byte[65536];
                    int n, total = 0;
                    try { while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; } } finally { out.close(); in.close(); }
                    if (total < 40000) { tmp.delete(); return; }
                    if (!tmp.renameTo(cloudFile(app))) return;
                    sp.edit().putLong("cloudsFetched", System.currentTimeMillis()).putLong("cloudsAt", lm > 0 ? lm : System.currentTimeMillis()).apply();
                    h.post(new Runnable() { @Override public void run() { if (!isFinishing()) { earth.reloadClouds(); caption(); } } });
                } catch (Throwable ignored) {
                } finally { if (con != null) con.disconnect(); }
            }
        }, "clouds").start();
    }

    // ---------- where the sun is ----------

    /** The point where the sun is overhead: { lat, lon, equation of time in minutes }. Good to about a degree. */
    static double[] subsolar(long ms) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.setTimeInMillis(ms);
        Calendar start = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        start.clear();
        start.set(c.get(Calendar.YEAR), Calendar.JANUARY, 0);
        double n = (ms - start.getTimeInMillis()) / 86400000.0;
        double b = 2 * Math.PI * (n - 81) / 364;
        double eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
        double decl = -23.44 * Math.cos(2 * Math.PI * (n + 10) / 365);
        double utcH = c.get(Calendar.HOUR_OF_DAY) + c.get(Calendar.MINUTE) / 60.0 + c.get(Calendar.SECOND) / 3600.0;
        double lon = -15 * (utcH - 12 + eot / 60);
        lon = ((lon + 540) % 360) - 180;
        return new double[]{decl, lon, eot};
    }

    /** Today's sunrise and sunset at a place, epoch ms, or null near the poles. */
    static long[] sunTimes(long ms, double lat, double lon) {
        Calendar local = Calendar.getInstance();
        local.setTimeInMillis(ms);
        Calendar u = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        u.clear();
        u.set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH), 12, 0, 0);
        double[] s = subsolar(u.getTimeInMillis());
        double r = Math.PI / 180;
        double cosH = (Math.sin(-0.833 * r) - Math.sin(lat * r) * Math.sin(s[0] * r)) / (Math.cos(lat * r) * Math.cos(s[0] * r));
        if (cosH < -1 || cosH > 1) return null;
        double hrs = Math.acos(cosH) / r / 15;
        double noonH = 12 - lon / 15 - s[2] / 60;
        u.set(Calendar.HOUR_OF_DAY, 0);
        long noon = u.getTimeInMillis() + (long) (noonH * 3600000);
        return new long[]{noon - (long) (hrs * 3600000), noon + (long) (hrs * 3600000)};
    }

    static float[] unit(double lat, double lon) {
        double a = Math.toRadians(lat), o = Math.toRadians(lon);
        return new float[]{(float) (Math.cos(a) * Math.sin(o)), (float) Math.sin(a), (float) (Math.cos(a) * Math.cos(o))};
    }

    // ---------- the globe ----------

    static class EarthView extends GLSurfaceView {
        final EarthRenderer r;
        final ScaleGestureDetector scale;
        final GestureDetector gest;
        float lastX, lastY;
        float vx, vy;   // a flick keeps it turning for a moment
        final Runnable spin = new Runnable() {
            @Override public void run() {
                if (Math.abs(vx) + Math.abs(vy) < 0.02f) return;
                turn(vx * 16, vy * 16);
                vx *= 0.92f; vy *= 0.92f;
                postOnAnimation(this);
            }
        };

        EarthView(Context c) {
            super(c);
            setEGLContextClientVersion(3);
            setEGLConfigChooser(8, 8, 8, 8, 0, 0);
            r = new EarthRenderer(c);
            setRenderer(r);
            setRenderMode(RENDERMODE_WHEN_DIRTY);
            scale = new ScaleGestureDetector(c, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                @Override public boolean onScale(ScaleGestureDetector d) {
                    r.zoomBy(d.getScaleFactor());
                    requestRender();
                    return true;
                }
            });
            gest = new GestureDetector(c, new GestureDetector.SimpleOnGestureListener() {
                @Override public boolean onDown(MotionEvent e) { removeCallbacks(spin); vx = vy = 0; return true; }
                @Override public boolean onScroll(MotionEvent e1, MotionEvent e2, float dx, float dy) {
                    if (e2.getPointerCount() > 1 || scale.isInProgress()) return true;
                    turn(-dx, -dy);
                    return true;
                }
                @Override public boolean onFling(MotionEvent e1, MotionEvent e2, float fx, float fy) {
                    if (scale.isInProgress()) return true;
                    vx = fx / 1000f; vy = fy / 1000f;
                    postOnAnimation(spin);
                    return true;
                }
                @Override public boolean onDoubleTap(MotionEvent e) { r.home(); requestRender(); return true; }
            });
        }

        void turn(float dx, float dy) { r.turn(dx, dy); requestRender(); }

        void reloadClouds() { queueEvent(new Runnable() { @Override public void run() { r.loadClouds(); } }); requestRender(); }

        @Override public boolean onTouchEvent(MotionEvent e) {
            scale.onTouchEvent(e);
            gest.onTouchEvent(e);
            return true;
        }
    }

    static class EarthRenderer implements GLSurfaceView.Renderer {
        static final float DIST = 3.6f, MIN_DIST = 1.3f;
        final Context c;
        int prog, w, h;
        int texDay, texNight, texWater, texClouds, texSky;
        FloatBuffer quad;
        volatile float viewLat = 24f, viewLon = (float) HOME_LON + 22f, dist = DIST;
        float restR, skyAspect = 0.46f;

        EarthRenderer(Context c) { this.c = c.getApplicationContext(); }

        float zoom() { return (float) (Math.sqrt(DIST * DIST - 1) / Math.sqrt(dist * dist - 1)); }

        void turn(float dx, float dy) {
            float r = Math.max(60, restR * zoom());
            viewLon -= dx / r * 50f;
            viewLat = Math.max(-80f, Math.min(80f, viewLat + dy / r * 50f));
        }

        void zoomBy(float k) {
            double z = Math.max(1, Math.min(Math.sqrt(DIST * DIST - 1) / Math.sqrt(MIN_DIST * MIN_DIST - 1), zoom() * k));
            dist = (float) Math.sqrt((DIST * DIST - 1) / (z * z) + 1);
        }

        void home() { viewLat = 24f; viewLon = (float) HOME_LON + 22f; dist = DIST; }

        @Override public void onSurfaceCreated(GL10 unused, EGLConfig cfg) {
            try { prog = program(VS, FS); } catch (Throwable t) { prog = 0; return; }   // no globe rather than a crash
            quad = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
            quad.put(new float[]{-1, -1, 1, -1, -1, 1, 1, 1}).position(0);
            texDay = texture(asset("earth/day.jpg"), false);
            texNight = texture(asset("earth/night.jpg"), false);
            texWater = texture(asset("earth/water.png"), true);
            Bitmap sk = BitmapFactory.decodeResource(c.getResources(), R.drawable.sky_night);
            skyAspect = sk != null ? sk.getWidth() / (float) sk.getHeight() : 0.46f;
            texSky = texture(sk, false);
            loadClouds();
        }

        void loadClouds() {
            Bitmap b = null;
            File f = cloudFile(c);
            if (f.exists()) {
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inPreferredConfig = Bitmap.Config.ARGB_8888;
                b = BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            }
            if (b == null) b = asset("earth/clouds.jpg");
            if (texClouds != 0) GLES30.glDeleteTextures(1, new int[]{texClouds}, 0);
            texClouds = texture(b, true);
        }

        Bitmap asset(String name) {
            try {
                InputStream in = c.getAssets().open(name);
                try {
                    BitmapFactory.Options o = new BitmapFactory.Options();
                    o.inScaled = false;
                    return BitmapFactory.decodeStream(in, null, o);
                } finally { in.close(); }
            } catch (Exception e) { return null; }
        }

        static boolean pot(int n) { return n > 0 && (n & (n - 1)) == 0; }

        static int texture(Bitmap b, boolean grey) {
            int[] t = new int[1];
            GLES30.glGenTextures(1, t, 0);
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, t[0]);
            if (b == null) {
                ByteBuffer px = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder());
                px.put(new byte[]{0, 0, 0, (byte) 255}).position(0);
                GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA, 1, 1, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, px);
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST);
                return t[0];
            }
            GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, b, 0);
            boolean mip = pot(b.getWidth()) && pot(b.getHeight());
            if (mip) GLES30.glGenerateMipmap(GLES30.GL_TEXTURE_2D);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, mip ? GLES30.GL_LINEAR_MIPMAP_LINEAR : GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, mip ? GLES30.GL_REPEAT : GLES30.GL_CLAMP_TO_EDGE);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE);
            b.recycle();
            return t[0];
        }

        @Override public void onSurfaceChanged(GL10 unused, int width, int height) {
            w = width; h = height;
            GLES30.glViewport(0, 0, w, h);
            restR = Math.min(w * 0.44f, h * 0.30f);
        }

        @Override public void onDrawFrame(GL10 unused) {
            GLES30.glClearColor(0.02f, 0.027f, 0.047f, 1f);
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
            if (prog == 0) return;
            GLES30.glUseProgram(prog);
            int loc = GLES30.glGetAttribLocation(prog, "p");
            GLES30.glEnableVertexAttribArray(loc);
            GLES30.glVertexAttribPointer(loc, 2, GLES30.GL_FLOAT, false, 0, quad);

            float cx = w / 2f, cy = h * 0.53f;   // GL counts up from the bottom: a little above the middle
            float f = (float) (restR * Math.sqrt(DIST * DIST - 1));
            GLES30.glUniform2f(u("uC"), cx, cy);
            GLES30.glUniform1f(u("uF"), f);
            GLES30.glUniform1f(u("uD"), dist);
            GLES30.glUniform2f(u("uRes"), w, h);
            GLES30.glUniformMatrix3fv(u("uRot"), 1, false, rotation(), 0);
            double[] s = subsolar(System.currentTimeMillis());
            GLES30.glUniform3fv(u("uSun"), 1, unit(s[0], s[1]), 0);
            GLES30.glUniform3fv(u("uHome"), 1, unit(HOME_LAT, HOME_LON), 0);
            GLES30.glUniform1f(u("uHomeR"), 0.014f / zoom());
            GLES30.glUniform1f(u("uHalo"), 0.085f);
            GLES30.glUniform1f(u("uCloudH"), 0.0055f);
            GLES30.glUniform1f(u("uSkyA"), skyAspect);
            bind(0, texDay, "uDay"); bind(1, texNight, "uNight"); bind(2, texWater, "uWater"); bind(3, texClouds, "uClouds"); bind(4, texSky, "uSky");
            GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4);
            GLES30.glDisableVertexAttribArray(loc);
        }

        void bind(int unitN, int tex, String name) {
            GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + unitN);
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex);
            GLES30.glUniform1i(u(name), unitN);
        }

        int u(String n) { return GLES30.glGetUniformLocation(prog, n); }

        /** view → earth: Ry(lon) · Rx(-lat), column-major. */
        float[] rotation() {
            double a = Math.toRadians(-viewLat), o = Math.toRadians(viewLon);
            float ca = (float) Math.cos(a), sa = (float) Math.sin(a), co = (float) Math.cos(o), so = (float) Math.sin(o);
            float[][] m = {{co, so * sa, so * ca}, {0, ca, -sa}, {-so, co * sa, co * ca}};
            return new float[]{m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]};
        }

        static int shader(int type, String src) {
            int s = GLES30.glCreateShader(type);
            GLES30.glShaderSource(s, src);
            GLES30.glCompileShader(s);
            int[] ok = new int[1];
            GLES30.glGetShaderiv(s, GLES30.GL_COMPILE_STATUS, ok, 0);
            if (ok[0] == 0) throw new RuntimeException("shader: " + GLES30.glGetShaderInfoLog(s));
            return s;
        }

        static int program(String vs, String fs) {
            int p = GLES30.glCreateProgram();
            GLES30.glAttachShader(p, shader(GLES30.GL_VERTEX_SHADER, vs));
            GLES30.glAttachShader(p, shader(GLES30.GL_FRAGMENT_SHADER, fs));
            GLES30.glLinkProgram(p);
            int[] ok = new int[1];
            GLES30.glGetProgramiv(p, GLES30.GL_LINK_STATUS, ok, 0);
            if (ok[0] == 0) throw new RuntimeException("link: " + GLES30.glGetProgramInfoLog(p));
            return p;
        }

        static final String VS = "#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }\n";

        // The same Earth as the PC desktop (see pc/app/ui/earth.js), with the night sky picture behind it.
        static final String FS = "#version 300 es\n"
                + "precision highp float;\n"
                + "uniform vec2 uC; uniform float uF; uniform float uD; uniform vec2 uRes; uniform mat3 uRot; uniform vec3 uSun; uniform vec3 uHome;\n"
                + "uniform float uHomeR; uniform float uHalo; uniform float uCloudH;\n"
                + "uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uWater; uniform sampler2D uClouds; uniform sampler2D uSky; uniform float uSkyA;\n"
                + "out vec4 outColor;\n"
                + "const float PI = 3.14159265;\n"
                + "vec2 ll(vec3 n){\n"
                + "  float u = atan(n.x, n.z) / (2.0 * PI);\n"
                + "  float v = 0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI;\n"
                + "  float u1 = fract(u + 0.5), u2 = fract(u) - 0.5;\n"
                + "  return vec2(fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2 + 0.5, v);\n"
                + "}\n"
                + "float cloud(vec3 n){ return smoothstep(0.10, 0.85, texture(uClouds, ll(n)).r); }\n"
                + "vec3 haloColor(vec3 nE){ float lit = clamp(dot(nE, uSun) * 0.8 + 0.35, 0.0, 1.0); return vec3(0.36, 0.62, 1.0) * (0.18 + 0.55 * lit); }\n"
                + "vec3 cloudLight(vec3 nc, float cl, float l){\n"
                + "  float toward = cloud(normalize(nc + uSun * 0.0035));\n"
                + "  float relief = clamp((cl - toward) * 1.6, -0.5, 0.5);\n"
                + "  vec3 c = vec3(1.0, 0.99, 0.97) * (0.06 + 1.1 * clamp(l + 0.04, 0.0, 1.0)) * (0.80 + 0.22 * cl - 0.30 * relief);\n"
                + "  return c + vec3(0.55, 0.24, 0.08) * exp(-pow((l - 0.02) / 0.035, 2.0)) * 0.32;\n"
                + "}\n"
                + "vec3 sky(){\n"
                // the night sky picture, cropped to fill the screen
                + "  vec2 q = gl_FragCoord.xy / uRes; float a = uRes.x / uRes.y;\n"
                + "  vec2 t = vec2(q.x, 1.0 - q.y);\n"
                + "  if (a < uSkyA) t.x = 0.5 + (t.x - 0.5) * a / uSkyA; else t.y = 0.5 + (t.y - 0.5) * uSkyA / a;\n"
                + "  return texture(uSky, t).rgb * 0.75;\n"
                + "}\n"
                + "void main(){\n"
                + "  vec3 d = normalize(vec3((gl_FragCoord.xy - uC) / uF, -1.0));\n"
                + "  vec3 O = vec3(0.0, 0.0, uD);\n"
                + "  float b = dot(O, d);\n"
                + "  float h = sqrt(max(uD * uD - b * b, 0.0));\n"
                + "  vec3 dE = uRot * d;\n"
                + "  float rc = 1.0 + uCloudH;\n"
                + "  vec3 bg = sky();\n"
                + "  if (h >= 1.0) {\n"
                + "    float k = clamp((1.0 + uHalo - h) / uHalo, 0.0, 1.0);\n"
                + "    vec3 c = bg + haloColor(uRot * normalize(O - b * d)) * k * k;\n"
                + "    if (h < rc) {\n"
                + "      vec3 nc = uRot * normalize(O + (-b - sqrt(max(b * b - (uD * uD - rc * rc), 0.0))) * d);\n"
                + "      float cl = cloud(nc) * smoothstep(rc, 1.0 + uCloudH * 0.3, h);\n"
                + "      float l = dot(nc, uSun);\n"
                + "      c = mix(c, cloudLight(nc, cl, l) * smoothstep(-0.12, 0.05, l), cl * 0.85);\n"
                + "    }\n"
                + "    outColor = vec4(c, 1.0);\n"
                + "    return;\n"
                + "  }\n"
                + "  vec3 p = O + (-b - sqrt(b * b - (uD * uD - 1.0))) * d;\n"
                + "  vec3 n = uRot * p;\n"
                + "  vec3 nc = uRot * normalize(O + (-b - sqrt(b * b - (uD * uD - rc * rc))) * d);\n"
                + "  vec2 t = ll(n);\n"
                + "  vec3 day = texture(uDay, t).rgb;\n"
                + "  vec3 night = texture(uNight, t).rgb;\n"
                + "  float water = texture(uWater, t).r;\n"
                + "  float cl = cloud(nc);\n"
                + "  float shadow = cloud(normalize(n + uSun * (uCloudH * 1.4 + 0.004)));\n"
                + "  float l = dot(n, uSun);\n"
                + "  float dayMix = smoothstep(-0.10, 0.14, l);\n"
                + "  vec3 nightBase = min(night, vec3(0.06)) * vec3(0.30, 0.36, 0.58) * (1.0 - 0.5 * cl);\n"
                + "  vec3 dayCol = day * (0.07 + 1.05 * clamp(l, 0.0, 1.0)) * (1.0 - 0.42 * shadow * (1.0 - cl)) + nightBase * 0.85;\n"
                + "  vec3 lights = max(night - vec3(0.22), vec3(0.0)) * vec3(2.6, 2.1, 1.3) * (1.0 - 0.8 * cl);\n"
                + "  vec3 nightCol = night * vec3(0.30, 0.36, 0.58) * (1.0 - 0.5 * cl) + lights + vec3(0.035, 0.045, 0.075) * cl;\n"
                + "  vec3 col = mix(nightCol, dayCol, dayMix);\n"
                + "  vec3 hv = normalize(uSun - dE);\n"
                + "  float sh = max(dot(n, hv), 0.0);\n"
                + "  col += vec3(1.0, 0.93, 0.80) * (pow(sh, 220.0) * 0.24 + pow(sh, 40.0) * 0.02) * water * dayMix * (1.0 - cl);\n"
                + "  float lc = dot(nc, uSun);\n"
                + "  col = mix(col, cloudLight(nc, cl, lc), cl * 0.92 * smoothstep(-0.12, 0.05, lc));\n"
                + "  col += vec3(0.38, 0.15, 0.04) * exp(-pow((l - 0.03) / 0.04, 2.0)) * 0.16 * (1.0 - cl);\n"
                + "  float mu = clamp(dot(p, -d), 0.0, 1.0);\n"
                + "  col = mix(col, vec3(0.42, 0.66, 1.0), pow(1.0 - mu, 2.6) * (0.25 + 0.5 * dayMix) * 0.8);\n"
                + "  float ang = acos(clamp(dot(n, uHome), -1.0, 1.0));\n"
                + "  col = mix(col, vec3(0.95, 0.83, 0.54), smoothstep(uHomeR * 1.17, uHomeR * 0.83, ang));\n"
                + "  col = mix(col, bg + haloColor(n), smoothstep(0.985, 1.0, h) * 0.85);\n"
                + "  outColor = vec4(col, 1.0);\n"
                + "}\n";
    }
}
