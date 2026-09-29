package forge.harness.wasm;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import forge.deck.Deck;
import forge.game.GameType;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.event.GameEvent;
import forge.game.player.PlayerView;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbilityView;
import forge.gamemodes.match.HostedMatch;
import forge.gamemodes.net.DeltaPacket;
import forge.gamemodes.net.IRemote;
import forge.gamemodes.net.ProtocolGuiGame;
import forge.gamemodes.net.event.GuiGameEvent;
import forge.gamemodes.net.event.IdentifiableNetEvent;
import forge.gamemodes.net.event.NetEvent;
import forge.gui.GuiBase;
import forge.harness.common.HeadlessGuiBase;
import forge.interfaces.IGameController;
import forge.localinstance.properties.ForgePreferences;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.player.LobbyPlayerHuman;
import forge.trackable.TrackableCollection;
import forge.trackable.TrackableProperty;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;

/**
 * Spike entry point: a stock PlayerControllerHuman plays the Forge AI through
 * {@link ProtocolGuiGame}, with the client on the far side of the SharedArrayBuffer.
 * No ManaBrewInteractiveController, no FServerManager server, no Netty.
 *
 * <p>Frames to the page: {@code input} (an Input is waiting: prompt text, buttons, hand)
 * and {@code dialog} (a blocking IGuiGame call with its options). Answers: {@code {"do":"ok"}},
 * {@code {"do":"concede"}}, {@code {"card":id}} or {@code {"index":i}}.
 */
public final class EmbeddedRemoteMain {

    private EmbeddedRemoteMain() {
    }

    /** Headless GUI whose EDT is inline but which does not claim to be the EDT. */
    static final class InlineGui extends HeadlessGuiBase {
        InlineGui(final String assetsDir) {
            super(assetsDir);
        }

        @Override
        public boolean isGuiThread() {
            return false;
        }
    }

    /** State and event counters, plus the delta encoded as JSON to show it needs no Java serialization. */
    static final class Stats {
        int fullStates;
        int deltasWithState;
        int newObjects;
        int changedObjects;
        int rawEvents;
        int wrappedEvents;
        long deltaJsonBytes;
        int inputs;
        int dialogs;
        final List<String> dialogLog = new ArrayList<>();

        JsonObject toJson() {
            final JsonObject o = new JsonObject();
            o.addProperty("fullStates", fullStates);
            o.addProperty("deltasWithState", deltasWithState);
            o.addProperty("newObjects", newObjects);
            o.addProperty("changedObjects", changedObjects);
            o.addProperty("rawEvents", rawEvents);
            o.addProperty("wrappedEvents", wrappedEvents);
            o.addProperty("deltaJsonBytes", deltaJsonBytes);
            o.addProperty("inputs", inputs);
            o.addProperty("dialogs", dialogs);
            final JsonArray log = new JsonArray();
            dialogLog.forEach(log::add);
            o.add("dialogLog", log);
            return o;
        }
    }

    /** IRemote over the SAB: fire-and-forget events stay here, blocking ones cross to the page. */
    static final class SabRemote implements IRemote {
        final Stats stats = new Stats();
        TrackableCollection<PlayerView> myPlayers;
        String lastPrompt = "";
        Object[] lastButtons;

        @Override
        public void send(final NetEvent event) {
            final GuiGameEvent ev = (GuiGameEvent) event;
            final Object[] args = ev.getObjects();
            switch (ev.getMethod()) {
                case openView -> myPlayers = (TrackableCollection<PlayerView>) args[0];
                case setGameView -> stats.fullStates++;
                case applyDelta -> record((DeltaPacket) args[0]);
                case showPromptMessage -> lastPrompt = String.valueOf(args[1]);
                case updateButtons -> lastButtons = args;
                default -> { }
            }
        }

        private void record(final DeltaPacket d) {
            if (!d.getNewObjects().isEmpty() || !d.getObjectDeltas().isEmpty()) {
                stats.deltasWithState++;
                stats.newObjects += d.getNewObjects().size();
                stats.changedObjects += d.getObjectDeltas().size();
                stats.deltaJsonBytes += deltaJson(d).length();
            }
            if (d.hasEvents()) {
                for (final Object o : d.getEvents()) {
                    if (o instanceof GameEvent) {
                        stats.rawEvents++;
                    } else {
                        stats.wrappedEvents++;
                    }
                }
            }
        }

        /** Keyed patch: {"<type>:<id>": {"Prop": value}}. Values the spike does not type go through String.valueOf. */
        private static String deltaJson(final DeltaPacket d) {
            final JsonObject patch = new JsonObject();
            addObjects(patch, d.getNewObjects());
            addObjects(patch, d.getObjectDeltas());
            return patch.toString();
        }

        private static void addObjects(final JsonObject patch, final Map<Integer, Map<TrackableProperty, Object>> objects) {
            for (final Map.Entry<Integer, Map<TrackableProperty, Object>> e : objects.entrySet()) {
                final String key = DeltaPacket.getTypeFromDeltaKey(e.getKey()) + ":" + DeltaPacket.getIdFromDeltaKey(e.getKey());
                final JsonObject props = new JsonObject();
                for (final Map.Entry<TrackableProperty, Object> p : e.getValue().entrySet()) {
                    final Object v = p.getValue();
                    if (v == null) {
                        props.add(p.getKey().name(), null);
                    } else if (v instanceof Number n) {
                        props.addProperty(p.getKey().name(), n);
                    } else if (v instanceof Boolean b) {
                        props.addProperty(p.getKey().name(), b);
                    } else {
                        props.addProperty(p.getKey().name(), String.valueOf(v));
                    }
                }
                patch.add(key, props);
            }
        }

        @Override
        public Object sendAndWait(final IdentifiableNetEvent event) {
            final GuiGameEvent ev = (GuiGameEvent) event;
            final Object[] a = ev.getObjects();
            stats.dialogs++;
            final JsonObject frame = new JsonObject();
            frame.addProperty("frame", "dialog");
            frame.addProperty("method", ev.getMethod().name());
            final JsonArray options = new JsonArray();
            List<?> choices = List.of();
            switch (ev.getMethod()) {
                case getAbilityToPlay -> choices = (List<?>) a[1];
                case getChoices -> choices = (List<?>) a[3];
                default -> { }
            }
            for (final Object c : choices) {
                options.add(c instanceof SpellAbilityView sa ? sa.toString() : String.valueOf(c));
            }
            frame.add("options", options);
            final int index = exchange(frame).get("index").getAsInt();
            final Object answer = switch (ev.getMethod()) {
                case getAbilityToPlay -> choices.get(index);
                case getChoices -> new ArrayList<>(choices.subList(index, index + 1));
                case confirm -> a[2];
                case showConfirmDialog, showOptionDialog -> a[4];
                case showInputDialog -> a[3];
                default -> null;
            };
            stats.dialogLog.add(ev.getMethod() + " -> " + answer);
            return answer;
        }

        JsonObject exchange(final JsonObject frame) {
            frame.add("stats", stats.toJson());
            if (!SabTransport.send(0, frame.toString())) {
                throw new IllegalStateException("frame larger than the buffer");
            }
            return JsonParser.parseString(SabTransport.recv(0)).getAsJsonObject();
        }
    }

    /** The embedded GUI: waits for an Input by asking the page and running its answer in place. */
    static final class SabGui extends ProtocolGuiGame {
        final SabRemote remote;

        SabGui(final SabRemote remote) {
            super(remote);
            this.remote = remote;
        }

        @Override
        public void awaitInput(final CountDownLatch done) {
            while (done.getCount() > 0) {
                final PlayerView owner = (PlayerView) remote.lastButtons[0];
                final IGameController controller = getGameController(owner);
                final GameView gv = getGameView();
                remote.stats.inputs++;
                final JsonObject frame = new JsonObject();
                frame.addProperty("frame", "input");
                frame.addProperty("prompt", remote.lastPrompt);
                frame.addProperty("ok", String.valueOf(remote.lastButtons[1]));
                frame.addProperty("cancel", String.valueOf(remote.lastButtons[2]));
                frame.addProperty("turn", gv.getTurn());
                frame.addProperty("phase", gv.getPhase() == null ? "" : gv.getPhase().name());
                frame.addProperty("myTurn", owner.equals(gv.getPlayerTurn()));
                final JsonArray hand = new JsonArray();
                if (owner.getHand() != null) {
                    for (final CardView c : owner.getHand()) {
                        final JsonObject card = new JsonObject();
                        card.addProperty("id", c.getId());
                        card.addProperty("name", c.getName());
                        hand.add(card);
                    }
                }
                frame.add("hand", hand);
                frame.addProperty("battlefield", owner.getBattlefield() == null ? 0 : owner.getBattlefield().size());
                final JsonObject answer = remote.exchange(frame);
                if (answer.has("card")) {
                    final int id = answer.get("card").getAsInt();
                    CardView pick = null;
                    for (final CardView c : owner.getHand()) {
                        if (c.getId() == id) {
                            pick = c;
                        }
                    }
                    controller.selectCard(pick, null, null);
                } else {
                    switch (answer.get("do").getAsString()) {
                        case "concede" -> controller.concede();
                        case "cancel" -> controller.selectButtonCancel();
                        default -> controller.selectButtonOk();
                    }
                }
            }
        }
    }

    public static void main(final String[] args) throws Exception {
        System.setProperty("forge.synchronous", "true");
        System.setProperty("user.home", "/forge-home");
        prepareHome();
        // tinylog resolves the caller class for {class-name} and per-package levels by walking
        // the stack, which Web Image cannot do. A warn floor with a plain format never needs it.
        final Path tinylog = Path.of("/forge-home", "tinylog.properties");
        Files.writeString(tinylog, "writer = console\nwriter.level = warn\nwriter.format = [{level}] {message}\n");
        System.setProperty("tinylog.configuration", tinylog.toString());
        final long t0 = System.currentTimeMillis();
        loadEmbeddedAssets();

        GuiBase.setInterface(new InlineGui("/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(ForgePreferences.FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(ForgePreferences.FPref.DECKGEN_CARDBASED, false);
            prefs.setPref(ForgePreferences.FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, false);
            return null;
        });
        System.out.println("[embedded] forge initialized in " + (System.currentTimeMillis() - t0) + "ms");

        SabTransport.bind();
        final SabRemote remote = new SabRemote();
        final SabGui gui = new SabGui(remote);

        final Deck humanDeck = new Deck("Embedded");
        humanDeck.getMain().add("Drifting Meadow", 40);
        final Deck aiDeck = new Deck("AI");
        aiDeck.getMain().add("Plains", 40);
        final RegisteredPlayer human = new RegisteredPlayer(humanDeck).setPlayer(new LobbyPlayerHuman("Embedded"));
        final RegisteredPlayer ai = new RegisteredPlayer(aiDeck).setPlayer(GamePlayerUtil.createAiPlayer("AI"));

        final long g0 = System.currentTimeMillis();
        final HostedMatch match = new HostedMatch();
        // forge.synchronous runs the match inline: this returns when the game is over
        match.startMatch(GameType.Constructed, null, List.of(human, ai), human, gui);

        final PlayerView me = remote.myPlayers.iterator().next();
        final JsonObject done = remote.stats.toJson();
        done.addProperty("gameOver", match.getGameView() != null && match.getGameView().isGameOver());
        done.addProperty("battlefield", me.getBattlefield() == null ? 0 : me.getBattlefield().size());
        done.addProperty("gameMs", System.currentTimeMillis() - g0);
        System.out.println("[embedded] done " + done);
        SabTransport.post("spike:done", done.toString());
    }

    private static void prepareHome() throws Exception {
        final Path preferences = Path.of("/forge-home", ".forge", "preferences");
        Files.createDirectories(preferences);
        final String emptyXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<preferences/>\n";
        Files.writeString(preferences.resolve("card.preferences"), emptyXml);
        Files.writeString(preferences.resolve("deck.preferences"), emptyXml);
        Files.writeString(preferences.resolve("item_view.preferences"), emptyXml);
        Files.writeString(preferences.resolve("forge.preferences"), "");
    }

    /** Same framing as WasmMain: name NUL body NUL, repeated. */
    private static void loadEmbeddedAssets() throws Exception {
        try (InputStream raw = EmbeddedRemoteMain.class.getResourceAsStream("/assets-framed.txt")) {
            if (raw == null) {
                throw new IllegalStateException("assets-framed.txt missing from the module");
            }
            final Path root = Path.of("/forge-gui");
            final ByteArrayOutputStream segment = new ByteArrayOutputStream(1 << 16);
            final byte[] chunk = new byte[1 << 16];
            String name = null;
            int read;
            while ((read = raw.read(chunk)) != -1) {
                int start = 0;
                for (int i = 0; i < read; i++) {
                    if (chunk[i] != 0) {
                        continue;
                    }
                    segment.write(chunk, start, i - start);
                    start = i + 1;
                    if (name == null) {
                        name = segment.toString(StandardCharsets.UTF_8);
                    } else {
                        final Path target = root.resolve(name);
                        Files.createDirectories(target.getParent());
                        Files.write(target, segment.toByteArray());
                        name = null;
                    }
                    segment.reset();
                }
                segment.write(chunk, start, read - start);
            }
        }
    }
}
