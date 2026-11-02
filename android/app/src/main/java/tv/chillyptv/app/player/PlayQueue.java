package tv.chillyptv.app.player;

import java.util.ArrayList;
import java.util.List;

/**
 * What the player plays, handed over in memory: a zap list can hold thousands of channels,
 * which is far beyond what an Intent can carry.
 */
public final class PlayQueue {
    public static final class Item {
        public String id;
        public String url;
        public String title;
        public String subtitle;
        /** Other feeds of the same event, tried in order when this one fails. */
        public List<String> backups = new ArrayList<>();
    }

    public static List<Item> items = new ArrayList<>();
    public static int index = 0;
    public static boolean live = false;
    public static long startAtMs = 0;
    public static String userAgent = null;
    public static String preferredAudioLang = null;
    public static String preferredSubLang = null;
    /** Movies and episodes: continue with the next item when one ends. */
    public static boolean autoplayNext = true;

    private PlayQueue() {}
}
