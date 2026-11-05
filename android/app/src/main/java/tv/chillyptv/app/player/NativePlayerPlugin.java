package tv.chillyptv.app.player;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Full-screen native playback (Media3 ExoPlayer) for Fire TV: plays HLS, MPEG-TS, MP4 and MKV with
 * AC3/EAC3 passthrough and every subtitle type, and is driven by the remote.
 *
 * JS: NativePlayer.play({ items: [{ id, url, title, subtitle, backups }], index, live, startAt,
 * userAgent, preferredAudioLang, preferredSubLang, autoplayNext })
 * resolves when the player closes with { index, id, position, duration, ended }.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        try {
            JSArray items = call.getArray("items");
            if (items == null || items.length() == 0) {
                call.reject("Nothing to play");
                return;
            }
            ArrayList<PlayQueue.Item> list = new ArrayList<>();
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.getJSONObject(i);
                PlayQueue.Item it = new PlayQueue.Item();
                it.id = o.optString("id", String.valueOf(i));
                it.url = o.getString("url");
                it.title = o.optString("title", "");
                it.subtitle = o.optString("subtitle", "");
                JSONArray b = o.optJSONArray("backups");
                if (b != null) for (int j = 0; j < b.length(); j++) it.backups.add(b.getString(j));
                list.add(it);
            }
            PlayQueue.items = list;
            PlayQueue.index = Math.max(0, Math.min(list.size() - 1, call.getInt("index", 0)));
            PlayQueue.live = call.getBoolean("live", false);
            PlayQueue.startAtMs = (long) (call.getDouble("startAt", 0.0) * 1000);
            PlayQueue.userAgent = call.getString("userAgent");
            PlayQueue.preferredAudioLang = call.getString("preferredAudioLang");
            PlayQueue.preferredSubLang = call.getString("preferredSubLang");
            PlayQueue.autoplayNext = call.getBoolean("autoplayNext", true);
            Intent intent = new Intent(getContext(), PlayerActivity.class);
            startActivityForResult(call, intent, "playerClosed");
        } catch (Exception e) {
            call.reject("Could not start the player: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void playerClosed(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        int index = data != null ? data.getIntExtra("index", PlayQueue.index) : PlayQueue.index;
        ret.put("index", index);
        ret.put("id", index < PlayQueue.items.size() ? PlayQueue.items.get(index).id : null);
        ret.put("position", data != null ? data.getLongExtra("position", 0) / 1000.0 : 0);
        ret.put("duration", data != null ? data.getLongExtra("duration", 0) / 1000.0 : 0);
        ret.put("ended", data != null && data.getBooleanExtra("ended", false));
        call.resolve(ret);
    }
}
