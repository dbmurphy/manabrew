package forge.harness.embedded;

import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameEntityView;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardView;
import forge.game.event.GameEvent;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.input.Input;
import forge.gamemodes.match.input.InputAttack;
import forge.gamemodes.match.input.InputBlock;
import forge.gamemodes.match.input.InputConfirm;
import forge.gamemodes.match.input.InputConfirmMulligan;
import forge.gamemodes.match.input.InputLondonMulligan;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gamemodes.match.input.InputPayMana;
import forge.gamemodes.match.input.InputSelectCardsForConvokeOrImprovise;
import forge.gamemodes.match.input.InputSelectEntitiesFromList;
import forge.gamemodes.match.input.InputSelectTargets;
import forge.gamemodes.net.IRemote;
import forge.gamemodes.net.ProtocolGuiGame;
import forge.gamemodes.net.event.GuiGameEvent;
import forge.gamemodes.net.event.IdentifiableNetEvent;
import forge.gamemodes.net.event.NetEvent;
import forge.gui.control.GameEventForwarder;
import forge.gui.interfaces.IGuiGame;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.util.FSerializableFunction;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.WeakHashMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The GUI of an {@link EmbeddedHumanController}, in the same process and on the game thread. A waiting
 * Input is answered by its seat and replayed as clicks; the dialogs PlayerControllerHuman still raises
 * (from targeting and cost payment) arrive as protocol events and go to the seat too.
 */
public final class EmbeddedHumanGui extends ProtocolGuiGame {

    public static final Map<String, AtomicInteger> COVERAGE = new ConcurrentHashMap<>();
    private static final boolean TRACE = Boolean.getBoolean("forge.embeddedHumanTrace");
    private static final int MAX_PUMPS_PER_INPUT = 40;

    static {
        Runtime.getRuntime().addShutdownHook(new Thread(() ->
                System.err.println("[embedded-human] coverage " + new TreeMap<>(COVERAGE) + " read " + InputAccess.READ)));
    }

    private final EmbeddedHumanController pch;
    private final HumanSeat seat;
    private final Player player;
    private final Game game;
    private final Remote remote;
    private final Map<Input, Integer> pumpsByInput = new WeakHashMap<>();
    private int sameInputPumps;

    private EmbeddedHumanGui(final Remote remote, final EmbeddedHumanController pch) {
        super(remote);
        this.remote = remote;
        remote.gui = this;
        this.pch = pch;
        this.seat = pch.seat();
        this.player = pch.getPlayer();
        this.game = pch.getGame();
    }

    /** The per-human half of HostedMatch.startGame. */
    public static void attach(final Game game) {
        for (final Player p : game.getPlayers()) {
            if (p.getController() instanceof EmbeddedHumanController pch) {
                final EmbeddedHumanGui gui = new EmbeddedHumanGui(new Remote(), pch);
                pch.setGui(gui);
                gui.setGameView(null);
                gui.setGameView(game.getView());
                gui.setOriginalGameController(p.getView(), pch);
                gui.setForwarder(new GameEventForwarder(gui));
                // Desktop pacing sleeps on every auto-passed phase. Global: the per-controller override
                // is replaced whenever yield state is restored.
                FModel.getPreferences().setPref(FPref.YIELD_SKIP_PHASE_DELAY, true);
                FModel.getPreferences().setPref(FPref.YIELD_SKIP_RESOLVE_DELAY, true);
                FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, false);
            }
        }
    }

    static void count(final String kind) {
        COVERAGE.computeIfAbsent(kind, k -> new AtomicInteger()).incrementAndGet();
    }

    @Override
    public void updateGameView() {
    }

    @Override
    public void handleGameEvents(final List<GameEvent> events) {
    }

    @Override
    public void awaitInput(final CountDownLatch done) {
        while (done.getCount() > 0) {
            if (seat.closed() || game.isGameOver()) {
                return;
            }
            final Input input = pch.getInputQueue().getInput();
            if (input == null) {
                Thread.onSpinWait();
                continue;
            }
            // Per Input object: a nested Input must not reset the count of the one it interrupted
            sameInputPumps = pumpsByInput.merge(input, 1, Integer::sum) - 1;
            if (sameInputPumps > MAX_PUMPS_PER_INPUT) {
                throw new IllegalStateException("[embedded-human] input never finished: "
                        + input.getClass().getSimpleName() + " prompt=" + remote.lastPrompt);
            }
            if (TRACE) {
                System.err.println("[embedded-human] input " + input.getClass().getSimpleName() + " pumps=" + sameInputPumps
                        + " phase=" + game.getPhaseHandler().getPhase() + " prompt=" + remote.lastPrompt.replace('\n', ' '));
            }
            answer(input, done);
        }
    }

    private void answer(final Input input, final CountDownLatch done) {
        if (input instanceof InputPassPriority priority) {
            priority(priority);
        } else if (input instanceof InputConfirmMulligan) {
            count("input:mulligan");
            if (seat.keepHand(player.getStats().getMulliganCount())) {
                pch.selectButtonOk();
            } else {
                pch.selectButtonCancel();
            }
        } else if (input instanceof InputLondonMulligan) {
            count("input:londonBottom");
            final int n = InputAccess.field(input, "toReturn");
            clickCards(seat.bottom(new CardCollection(player.getCardsIn(ZoneType.Hand)), n), done);
            ok(done);
        } else if (input instanceof InputSelectTargets) {
            targets(input, done);
        } else if (input instanceof InputSelectCardsForConvokeOrImprovise) {
            convoke(input, done);
        } else if (input instanceof InputPayMana pay) {
            mana(pay, done);
        } else if (input instanceof InputAttack) {
            attack(done);
        } else if (input instanceof InputBlock) {
            block(done);
        } else if (input instanceof InputConfirm) {
            count("input:confirm");
            if (seat.confirm(pch.context(), remote.lastPrompt, buttonLabels())) {
                pch.selectButtonOk();
            } else {
                pch.selectButtonCancel();
            }
        } else if (input instanceof InputSelectEntitiesFromList<?> list) {
            entities(list, done);
        } else {
            count("fallback:" + input.getClass().getSimpleName());
            System.err.println("[embedded-human] no answer for " + input.getClass().getSimpleName() + ": " + remote.lastPrompt);
            if (remote.lastButtons != null && Boolean.TRUE.equals(remote.lastButtons[3])) {
                pch.selectButtonOk();
            } else {
                pch.selectButtonCancel();
            }
        }
    }

    private List<String> buttonLabels() {
        return remote.lastButtons == null ? null
                : List.of(String.valueOf(remote.lastButtons[1]), String.valueOf(remote.lastButtons[2]));
    }

    private void priority(final InputPassPriority input) {
        count("input:priority");
        if (seat.priority() instanceof HumanSeat.Priority.Play play) {
            input.selectAbility(play.ability());
        } else {
            input.selectButtonOK();
        }
    }

    private void targets(final Input input, final CountDownLatch done) {
        count("input:targets");
        final SpellAbility sa = InputAccess.field(input, "sa");
        final boolean mandatory = InputAccess.field(input, "mandatory");
        final List<GameEntity> valid = new ArrayList<>();
        final Map<String, Boolean> seen = new HashMap<>();
        for (final GameEntity candidate : sa.getTargetRestrictions().getAllCandidates(sa, false)) {
            if (sa.canTarget(candidate) && !sa.getTargets().contains(candidate)
                    && seen.putIfAbsent(candidate.getClass().getSimpleName() + candidate.getId(), true) == null) {
                valid.add(candidate);
            }
        }
        if (valid.isEmpty()) {
            if (sa.isMinTargetChosen()) {
                ok(done);
            } else {
                pch.selectButtonCancel();
            }
            return;
        }
        final HumanSeat.Target answer = seat.target(sa, valid, mandatory && !sa.isMinTargetChosen());
        if (answer instanceof HumanSeat.Target.Pick pick) {
            click(pick.entity());
        } else if (answer instanceof HumanSeat.Target.Done) {
            ok(done);
        } else {
            pch.selectButtonCancel();
        }
    }

    private void mana(final InputPayMana input, final CountDownLatch done) {
        count("input:mana");
        final SpellAbility paidFor = InputAccess.field(input, "saPaidFor");
        final ManaCostBeingPaid cost = InputAccess.field(input, "manaCost");
        final boolean mandatory = InputAccess.field(input, "mandatory");
        final List<SpellAbility> sources = new ArrayList<>();
        for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
            sources.addAll(input.getUsefulManaAbilities(card));
        }
        final HumanSeat.Payment answer = seat.payMana(paidFor, cost, sources, List.of(), !mandatory);
        if (answer instanceof HumanSeat.Payment.Tap tap) {
            pch.carryOutPayment(tap.manaAbility(), () -> pch.selectCard(tap.manaAbility().getHostCard().getView(), null, null));
        } else if (answer instanceof HumanSeat.Payment.Pay) {
            pch.carryOutPayment(null, () -> ok(done));
        } else if (answer instanceof HumanSeat.Payment.Cancel) {
            pch.selectButtonCancel();
        } else {
            throw new IllegalStateException("not a mana payment: " + answer);
        }
    }

    private void convoke(final Input input, final CountDownLatch done) {
        count("input:convoke");
        final SpellAbility sa = pch.context().sa();
        final ManaCostBeingPaid cost = InputAccess.field(input, "remainingCost");
        final CardCollectionView available = InputAccess.field(input, "availableCards");
        final List<Card> untapped = new ArrayList<>();
        final java.util.Collection<Card> chosen = ((InputSelectCardsForConvokeOrImprovise) input).getSelected();
        for (final Card c : available) {
            if (!chosen.contains(c)) {
                untapped.add(c);
            }
        }
        final HumanSeat.Payment answer = seat.payMana(sa, cost, List.of(), untapped, true);
        if (answer instanceof HumanSeat.Payment.Convoke convoke) {
            pch.selectCard(convoke.card().getView(), null, null);
        } else if (answer instanceof HumanSeat.Payment.Pay) {
            ok(done);
        } else if (answer instanceof HumanSeat.Payment.Cancel) {
            pch.selectButtonCancel();
        } else {
            throw new IllegalStateException("not a convoke payment: " + answer);
        }
    }

    private void attack(final CountDownLatch done) {
        count("input:attack");
        final var combat = game.getCombat();
        final List<Pair<Card, GameEntity>> declared = seat.declareAttackers(combat);
        // Clicks toggle: a retry after a rejected declaration starts from none
        for (final Card attacker : new ArrayList<>(combat.getAttackers())) {
            if (attacker.getController() == player) {
                combat.removeFromCombat(attacker);
            }
        }
        for (final Pair<Card, GameEntity> assignment : declared) {
            if (done.getCount() == 0) {
                return;
            }
            click(assignment.getRight());
            pch.selectCard(assignment.getLeft().getView(), null, null);
        }
        ok(done);
    }

    private void block(final CountDownLatch done) {
        count("input:block");
        final var combat = game.getCombat();
        final String error = sameInputPumps > 0 ? remote.lastError : null;
        remote.lastError = null;
        final List<Pair<Card, Card>> declared = seat.declareBlockers(combat, error);
        for (final Card blocker : new ArrayList<>(combat.getAllBlockers())) {
            if (blocker.getController() == player) {
                combat.removeFromCombat(blocker);
            }
        }
        for (final Pair<Card, Card> assignment : declared) {
            if (done.getCount() == 0) {
                return;
            }
            pch.selectCard(assignment.getRight().getView(), null, null);
            pch.selectCard(assignment.getLeft().getView(), null, null);
        }
        ok(done);
    }

    private void entities(final InputSelectEntitiesFromList<?> input, final CountDownLatch done) {
        final List<GameEntity> valid = new ArrayList<>(input.getValidChoices());
        final int min = InputAccess.field(input, "min");
        final int max = InputAccess.field(input, "max");
        if (valid.stream().allMatch(e -> e instanceof Card)) {
            count("input:cards");
            final List<Card> cards = new ArrayList<>();
            valid.forEach(e -> cards.add((Card) e));
            clickCards(seat.chooseCards(pch.context(), remote.lastPrompt, cards, min, max), done);
        } else {
            count("input:entities");
            for (final int index : seat.choose(pch.context(), remote.lastPrompt, labels(valid, null), min, max)) {
                if (done.getCount() == 0) {
                    return;
                }
                click(valid.get(index));
            }
        }
        ok(done);
    }

    private void clickCards(final Iterable<Card> cards, final CountDownLatch done) {
        for (final Card card : cards) {
            if (done.getCount() == 0) {
                return;
            }
            pch.selectCard(card.getView(), null, null);
        }
    }

    private void click(final GameEntity entity) {
        if (entity instanceof Player p) {
            pch.selectPlayer(p.getView(), null);
        } else if (entity instanceof Card c) {
            pch.selectCard(c.getView(), null, null);
        }
    }

    private void ok(final CountDownLatch done) {
        if (done.getCount() > 0) {
            pch.selectButtonOk();
        }
    }

    private Card card(final Object view) {
        return view instanceof CardView cv ? pch.getCard(cv) : null;
    }

    private GameEntity entity(final Object view) {
        if (view instanceof CardView cv) {
            return pch.getCard(cv);
        }
        return view instanceof PlayerView pv ? game.getPlayer(pv) : null;
    }

    private static List<String> labels(final List<?> options, final FSerializableFunction<Object, String> display) {
        final List<String> labels = new ArrayList<>();
        for (final Object o : options) {
            labels.add(display != null ? display.apply(o)
                    : o instanceof GameEntityView g ? g.getName()
                    : o instanceof GameEntity e ? e.getName()
                    : String.valueOf(o));
        }
        return labels;
    }

    /** Cards the game knows, or null when any option is something else (a pile, a card outside the game). */
    private List<Card> cardsOf(final List<?> views) {
        if (views.isEmpty()) {
            return null;
        }
        final List<Card> cards = new ArrayList<>();
        for (final Object v : views) {
            final Card c = card(v);
            if (c == null) {
                return null;
            }
            cards.add(c);
        }
        return cards;
    }

    private List<Object> pick(final List<Object> options, final int min, final int max, final String message,
                              final FSerializableFunction<Object, String> display) {
        final List<Object> result = new ArrayList<>();
        final List<Card> cards = cardsOf(options);
        if (cards != null) {
            count("dialog:cards");
            for (final Card c : seat.chooseCards(pch.context(), message, cards, min, max)) {
                result.add(options.get(cards.indexOf(c)));
            }
            return result;
        }
        count("dialog:options");
        for (final int i : seat.choose(pch.context(), message, labels(options, display), min, max)) {
            result.add(options.get(i));
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private Object dialog(final GuiGameEvent ev) {
        final Object[] a = ev.getObjects();
        if (TRACE) {
            System.err.println("[embedded-human] dialog " + ev.getMethod());
        }
        switch (ev.getMethod()) {
            case getChoices -> {
                final String message = (String) a[0];
                final int min = (Integer) a[1];
                final int max = (Integer) a[2];
                final List<Object> choices = (List<Object>) a[3];
                final FSerializableFunction<Object, String> display = (FSerializableFunction<Object, String>) a[5];
                if (min < 0 && max < 0) {
                    // reveal(): a list to look at, not a choice
                    if (!choices.isEmpty() && choices.stream().allMatch(c -> c instanceof CardView)) {
                        count("dialog:reveal");
                        final List<CardView> views = new ArrayList<>();
                        choices.forEach(c -> views.add((CardView) c));
                        seat.reveal(message, views);
                    } else {
                        count("dialog:notify");
                        seat.notify(message + ": " + String.join(", ", labels(choices, display)));
                    }
                    return new ArrayList<>();
                }
                return pick(choices, min, max, message, display);
            }
            case confirm -> {
                count("dialog:confirm");
                return seat.confirm(pch.context(), (String) a[1], (List<String>) a[3]);
            }
            case showConfirmDialog -> {
                count("dialog:showConfirmDialog");
                return seat.confirm(pch.context(), (String) a[0], List.of(String.valueOf(a[2]), String.valueOf(a[3])));
            }
            case showOptionDialog -> {
                count("dialog:showOptionDialog");
                final List<Integer> picked = seat.choose(pch.context(), (String) a[0], (List<String>) a[3], 1, 1);
                return picked.isEmpty() ? a[4] : picked.get(0);
            }
            case showInputDialog -> {
                final List<String> options = (List<String>) a[4];
                if (options != null && !options.isEmpty()) {
                    count("dialog:showInputDialog:options");
                    final List<Integer> picked = seat.choose(pch.context(), (String) a[0], options, 1, 1);
                    return picked.isEmpty() ? null : options.get(picked.get(0));
                }
                if (Boolean.TRUE.equals(a[5])) {
                    count("dialog:showInputDialog:number");
                    return String.valueOf(seat.chooseNumber(pch.context(), (String) a[0], 0, Integer.MAX_VALUE));
                }
                count("unsupported:showInputDialog:text");
                return a[3];
            }
            case order -> {
                final List<Object> source = (List<Object>) a[4];
                final List<Card> cards = cardsOf(source);
                if (cards == null) {
                    count("unsupported:order");
                    return new IGuiGame.OrderResult<>(new ArrayList<>(source), false);
                }
                count("dialog:order");
                final List<Object> ordered = new ArrayList<>();
                for (final Card c : seat.reorder(pch.context(), (String) a[0], cards)) {
                    ordered.add(c.getView());
                }
                return new IGuiGame.OrderResult<>(ordered, false);
            }
            case chooseSingleEntityForEffect -> {
                count("dialog:chooseSingleEntity");
                final List<Object> picked = pick(new ArrayList<>((List<?>) a[1]), Boolean.TRUE.equals(a[3]) ? 0 : 1, 1, (String) a[0], null);
                return picked.isEmpty() ? null : picked.get(0);
            }
            case chooseEntitiesForEffect -> {
                count("dialog:chooseEntities");
                return pick(new ArrayList<>((List<?>) a[1]), (Integer) a[2], (Integer) a[3], (String) a[0], null);
            }
            case assignGenericAmount -> {
                count("dialog:assignGenericAmount");
                final Map<Object, Integer> shares = (Map<Object, Integer>) a[1];
                final List<GameEntity> targets = new ArrayList<>();
                final Map<GameEntity, Object> back = new LinkedHashMap<>();
                for (final Object view : shares.keySet()) {
                    final GameEntity e = entity(view);
                    targets.add(e);
                    back.put(e, view);
                }
                final Map<Object, Integer> out = new LinkedHashMap<>();
                seat.divide(pch.context(), targets, (Integer) a[2]).forEach((e, n) -> out.put(back.get(e), n));
                return out;
            }
            case manipulateCardList -> {
                count("unsupported:manipulateCardList");
                final List<CardView> all = new ArrayList<>();
                ((Iterable<CardView>) a[1]).forEach(all::add);
                return all;
            }
            default -> {
                // Zone display on the fork's older protocol; upstream removed both
                if ("tempShowZones".equals(ev.getMethod().name())) {
                    return a[1];
                }
                if ("openZones".equals(ev.getMethod().name())) {
                    return null;
                }
                count("unsupported:" + ev.getMethod());
                System.err.println("[embedded-human] unmapped dialog " + ev.getMethod());
                return null;
            }
        }
    }

    /** In-process IRemote: fire-and-forget events feed the Input answers, blocking ones become seat questions. */
    static final class Remote implements IRemote {
        EmbeddedHumanGui gui;
        volatile String lastPrompt = "";
        volatile Object[] lastButtons;
        /** Forge reports an invalid declaration (blocks, attacks) through message(), not the prompt. */
        volatile String lastError;

        @Override
        public void send(final NetEvent event) {
            final GuiGameEvent ev = (GuiGameEvent) event;
            switch (ev.getMethod()) {
                case showPromptMessage -> lastPrompt = String.valueOf(ev.getObjects()[1]);
                case updateButtons -> lastButtons = ev.getObjects();
                case message, showErrorDialog -> lastError = String.valueOf(ev.getObjects()[0]);
                default -> { }
            }
        }

        @Override
        public Object sendAndWait(final IdentifiableNetEvent event) {
            return gui.dialog((GuiGameEvent) event);
        }
    }
}
