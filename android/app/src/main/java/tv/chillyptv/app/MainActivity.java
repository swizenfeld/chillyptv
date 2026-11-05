package tv.chillyptv.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import tv.chillyptv.app.guide.NativeGuidePlugin;
import tv.chillyptv.app.player.NativePlayerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(NativeGuidePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
