package com.caleb.focus;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Everything the app remembers: the day template (blocks anchored to when you wake),
 * the presets and what each allows, entertainment apps, reason passes and the YouTube allowance.
 */
public final class Store {
    public static final int ALLOW = 0, REASON = 1, BLOCK = 2;
    public static final String[] PRESET_IDS = {"god", "strict", "work", "normal", "free"};
    public static final long MIN = 60_000L, HOUR = 60 * MIN;

    public static class Preset {
        public String id, name;
        public int defaultMode;
        public boolean dnd;
        public final Map<String, Integer> modes = new HashMap<>();
    }

    public static class Block {
        public String title, preset;
        public int len; // minutes
        public Block(String t, String p, int l) { title = t; preset = p; len = l; }
    }

    /** A block placed on the clock. */
    public static class Slot {
        public String title, preset;
        public long start, end;
        public int index; // -1 for open time between blocks
        public long minutesLeft(long now) { return Math.max(0, (end - now + MIN - 1) / MIN); }
        public long lengthMin() { return Math.max(1, (end - start) / MIN); }
    }

    private static Store inst;
    private final SharedPreferences sp;
    public final Map<String, Preset> presets = new HashMap<>();
    public final List<Block> blocks = new ArrayList<>();
    public final Set<String> entertainment = new HashSet<>();
    public final Map<String, Long> passes = new HashMap<>();
    public final Set<String> pins = new HashSet<>();
    public int defaultWake; // minutes after midnight
    public long wakeAt;      // when you last said you were awake
    public int ytLimitMin;
    public String ytDay = "";
    public long ytUsedMs;

    public static synchronized Store get(Context c) {
        if (inst == null) inst = new Store(c.getApplicationContext());
        return inst;
    }

    private Store(Context c) {
        sp = c.getSharedPreferences("focus", Context.MODE_PRIVATE);
        load();
    }

    public SharedPreferences prefs() { return sp; }

    // ---------- defaults ----------

    private static Preset preset(String id, String name, int def, boolean dnd) {
        Preset p = new Preset();
        p.id = id; p.name = name; p.defaultMode = def; p.dnd = dnd;
        return p;
    }

    private void defaults() {
        presets.clear();
        presets.put("god", preset("god", "Time with God", BLOCK, true));
        presets.put("strict", preset("strict", "Strict", BLOCK, true));
        presets.put("work", preset("work", "Work", ALLOW, false));
        presets.put("normal", preset("normal", "Normal", ALLOW, false));
        presets.put("free", preset("free", "Free time", ALLOW, false));
        blocks.clear();
        blocks.add(new Block("Time with God", "god", 30));
        blocks.add(new Block("Get ready", "strict", 30));
        blocks.add(new Block("Work", "work", 12 * 60));
        blocks.add(new Block("Dinner", "strict", 60));
        blocks.add(new Block("Free time", "free", 60));
        blocks.add(new Block("Wind down", "strict", 60));
        blocks.add(new Block("Sleep", "strict", 8 * 60));
        entertainment.clear();
        String[] ent = {
                "com.instagram.android", "com.google.android.youtube", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill",
                "com.facebook.katana", "com.facebook.lite", "com.snapchat.android", "com.twitter.android", "com.reddit.frontpage",
                "com.pinterest", "com.netflix.mediaclient", "com.hulu.plus", "com.disney.disneyplus", "tv.twitch.android.app",
                "com.amazon.avod.thirdpartyclient", "com.roblox.client", "com.tumblr", "com.instagram.barcelona",
                "com.google.android.apps.youtube.kids", "com.vanced.android.youtube", "app.revanced.android.youtube",
                "com.peacocktv.peacockandroid", "com.hbo.hbonow", "com.wbd.stream", "com.discord", "com.bereal.ft",
                "com.linkedin.android"
        };
        for (String s : ent) entertainment.add(s);
        defaultWake = 6 * 60;
        wakeAt = 0;
        ytLimitMin = 15;
    }

    // ---------- persistence ----------

    private void load() {
        defaults();
        String raw = sp.getString("model", null);
        if (raw == null) return;
        try {
            JSONObject o = new JSONObject(raw);
            JSONObject ps = o.optJSONObject("presets");
            if (ps != null) {
                for (String id : PRESET_IDS) {
                    JSONObject p = ps.optJSONObject(id);
                    if (p == null) continue;
                    Preset pr = presets.get(id);
                    pr.name = p.optString("name", pr.name);
                    pr.defaultMode = p.optInt("def", pr.defaultMode);
                    pr.dnd = p.optBoolean("dnd", pr.dnd);
                    JSONObject m = p.optJSONObject("modes");
                    if (m != null) {
                        JSONArray names = m.names();
                        if (names != null) for (int i = 0; i < names.length(); i++) pr.modes.put(names.getString(i), m.getInt(names.getString(i)));
                    }
                }
            }
            JSONArray bl = o.optJSONArray("blocks");
            if (bl != null && bl.length() > 0) {
                blocks.clear();
                for (int i = 0; i < bl.length(); i++) {
                    JSONObject b = bl.getJSONObject(i);
                    String pid = b.optString("preset", "normal");
                    if (!presets.containsKey(pid)) pid = "normal";
                    blocks.add(new Block(b.optString("title", "Block"), pid, Math.max(5, b.optInt("len", 60))));
                }
            }
            JSONArray en = o.optJSONArray("ent");
            if (en != null) {
                entertainment.clear();
                for (int i = 0; i < en.length(); i++) entertainment.add(en.getString(i));
            }
            JSONObject pa = o.optJSONObject("passes");
            if (pa != null && pa.names() != null) {
                for (int i = 0; i < pa.names().length(); i++) {
                    String k = pa.names().getString(i);
                    passes.put(k, pa.getLong(k));
                }
            }
            JSONArray pn = o.optJSONArray("pins");
            if (pn != null) for (int i = 0; i < pn.length(); i++) pins.add(pn.getString(i));
            defaultWake = o.optInt("defaultWake", defaultWake);
            wakeAt = o.optLong("wakeAt", 0);
            ytLimitMin = o.optInt("ytLimit", ytLimitMin);
            ytDay = o.optString("ytDay", "");
            ytUsedMs = o.optLong("ytUsed", 0);
        } catch (Exception e) {
            defaults();
        }
    }

    public synchronized void save() {
        try {
            JSONObject o = new JSONObject();
            JSONObject ps = new JSONObject();
            for (String id : PRESET_IDS) {
                Preset pr = presets.get(id);
                JSONObject p = new JSONObject();
                p.put("name", pr.name);
                p.put("def", pr.defaultMode);
                p.put("dnd", pr.dnd);
                JSONObject m = new JSONObject();
                for (Map.Entry<String, Integer> e : pr.modes.entrySet()) m.put(e.getKey(), e.getValue());
                p.put("modes", m);
                ps.put(id, p);
            }
            o.put("presets", ps);
            JSONArray bl = new JSONArray();
            for (Block b : blocks) {
                JSONObject j = new JSONObject();
                j.put("title", b.title); j.put("preset", b.preset); j.put("len", b.len);
                bl.put(j);
            }
            o.put("blocks", bl);
            JSONArray en = new JSONArray();
            for (String s : entertainment) en.put(s);
            o.put("ent", en);
            JSONObject pa = new JSONObject();
            long now = System.currentTimeMillis();
            for (Map.Entry<String, Long> e : passes.entrySet()) if (e.getValue() > now) pa.put(e.getKey(), e.getValue());
            o.put("passes", pa);
            JSONArray pn = new JSONArray();
            for (String s : pins) pn.put(s);
            o.put("pins", pn);
            o.put("defaultWake", defaultWake);
            o.put("wakeAt", wakeAt);
            o.put("ytLimit", ytLimitMin);
            o.put("ytDay", ytDay);
            o.put("ytUsed", ytUsedMs);
            sp.edit().putString("model", o.toString()).apply();
        } catch (Exception ignored) { }
    }

    // ---------- the day ----------

    /** Start of today's plan: when you said you woke, or your usual wake time. */
    public long totalMin() {
        long t = 0;
        for (Block b : blocks) t += b.len;
        return t;
    }

    public long anchor(long now) {
        long span = Math.max(12 * HOUR, totalMin() * MIN);
        if (wakeAt > 0 && now >= wakeAt && now < wakeAt + span) return wakeAt;
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, defaultWake / 60);
        c.set(Calendar.MINUTE, defaultWake % 60);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() > now) c.add(Calendar.DAY_OF_MONTH, -1);
        long t = c.getTimeInMillis();
        // An early wake tap (before today's usual time, or after it) keeps owning the day; its blocks have ended, so it's open time.
        if (wakeAt > 0 && wakeAt <= now && wakeAt > t - 6 * HOUR) return wakeAt;
        return t;
    }

    /** Minutes until the next usual wake time. */
    public long minutesToUsualWake(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, defaultWake / 60);
        c.set(Calendar.MINUTE, defaultWake % 60);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= now) c.add(Calendar.DAY_OF_MONTH, 1);
        return (c.getTimeInMillis() - now) / MIN;
    }

    public boolean dayStartedByTap(long now) {
        return wakeAt > 0 && anchor(now) == wakeAt;
    }

    public List<Slot> slots(long now) {
        List<Slot> out = new ArrayList<>();
        long a = anchor(now);
        long off = 0;
        for (int i = 0; i < blocks.size(); i++) {
            Block b = blocks.get(i);
            Slot s = new Slot();
            s.title = b.title; s.preset = b.preset; s.index = i;
            s.start = wall(a, off);
            off += b.len;
            s.end = wall(a, off);
            out.add(s);
        }
        return out;
    }

    /** Clock time a number of minutes after the anchor, counted on the wall clock so daylight saving doesn't shift the day. */
    private static long wall(long anchor, long offsetMin) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(anchor);
        long total = c.get(Calendar.HOUR_OF_DAY) * 60L + c.get(Calendar.MINUTE) + offsetMin;
        c.add(Calendar.DAY_OF_MONTH, (int) (total / 1440));
        long m = total % 1440;
        c.set(Calendar.HOUR_OF_DAY, (int) (m / 60));
        c.set(Calendar.MINUTE, (int) (m % 60));
        return c.getTimeInMillis();
    }

    public Slot current(long now) {
        List<Slot> all = slots(now);
        for (Slot s : all) if (now >= s.start && now < s.end) return s;
        Slot open = new Slot();
        open.title = "Open time";
        open.preset = "normal";
        open.index = -1;
        long a = anchor(now);
        long dayEnd = all.isEmpty() ? a : all.get(all.size() - 1).end;
        open.start = Math.max(dayEnd, a);
        // Open time lasts until the next usual wake time.
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, defaultWake / 60);
        c.set(Calendar.MINUTE, defaultWake % 60);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= now) c.add(Calendar.DAY_OF_MONTH, 1);
        long next = c.getTimeInMillis();
        open.end = next;
        if (open.start > now) open.start = now;
        return open;
    }

    public List<Slot> upcoming(long now, int max) {
        List<Slot> out = new ArrayList<>();
        for (Slot s : slots(now)) {
            if (s.start > now) out.add(s);
            if (out.size() >= max) break;
        }
        return out;
    }

    /** Next time Free time starts today, or 0. */
    public long nextFree(long now) {
        for (Slot s : slots(now)) if ("free".equals(s.preset) && s.end > now) return Math.max(s.start, now);
        return 0;
    }

    public Preset currentPreset(long now) {
        Preset p = presets.get(current(now).preset);
        return p != null ? p : presets.get("normal");
    }

    // ---------- decisions ----------

    public static class Decision {
        public int mode;          // ALLOW, REASON or BLOCK
        public boolean entertainment;
        public boolean essential;
        public String presetName;
    }

    public Decision decide(Context c, String pkg, long now) {
        Decision d = new Decision();
        Preset p = currentPreset(now);
        d.presetName = p.name;
        if (pkg == null || Apps.isSystemSafe(c, pkg)) { d.mode = ALLOW; d.essential = true; return d; }
        if (Apps.isEssential(c, pkg)) { d.mode = ALLOW; d.essential = true; return d; }
        if (isEntertainment(c, pkg)) {
            d.entertainment = true;
            d.mode = "free".equals(p.id) ? ALLOW : BLOCK;
            return d;
        }
        if ("god".equals(p.id) && Apps.isRejoiceify(c, pkg)) { d.mode = ALLOW; return d; }
        Integer m = p.modes.get(pkg);
        d.mode = m != null ? m : p.defaultMode;
        if (d.mode == REASON) {
            Long until = passes.get(pkg);
            if (until != null && until > now) d.mode = ALLOW;
        }
        return d;
    }

    /** Mode as set in the preset, ignoring passes. */
    public int modeIn(Context c, Preset p, String pkg) {
        if (Apps.isSystemSafe(c, pkg) || Apps.isEssential(c, pkg)) return ALLOW;
        if (isEntertainment(c, pkg)) return "free".equals(p.id) ? ALLOW : BLOCK;
        if ("god".equals(p.id) && Apps.isRejoiceify(c, pkg)) return ALLOW;
        Integer m = p.modes.get(pkg);
        return m != null ? m : p.defaultMode;
    }

    public boolean isEntertainment(Context c, String pkg) {
        if (entertainment.contains(pkg)) return true;
        return Apps.isGame(c, pkg) && !entertainment.contains("!" + pkg);
    }

    public void grantPass(String pkg, int minutes, String reason) {
        passes.put(pkg, System.currentTimeMillis() + minutes * MIN);
        try {
            JSONArray log = new JSONArray(sp.getString("reasons", "[]"));
            JSONObject e = new JSONObject();
            e.put("t", System.currentTimeMillis());
            e.put("pkg", pkg);
            e.put("why", reason);
            log.put(e);
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, log.length() - 200); i < log.length(); i++) trimmed.put(log.get(i));
            sp.edit().putString("reasons", trimmed.toString()).apply();
        } catch (Exception ignored) { }
        save();
    }

    // ---------- YouTube in Chrome ----------

    public static String dayKey(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        return c.get(Calendar.YEAR) + "-" + c.get(Calendar.DAY_OF_YEAR);
    }

    public synchronized void addYouTube(long ms, long now) {
        String k = dayKey(now);
        if (!k.equals(ytDay)) { ytDay = k; ytUsedMs = 0; }
        ytUsedMs += ms;
    }

    public long ytUsed(long now) {
        return dayKey(now).equals(ytDay) ? ytUsedMs : 0;
    }

    public String presetName(String id) {
        Preset p = presets.get(id);
        return p != null ? p.name : "Normal";
    }
}
