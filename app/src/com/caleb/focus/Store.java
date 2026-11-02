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
        public String title, preset, note = "";
        public long start, end;
        public int index; // -1 for open time between blocks
        public int day;   // 0 = Sunday
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
    public long prevWakeAt;  // what it was before, so a mistaken tap can be undone
    public long editedAt;    // last change to the day, for syncing with the PC
    private final Context appCtx;
    public int ytLimitMin;
    public String ytDay = "";
    public long ytUsedMs;

    public static synchronized Store get(Context c) {
        if (inst == null) inst = new Store(c.getApplicationContext());
        return inst;
    }

    private Store(Context c) {
        appCtx = c;
        sp = c.getSharedPreferences("focus", Context.MODE_PRIVATE);
        load();
        if (migrated) { editedAt = System.currentTimeMillis(); save(); }
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

    private boolean migrated;

    private void load() {
        defaults();
        defaultWeek();
        String raw = sp.getString("model", null);
        if (raw == null) { migrated = true; return; }
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
            prevWakeAt = o.optLong("prevWakeAt", 0);
            editedAt = o.optLong("editedAt", 0);
            ytLimitMin = o.optInt("ytLimit", ytLimitMin);
            ytDay = o.optString("ytDay", "");
            ytUsedMs = o.optLong("ytUsed", 0);
            JSONObject wk = o.optJSONObject("week");
            if (wk == null || !readWeek(wk)) {
                // Older versions kept one wake-anchored day: start from the planned week instead.
                defaultWeek();
                migrated = true;
            }
        } catch (Exception e) {
            defaults();
            defaultWeek();
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
            o.put("week", writeWeek());
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
            o.put("prevWakeAt", prevWakeAt);
            o.put("editedAt", editedAt);
            o.put("ytLimit", ytLimitMin);
            o.put("ytDay", ytDay);
            o.put("ytUsed", ytUsedMs);
            sp.edit().putString("model", o.toString()).apply();
        } catch (Exception ignored) { }
    }

    // ---------- the week ----------

    public static final String[] DAY_KEYS = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};
    public static final String[] DAY_NAMES = {"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"};

    /** One block on a weekday, in clock minutes. end <= start means it runs past midnight. */
    public static class TBlock {
        public int start, end;
        public String title, preset, note;
        public TBlock(int s, int e, String t, String p, String n) { start = s; end = e; title = t; preset = p; note = n == null ? "" : n; }
        public TBlock copy() { return new TBlock(start, end, title, preset, note); }
    }

    /** week.get(0) = Sunday ... week.get(6) = Saturday */
    public final List<List<TBlock>> week = new ArrayList<>();

    static int mins(String hhmm) {
        try {
            String[] p = hhmm.trim().split(":");
            return (Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1])) % 1440;
        } catch (Exception e) { return 0; }
    }

    static String hhmm(int m) {
        return String.format(java.util.Locale.US, "%02d:%02d", (m / 60) % 24, m % 60);
    }

    boolean readWeek(JSONObject days) {
        try {
            List<List<TBlock>> w = new ArrayList<>();
            for (String k : DAY_KEYS) {
                JSONArray arr = days.optJSONArray(k);
                List<TBlock> d = new ArrayList<>();
                if (arr != null) for (int i = 0; i < arr.length(); i++) {
                    JSONObject b = arr.getJSONObject(i);
                    String pid = b.optString("preset", "normal");
                    if (!presets.containsKey(pid)) pid = "normal";
                    d.add(new TBlock(mins(b.optString("start", "00:00")), mins(b.optString("end", "00:00")),
                            b.optString("title", "Block"), pid, b.optString("note", "")));
                }
                sortDay(d);
                w.add(d);
            }
            week.clear();
            week.addAll(w);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    JSONObject writeWeek() throws Exception {
        JSONObject days = new JSONObject();
        for (int i = 0; i < 7; i++) {
            JSONArray arr = new JSONArray();
            for (TBlock b : week.get(i)) {
                JSONObject j = new JSONObject();
                j.put("start", hhmm(b.start)); j.put("end", hhmm(b.end));
                j.put("title", b.title); j.put("preset", b.preset); j.put("note", b.note);
                arr.put(j);
            }
            days.put(DAY_KEYS[i], arr);
        }
        return days;
    }

    public static void sortDay(List<TBlock> d) {
        java.util.Collections.sort(d, new java.util.Comparator<TBlock>() {
            @Override public int compare(TBlock a, TBlock b) { return a.start - b.start; }
        });
    }

    /** The starting week that ships with the app (shared/week.json). */
    void defaultWeek() {
        try {
            java.io.InputStream in = appCtx.getAssets().open("week.json");
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            if (readWeek(new JSONObject(new String(bo.toByteArray(), "UTF-8")))) return;
        } catch (Exception ignored) { }
        week.clear();
        for (int i = 0; i < 7; i++) {
            List<TBlock> d = new ArrayList<>();
            d.add(new TBlock(22 * 60 + 30, 6 * 60 + 30, "Sleep", "strict", "Lights out."));
            week.add(d);
        }
    }

    /** Call after any change to the week: saves and tells the PC. */
    public void scheduleChanged() {
        editedAt = System.currentTimeMillis();
        save();
        Sync.pushState(appCtx);
    }

    /** Takes the PC's week if it's newer than ours. Returns true when something changed. */
    public synchronized boolean applyRemote(JSONObject sc) {
        try {
            if (sc.optInt("v", 1) != 2) return false;
            long at = sc.optLong("editedAt", 0);
            if (at <= editedAt) return false;
            JSONObject days = sc.optJSONObject("days");
            if (days == null || !readWeek(days)) return false;
            JSONObject names = sc.optJSONObject("names");
            if (names != null) for (String id : PRESET_IDS) {
                String n = names.optString(id, null);
                if (n != null && !n.isEmpty()) presets.get(id).name = n;
            }
            editedAt = at;
            save();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Midnight at the start of the day that contains t, moved by addDays. */
    private static Calendar dayStart(long t, int addDays) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(t);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.DAY_OF_MONTH, addDays);
        return c;
    }

    /** Wall-clock time on the given day: daylight saving never shifts a block. */
    private static long at(Calendar day, int minutes) {
        Calendar c = (Calendar) day.clone();
        if (minutes >= 1440) { c.add(Calendar.DAY_OF_MONTH, minutes / 1440); minutes %= 1440; }
        c.set(Calendar.HOUR_OF_DAY, minutes / 60);
        c.set(Calendar.MINUTE, minutes % 60);
        return c.getTimeInMillis();
    }

    /** The blocks of the day that contains t, placed on the clock. */
    public List<Slot> slotsOfDay(long t, int addDays) {
        Calendar day = dayStart(t, addDays);
        int dow = day.get(Calendar.DAY_OF_WEEK) - 1;
        List<Slot> out = new ArrayList<>();
        if (week.size() != 7) return out;
        List<TBlock> d = week.get(dow);
        for (int i = 0; i < d.size(); i++) {
            TBlock b = d.get(i);
            Slot s = new Slot();
            s.title = b.title; s.preset = b.preset; s.note = b.note; s.index = i; s.day = dow;
            s.start = at(day, b.start);
            s.end = at(day, b.end > b.start ? b.end : b.end + 1440);
            out.add(s);
        }
        return out;
    }

    /** Today's blocks. */
    public List<Slot> slots(long now) { return slotsOfDay(now, 0); }

    private List<Slot> around(long now) {
        List<Slot> all = new ArrayList<>();
        all.addAll(slotsOfDay(now, -1));
        all.addAll(slotsOfDay(now, 0));
        all.addAll(slotsOfDay(now, 1));
        return all;
    }

    public Slot current(long now) {
        List<Slot> all = around(now);
        Slot best = null;
        for (Slot s : all) if (now >= s.start && now < s.end && (best == null || s.start > best.start)) best = s;
        if (best != null) return best;
        Slot open = new Slot();
        open.title = "Open time";
        open.preset = "normal";
        open.note = "Nothing is planned right now.";
        open.index = -1;
        long prevEnd = now, nextStart = now + 24 * HOUR;
        for (Slot s : all) {
            if (s.end <= now && (prevEnd == now || s.end > prevEnd)) prevEnd = s.end;
            if (s.start > now && s.start < nextStart) nextStart = s.start;
        }
        open.start = prevEnd < now ? prevEnd : now;
        open.end = nextStart;
        return open;
    }

    public List<Slot> upcoming(long now, int max) {
        List<Slot> out = new ArrayList<>();
        List<Slot> all = around(now);
        java.util.Collections.sort(all, new java.util.Comparator<Slot>() {
            @Override public int compare(Slot a, Slot b) { return Long.compare(a.start, b.start); }
        });
        for (Slot s : all) {
            if (s.start > now) out.add(s);
            if (out.size() >= max) break;
        }
        return out;
    }

    /** When Free time next starts (today or tomorrow), or 0. */
    public long nextFree(long now) {
        for (Slot s : upcoming(now, 60)) if ("free".equals(s.preset)) return s.start;
        Slot c = current(now);
        return "free".equals(c.preset) ? now : 0;
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
        if ("strict".equals(p.id) && Apps.isGuitar(c, pkg)) { d.mode = ALLOW; return d; }
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
