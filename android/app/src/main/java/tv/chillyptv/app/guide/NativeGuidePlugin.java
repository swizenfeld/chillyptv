package tv.chillyptv.app.guide;

import android.util.Xml;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.zip.GZIPInputStream;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

/**
 * Reads XMLTV guides on the device. A provider guide can be 90 MB, too big to hand to the web view
 * in one piece, so it is read in two passes over a cached copy:
 *  scan({ url, userAgent })                 → { file, channels: [{id, name, icon}], counts: {id: n} }
 *  programmes({ file, ids, from, to })      → { json: '{"<id>": [[start, stop, title, desc, sub, cat, ep]…]}' }
 * The app picks the guide channels its playlist needs between the two (same matching as the server).
 */
@CapacitorPlugin(name = "NativeGuide")
public class NativeGuidePlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        String url = call.getString("url");
        String ua = call.getString("userAgent");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        new Thread(() -> {
            try {
                File file = new File(getContext().getCacheDir(), "guide-" + Integer.toHexString(url.hashCode()) + ".xml");
                download(url, ua, file);
                JSONArray channels = new JSONArray();
                JSONObject counts = new JSONObject();
                Map<String, Integer> n = new HashMap<>();
                try (InputStream in = new BufferedInputStream(new FileInputStream(file), 1 << 16)) {
                    XmlPullParser p = Xml.newPullParser();
                    p.setInput(in, null);
                    for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                        if (ev != XmlPullParser.START_TAG) continue;
                        String tag = p.getName();
                        if ("channel".equals(tag)) {
                            channels.put(readChannel(p));
                        } else if ("programme".equals(tag)) {
                            String ch = p.getAttributeValue(null, "channel");
                            if (ch != null) n.put(ch, n.getOrDefault(ch, 0) + 1);
                        }
                    }
                }
                for (Map.Entry<String, Integer> e : n.entrySet()) counts.put(e.getKey(), e.getValue());
                JSObject ret = new JSObject();
                ret.put("file", file.getAbsolutePath());
                ret.put("channels", channels);
                ret.put("counts", counts);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }, "guide-scan").start();
    }

    @PluginMethod
    public void programmes(PluginCall call) {
        String path = call.getString("file");
        long from = call.getLong("from", 0L);
        long to = call.getLong("to", Long.MAX_VALUE);
        Set<String> ids = new HashSet<>();
        try {
            org.json.JSONArray arr = call.getArray("ids");
            for (int i = 0; arr != null && i < arr.length(); i++) ids.add(arr.getString(i));
        } catch (Exception e) {
            call.reject("Bad ids");
            return;
        }
        if (path == null) {
            call.reject("Missing file");
            return;
        }
        new Thread(() -> {
            try (InputStream in = new BufferedInputStream(new FileInputStream(path), 1 << 16)) {
                Map<String, JSONArray> out = new HashMap<>();
                XmlPullParser p = Xml.newPullParser();
                p.setInput(in, null);
                for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                    if (ev != XmlPullParser.START_TAG || !"programme".equals(p.getName())) continue;
                    String ch = p.getAttributeValue(null, "channel");
                    if (ch == null || !ids.contains(ch)) continue;
                    long start = time(p.getAttributeValue(null, "start"));
                    long stop = time(p.getAttributeValue(null, "stop"));
                    if (start <= 0 || stop <= 0 || stop < from || start > to) continue;
                    JSONArray t = readProgramme(p, start, stop);
                    if (t == null) continue;
                    JSONArray list = out.get(ch);
                    if (list == null) out.put(ch, list = new JSONArray());
                    list.put(t);
                }
                JSONObject json = new JSONObject();
                for (Map.Entry<String, JSONArray> e : out.entrySet()) json.put(e.getKey(), e.getValue());
                JSObject ret = new JSObject();
                ret.put("json", json.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }, "guide-programmes").start();
    }

    /** Downloads to `file`, unpacking gzip; follows redirects across http/https. */
    private static void download(String url, String ua, File file) throws IOException {
        HttpURLConnection c = null;
        for (int hop = 0; hop < 6; hop++) {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20_000);
            c.setReadTimeout(60_000);
            if (ua != null && !ua.isEmpty()) c.setRequestProperty("User-Agent", ua);
            c.setRequestProperty("Accept-Encoding", "gzip");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                c.disconnect();
                continue;
            }
            if (code != 200) {
                c.disconnect();
                throw new IOException("EPG download failed: HTTP " + code);
            }
            break;
        }
        File tmp = new File(file.getPath() + ".part");
        try (InputStream raw = new BufferedInputStream(c.getInputStream(), 1 << 16); OutputStream out = new FileOutputStream(tmp)) {
            raw.mark(4);
            int b1 = raw.read();
            int b2 = raw.read();
            raw.reset();
            InputStream in = (b1 == 0x1f && b2 == 0x8b) ? new GZIPInputStream(raw, 1 << 16) : raw;
            byte[] buf = new byte[1 << 16];
            for (int r; (r = in.read(buf)) > 0; ) out.write(buf, 0, r);
        } finally {
            c.disconnect();
        }
        if (!tmp.renameTo(file)) throw new IOException("Could not save the guide");
    }

    private static JSONObject readChannel(XmlPullParser p) throws Exception {
        JSONObject ch = new JSONObject();
        ch.put("id", p.getAttributeValue(null, "id"));
        int depth = p.getDepth();
        String name = null;
        String icon = null;
        for (int ev = p.next(); !(ev == XmlPullParser.END_TAG && p.getDepth() == depth); ev = p.next()) {
            if (ev != XmlPullParser.START_TAG) continue;
            if ("display-name".equals(p.getName()) && name == null) name = p.nextText().trim();
            else if ("icon".equals(p.getName()) && icon == null) icon = p.getAttributeValue(null, "src");
        }
        ch.put("name", name != null ? name : ch.optString("id"));
        if (icon != null) ch.put("icon", icon);
        return ch;
    }

    private static JSONArray readProgramme(XmlPullParser p, long start, long stop) throws Exception {
        int depth = p.getDepth();
        String title = null, desc = null, sub = null, cat = null, ep = null;
        for (int ev = p.next(); !(ev == XmlPullParser.END_TAG && p.getDepth() == depth); ev = p.next()) {
            if (ev != XmlPullParser.START_TAG) continue;
            switch (p.getName()) {
                case "title": if (title == null) title = p.nextText().trim(); break;
                case "desc": if (desc == null) desc = p.nextText().trim(); break;
                case "sub-title": if (sub == null) sub = p.nextText().trim(); break;
                case "category": if (cat == null) cat = p.nextText().trim(); break;
                case "episode-num": if (ep == null) ep = p.nextText().trim(); break;
                default: break;
            }
        }
        if (title == null || title.isEmpty()) return null;
        JSONArray t = new JSONArray();
        t.put(start).put(stop).put(title);
        if (desc != null || sub != null || cat != null || ep != null) {
            t.put(desc != null ? desc : "").put(sub != null ? sub : "").put(cat != null ? cat : "").put(ep != null ? ep : "");
        }
        return t;
    }

    private static final ThreadLocal<SimpleDateFormat> WITH_ZONE = ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyyMMddHHmmss Z", Locale.US));
    private static final ThreadLocal<SimpleDateFormat> NO_ZONE = ThreadLocal.withInitial(() -> {
        SimpleDateFormat f = new SimpleDateFormat("yyyyMMddHHmmss", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f;
    });

    /** XMLTV time ("20261101123000 +0000", or without zone = UTC) → epoch ms; 0 if unreadable. */
    static long time(String s) {
        if (s == null) return 0;
        s = s.trim();
        try {
            if (s.length() > 15) return WITH_ZONE.get().parse(s).getTime();
            return NO_ZONE.get().parse(s.substring(0, Math.min(14, s.length()))).getTime();
        } catch (ParseException | IndexOutOfBoundsException e) {
            return 0;
        }
    }
}
