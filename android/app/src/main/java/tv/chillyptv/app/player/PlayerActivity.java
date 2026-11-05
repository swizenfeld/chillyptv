package tv.chillyptv.app.player;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.PlayerView;
import java.util.Locale;

/**
 * Full-screen player for the remote:
 * - Live: Up/Down (and Channel +/-) change channel, OK shows the controls, Back closes.
 * - Movies/episodes: Left/Right skip 10 s back / 30 s ahead, OK shows the controls (with the
 *   audio and subtitle choices), Back closes.
 * A stream that fails is retried once (live), then the next backup feed of the same event is tried.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private TextView banner;
    private TextView status;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private int index;
    /** Which URL of the current item is playing: 0 = its own, 1.. = its backups. */
    private int feed = 0;
    private int retries = 0;
    private boolean ended = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        index = PlayQueue.index;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        view = new PlayerView(this);
        view.setShowSubtitleButton(true);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setControllerShowTimeoutMs(4000);
        view.setKeepScreenOn(true);
        root.addView(view, new FrameLayout.LayoutParams(-1, -1));

        banner = overlay(Gravity.TOP | Gravity.START, 22);
        root.addView(banner, overlayParams(Gravity.TOP | Gravity.START));
        status = overlay(Gravity.CENTER, 20);
        root.addView(status, overlayParams(Gravity.CENTER));
        setContentView(root);

        DefaultTrackSelector selector = new DefaultTrackSelector(this);
        DefaultTrackSelector.Parameters.Builder params = selector.buildUponParameters();
        if (!TextUtils.isEmpty(PlayQueue.preferredAudioLang)) params.setPreferredAudioLanguage(PlayQueue.preferredAudioLang);
        if (!TextUtils.isEmpty(PlayQueue.preferredSubLang)) params.setPreferredTextLanguage(PlayQueue.preferredSubLang);
        selector.setParameters(params);

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000);
        if (!TextUtils.isEmpty(PlayQueue.userAgent)) http.setUserAgent(PlayQueue.userAgent);
        DefaultExtractorsFactory extractors = new DefaultExtractorsFactory()
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS);
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableDecoderFallback(true);

        player = new ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http, extractors))
            .setTrackSelector(selector)
            .build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                onFailed(error);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    retries = 0;
                    status.setVisibility(View.GONE);
                } else if (state == Player.STATE_BUFFERING) {
                    showStatus("Loading…", 0);
                } else if (state == Player.STATE_ENDED) {
                    if (!PlayQueue.live && PlayQueue.autoplayNext && index + 1 < PlayQueue.items.size()) {
                        index++;
                        load(0);
                    } else {
                        ended = true;
                        finishWithResult();
                    }
                }
            }
        });
        load(PlayQueue.startAtMs);
    }

    private TextView overlay(int gravity, int sp) {
        TextView t = new TextView(this);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setGravity(gravity);
        int pad = dp(16);
        t.setPadding(pad, dp(10), pad, dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xCC000000);
        bg.setCornerRadius(dp(12));
        t.setBackground(bg);
        t.setVisibility(View.GONE);
        t.setMaxLines(3);
        t.setEllipsize(TextUtils.TruncateAt.END);
        return t;
    }

    private FrameLayout.LayoutParams overlayParams(int gravity) {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, gravity);
        int m = dp(40);
        lp.setMargins(m, dp(32), m, dp(32));
        return lp;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private PlayQueue.Item current() {
        return PlayQueue.items.get(index);
    }

    /** Plays the current item (its own URL, or backup `feed`) from `startMs`. */
    private void load(long startMs) {
        PlayQueue.Item it = current();
        String url = feed == 0 ? it.url : it.backups.get(feed - 1);
        MediaItem.Builder b = new MediaItem.Builder().setUri(Uri.parse(url)).setMediaId(it.id);
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.contains(".m3u8")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        if (PlayQueue.live) b.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(8_000).build());
        player.setMediaItem(b.build(), startMs > 0 ? startMs : C.TIME_UNSET);
        player.prepare();
        player.setPlayWhenReady(true);
        showBanner();
    }

    private void showBanner() {
        PlayQueue.Item it = current();
        String text = it.title + (TextUtils.isEmpty(it.subtitle) ? "" : "\n" + it.subtitle);
        if (feed > 0) text += "\nBackup feed " + feed;
        banner.setText(text);
        banner.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideBanner);
        ui.postDelayed(hideBanner, 4000);
    }

    private final Runnable hideBanner = () -> banner.setVisibility(View.GONE);

    private void showStatus(String text, long hideAfterMs) {
        status.setText(text);
        status.setVisibility(View.VISIBLE);
        if (hideAfterMs > 0) ui.postDelayed(() -> status.setVisibility(View.GONE), hideAfterMs);
    }

    private void onFailed(PlaybackException error) {
        // A live stream that fell behind its window just restarts at the live edge.
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }
        PlayQueue.Item it = current();
        if (PlayQueue.live && retries < 1) {
            retries++;
            showStatus("Reconnecting…", 0);
            ui.postDelayed(() -> load(0), 2000);
            return;
        }
        if (feed < it.backups.size()) {
            feed++;
            retries = 0;
            showStatus("Stream stopped. Switching to backup feed " + feed + "…", 3000);
            load(PlayQueue.live ? 0 : player.getCurrentPosition());
            return;
        }
        showStatus("Couldn’t play this stream (" + error.getErrorCodeName().replace("ERROR_CODE_", "").toLowerCase(Locale.ROOT).replace('_', ' ') + ")." + (PlayQueue.live ? "\nUp/Down for another channel, Back to close." : "\nBack to close."), 0);
    }

    /** Live zapping: next/previous item in the queue. */
    private void zap(int dir) {
        int n = PlayQueue.items.size();
        if (n < 2) return;
        index = (index + dir + n) % n;
        feed = 0;
        retries = 0;
        status.setVisibility(View.GONE);
        load(0);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(e);
        int k = e.getKeyCode();
        boolean controls = view.isControllerFullyVisible();
        if (k == KeyEvent.KEYCODE_BACK) {
            if (controls) view.hideController();
            else finishWithResult();
            return true;
        }
        if (k == KeyEvent.KEYCODE_CHANNEL_UP || k == KeyEvent.KEYCODE_PAGE_UP) {
            zap(-1);
            return true;
        }
        if (k == KeyEvent.KEYCODE_CHANNEL_DOWN || k == KeyEvent.KEYCODE_PAGE_DOWN) {
            zap(1);
            return true;
        }
        if (!controls) {
            switch (k) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    if (PlayQueue.live) { zap(-1); return true; }
                    break;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    if (PlayQueue.live) { zap(1); return true; }
                    break;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    if (!PlayQueue.live) { player.seekTo(Math.max(0, player.getCurrentPosition() - 10_000)); showBanner(); return true; }
                    break;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    if (!PlayQueue.live) { player.seekTo(player.getCurrentPosition() + 30_000); showBanner(); return true; }
                    break;
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                    player.setPlayWhenReady(!player.getPlayWhenReady());
                    view.showController();
                    return true;
                case KeyEvent.KEYCODE_INFO:
                case KeyEvent.KEYCODE_MENU:
                    showBanner();
                    view.showController();
                    return true;
                default:
                    break;
            }
        }
        return super.dispatchKeyEvent(e);
    }

    private void finishWithResult() {
        Intent data = new Intent();
        data.putExtra("index", index);
        data.putExtra("position", player != null ? player.getCurrentPosition() : 0);
        long d = player != null ? player.getDuration() : 0;
        data.putExtra("duration", d == C.TIME_UNSET ? 0 : d);
        data.putExtra("ended", ended);
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Leaving the app (Home button) stops the stream so the provider connection is freed.
        if (player != null && !isFinishing()) player.pause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
