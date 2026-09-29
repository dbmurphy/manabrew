package forge.harness.host;

import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameEntityView;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardView;
import forge.game.combat.Combat;
import forge.game.event.GameEvent;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityView;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.input.Input;
import forge.gamemodes.match.input.InputAttack;
import forge.gamemodes.match.input.InputBlock;
import forge.gamemodes.match.input.InputConfirm;
import forge.gamemodes.match.input.InputConfirmMulligan;
import forge.gamemodes.match.input.InputLondonMulligan;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gamemodes.match.input.InputPayMana;
import forge.gamemodes.match.input.InputSelectEntitiesFromList;
import forge.gamemodes.match.input.InputSelectTargets;
import forge.gamemodes.net.IRemote;
import forge.gamemodes.net.ProtocolGuiGame;
import forge.gamemodes.net.event.GuiGameEvent;
import forge.gamemodes.net.event.IdentifiableNetEvent;
import forge.gamemodes.net.event.NetEvent;
import forge.gui.control.GameEventForwarder;
import forge.gui.interfaces.IGuiGame;
import forge.harness.common.ActionSpace;
import forge.harness.common.ChoiceSpace;
import forge.harness.common.CombatChoiceSpace;
import forge.harness.common.EngineHandler;
import forge.harness.common.ParityOrder;
import forge.harness.common.SnapshotExtractor;
import forge.util.FSerializableFunction;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Spike: Forge's own PlayerControllerHuman drives the seat. Waiting Inputs and blocking
 * dialogs become the session's existing prompts, so the protocol and client are unchanged.
 */
public final class ForgeHumanGui extends ProtocolGuiGame {

    /** Prompt kinds seen, for the spike report: mapped vs fallback. */
    public static final Map<String, AtomicInteger> COVERAGE = new ConcurrentHashMap<>();
    public static final Set<String> REFLECTED = ConcurrentHashMap.newKeySet();

    static {
        Runtime.getRuntime().addShutdownHook(new Thread(() ->
                System.err.println("[forge-human] coverage " + new java.util.TreeMap<>(COVERAGE) + " reflected " + REFLECTED)));
    }

    private final ManaBrewInteractiveSession session;
    private final ForgeHumanController pch;
    private final Player player;
    private final Game game;
    private final Remote remote;

    private SpellAbility pendingAbility;
    /** Set while carrying out a mana-payment answer: a cost Forge raises inside it was already chosen. */
    private boolean payingMana;
    private long nullSpins;
    private final Map<Input, Integer> pumpsByInput = new java.util.WeakHashMap<>();
    private int sameInputPumps;

    private String passUntilPlayer;
    private String passUntilPhase;
    private boolean passUntilThroughCombat;
    private int passUntilDeclaredTurn;
    private int passUntilObservedTurn;
    private PhaseType passUntilMaxPhase;
    private Set<Integer> exhaustStackIds;

    private ForgeHumanGui(final Remote remote, final ManaBrewInteractiveSession session, final ForgeHumanController pch) {
        super(remote);
        this.remote = remote;
        remote.gui = this;
        this.session = session;
        this.pch = pch;
        this.player = pch.getPlayer();
        this.game = pch.getGame();
    }

    /** The per-human half of HostedMatch.startGame. */
    static void attach(final Game game, final ManaBrewInteractiveSession session) {
        for (final Player p : game.getPlayers()) {
            if (p.getController() instanceof ForgeHumanController pch) {
                final ForgeHumanGui gui = new ForgeHumanGui(new Remote(), session, pch);
                pch.setGui(gui);
                gui.setGameView(null);
                gui.setGameView(game.getView());
                gui.setOriginalGameController(p.getView(), pch);
                gui.setForwarder(new GameEventForwarder(gui));
                // Desktop pacing: PCH sleeps on every phase or resolution it auto-passes. Global, because
                // the per-controller override is replaced whenever yield state is restored.
                forge.model.FModel.getPreferences().setPref(
                        forge.localinstance.properties.ForgePreferences.FPref.YIELD_SKIP_PHASE_DELAY, true);
                forge.model.FModel.getPreferences().setPref(
                        forge.localinstance.properties.ForgePreferences.FPref.YIELD_SKIP_RESOLVE_DELAY, true);
                // The actionable-card highlight scan duplicates ActionSpace on every priority
                forge.model.FModel.getPreferences().setPref(
                        forge.localinstance.properties.ForgePreferences.FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, false);
            }
        }
    }

    private static void count(final String kind) {
        COVERAGE.computeIfAbsent(kind, k -> new AtomicInteger()).incrementAndGet();
    }

    private int me() {
        return SnapshotExtractor.playerIndex(game, player);
    }

    // State comes from InteractiveSnapshotExtractor, which reads the live game: skip the delta walk.
    @Override
    public void updateGameView() {
    }

    @Override
    public void handleGameEvents(final List<GameEvent> events) {
    }

    @Override
    public void awaitInput(final CountDownLatch done) {
        while (done.getCount() > 0) {
            if (session.isClosed() || game.isGameOver()) {
                return;
            }
            final Input input = pch.getInputQueue().getInput();
            if (input == null) {
                if (TRACE && ++nullSpins % 1_000_000 == 1) {
                    System.err.println("[forge-human] waiting on an empty input queue, latch=" + done.getCount());
                }
                Thread.onSpinWait();
                continue;
            }
            // Per input object: a nested input (a confirm raised by auto-pay) must not reset the count
            sameInputPumps = pumpsByInput.merge(input, 1, Integer::sum) - 1;
            if (sameInputPumps > 40) {
                throw new IllegalStateException("[forge-human] input never finished: " + input.getClass().getSimpleName()
                        + " prompt=" + remote.lastPrompt);
            }
            if (TRACE) {
                System.err.println("[forge-human] input " + input.getClass().getSimpleName() + " pumps=" + sameInputPumps
                        + " phase=" + game.getPhaseHandler().getPhase() + " prompt=" + remote.lastPrompt.replace('\n', ' '));
            }
            answer(input, done);
            if (TRACE) {
                System.err.println("[forge-human] answered, latch=" + done.getCount());
            }
        }
    }

    private static final boolean TRACE = Boolean.getBoolean("manabrew.forgeHumanTrace");

    private void answer(final Input input, final CountDownLatch done) {
        if (input instanceof InputPassPriority priority) {
            priority(priority);
        } else if (input instanceof InputConfirmMulligan) {
            count("input:mulligan");
            if (session.awaitMulliganDecision(me(), 0)) {
                pch.selectButtonOk();
            } else {
                pch.selectButtonCancel();
            }
        } else if (input instanceof InputLondonMulligan) {
            count("input:londonBottom");
            final int n = (Integer) field(input, "toReturn");
            final CardCollection chosen = session.awaitCardChoice("choose_cards", me(),
                    new CardCollection(player.getCardsIn(ZoneType.Hand)), n, n, null, null, remote.lastPrompt);
            clickCards(chosen, done);
            ok(done);
        } else if (input instanceof InputSelectTargets) {
            targets(input, done);
        } else if (input instanceof InputPayMana) {
            mana(input, done);
        } else if (input instanceof InputAttack) {
            attack(done);
        } else if (input instanceof InputBlock) {
            block(done);
        } else if (input instanceof InputConfirm && payingMana) {
            // Today's controller pays mana-ability costs (a horizon land's life) without asking
            count("input:confirm:impliedByPayment");
            pch.selectButtonOk();
        } else if (input instanceof InputConfirm) {
            count("input:confirm");
            final List<String> labels = List.of(String.valueOf(remote.lastButtons[1]), String.valueOf(remote.lastButtons[2]));
            if (session.awaitBooleanChoice("confirm_action", me(), remote.lastPrompt, null, "confirm", null, null, labels, null)) {
                pch.selectButtonOk();
            } else {
                pch.selectButtonCancel();
            }
        } else if (input instanceof forge.gamemodes.match.input.InputSelectCardsForConvokeOrImprovise) {
            count("input:convoke");
            final CardCollection available = new CardCollection((Iterable<Card>) field(input, "availableCards"));
            final int max = (Integer) field(input, "max");
            clickCards(session.awaitCardChoice("convoke", me(), available, 0, max, null, null, remote.lastPrompt), done);
            ok(done);
        } else if (input instanceof InputSelectEntitiesFromList<?> list) {
            entities(list, done);
        } else {
            count("fallback:" + input.getClass().getSimpleName());
            System.err.println("[forge-human] fallback " + input.getClass().getSimpleName() + ": " + remote.lastPrompt);
            if (remote.lastButtons != null && Boolean.TRUE.equals(remote.lastButtons[3])) {
                pch.selectButtonOk();
            } else {
                pch.selectButtonCancel();
            }
        }
    }

    private void priority(final InputPassPriority input) {
        if (fastForwarding()) {
            count("input:priority:skipped");
            input.selectButtonOK();
            return;
        }
        count("input:priority");
        final List<SpellAbility>[] actions = new List[1];
        player.runWithController(() -> actions[0] = ChoiceSpace.sortNative(
                new ArrayList<>(ActionSpace.getPossibleActions(player, true, true)), ParityOrder.actionComparator()),
                new PlayerControllerAi(game, player, player.getOriginalLobbyPlayer()));
        final ManaBrewInteractiveSession.PriorityChoice choice = session.awaitPriorityAction(me(), actions[0], undoableManaSources());
        if (choice.kind() == ManaBrewInteractiveSession.PriorityActionKind.UNDO) {
            count("input:priority:undo");
            undoManaSource(choice.untapCard());
            return;
        }
        passUntilPlayer = choice.untilPlayer();
        passUntilPhase = choice.untilPhase();
        passUntilThroughCombat = choice.throughCombat();
        passUntilDeclaredTurn = game.getPhaseHandler().getTurn();
        passUntilObservedTurn = passUntilDeclaredTurn;
        passUntilMaxPhase = game.getPhaseHandler().getPhase();
        exhaustStackIds = choice.exhaustStack() ? PriorityFastForward.stackIds(game) : null;
        final SpellAbility selected = choice.action();
        if (selected == null) {
            input.selectButtonOK();
            return;
        }
        if (selected.isManaAbility() && selected.getManaPart() != null) {
            if (choice.color() == null) {
                selected.getManaPart().clearExpressChoice();
            } else {
                selected.getManaPart().setExpressChoice(shortColor(choice.color()));
            }
        }
        input.selectAbility(selected);
    }

    /** Same as ManaBrewInteractiveController: mana sources whose activation can still be undone. */
    private List<Card> undoableManaSources() {
        final List<Card> sources = new ArrayList<>();
        if (!game.getStack().canUndo(player)) {
            return sources;
        }
        for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
            if (game.getStack().filterUndoStackByHost(card).iterator().hasNext()) {
                sources.add(card);
            }
        }
        return sources;
    }

    private void undoManaSource(final Card source) {
        final forge.game.zone.MagicStack stack = game.getStack();
        if (source == null) {
            stack.undo();
            return;
        }
        for (final SpellAbility sa : com.google.common.collect.Lists.newArrayList(stack.filterUndoStackByHost(source))) {
            if (sa.undo()) {
                stack.clearUndoStack(sa);
                new forge.game.mana.ManaRefundService(sa).refundManaPaid();
            } else {
                stack.clearUndoStack(sa);
                for (final forge.game.mana.Mana pay : sa.getPayingMana()) {
                    stack.clearUndoStack(pay.getManaAbility().getSourceSA());
                }
            }
        }
    }

    /** Same rules as ManaBrewInteractiveController.chooseSpellAbilityToPlay. */
    private boolean fastForwarding() {
        if (exhaustStackIds != null) {
            if (PriorityFastForward.exhaustEnded(game, exhaustStackIds)) {
                exhaustStackIds = null;
            } else {
                return true;
            }
        }
        if (passUntilPhase == null) {
            return false;
        }
        final PhaseType current = game.getPhaseHandler().getPhase();
        if (game.getPhaseHandler().getTurn() != passUntilObservedTurn) {
            passUntilObservedTurn = game.getPhaseHandler().getTurn();
            passUntilMaxPhase = current;
        }
        if (PriorityFastForward.reachedTarget(game, passUntilPlayer, passUntilPhase)
                || PriorityFastForward.invalidatedByExtraTurn(game, player, passUntilPlayer, passUntilDeclaredTurn)
                || PriorityFastForward.invalidatedByExtraPhase(current, passUntilMaxPhase)) {
            passUntilPlayer = null;
            passUntilPhase = null;
            passUntilThroughCombat = false;
            return false;
        }
        if (current != null && (passUntilMaxPhase == null || passUntilMaxPhase.isBefore(current))) {
            passUntilMaxPhase = current;
        }
        return PriorityFastForward.canSkip(game, passUntilThroughCombat);
    }

    private void targets(final Input input, final CountDownLatch done) {
        count("input:targets");
        final SpellAbility sa = (SpellAbility) field(input, "sa");
        final boolean mandatory = (Boolean) field(input, "mandatory");
        final List<Pair<GameEntity, GameObject>> valid = new ArrayList<>();
        final Map<String, Boolean> seen = new HashMap<>();
        for (final GameEntity candidate : sa.getTargetRestrictions().getAllCandidates(sa, false)) {
            if (sa.canTarget(candidate) && !sa.getTargets().contains(candidate)
                    && seen.putIfAbsent(candidate.getClass().getSimpleName() + candidate.getId(), true) == null) {
                valid.add(ImmutablePair.of(candidate, candidate));
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
        final Pair<GameEntity, GameObject> chosen =
                session.awaitTargetChoice(me(), sa, valid, mandatory && !sa.isMinTargetChosen());
        if (chosen == ManaBrewInteractiveSession.CANCELLED_TARGETING) {
            pch.selectButtonCancel();
        } else if (chosen == null) {
            ok(done);
        } else {
            click(chosen.getLeft());
        }
    }

    private void mana(final Input input, final CountDownLatch done) {
        count("input:mana");
        final SpellAbility paidFor = (SpellAbility) field(input, "saPaidFor");
        final ManaCostBeingPaid cost = (ManaCostBeingPaid) field(input, "manaCost");
        final boolean mandatory = (Boolean) field(input, "mandatory");
        // Forge's own filter: only abilities that can pay something of this cost
        final List<SpellAbility> sources = new ArrayList<>();
        for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
            sources.addAll(((InputPayMana) input).getUsefulManaAbilities(card));
        }
        final ManaBrewInteractiveSession.ManaPaymentChoice choice = session.awaitManaPaymentChoice(
                me(), paidFor.getHostCard(), cost.toString(), sources, new ArrayList<>(), new ArrayList<>(),
                new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), false, !mandatory, false, 0);
        switch (choice.kind()) {
            case TAP -> {
                final SpellAbility ma = choice.tapAbility();
                if (ma == null) {
                    return;
                }
                if (choice.color() != null && ma.getManaPart() != null) {
                    ma.getManaPart().setExpressChoice(choice.color());
                }
                pendingAbility = ma;
                payingMana = true;
                try {
                    pch.selectCard(ma.getHostCard().getView(), null, null);
                } finally {
                    pendingAbility = null;
                    payingMana = false;
                }
            }
            case PAY -> {
                payingMana = true;
                try {
                    ok(done);
                } finally {
                    payingMana = false;
                }
            }
            case CANCEL -> pch.selectButtonCancel();
            default -> {
                count("unsupported:mana:" + choice.kind());
                ok(done);
            }
        }
    }

    private void attack(final CountDownLatch done) {
        count("input:attack");
        final Combat combat = game.getCombat();
        final List<Card> legal = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalAttackers(player, combat), ParityOrder.cardComparator());
        if (!legal.isEmpty()) {
            final List<Pair<Card, GameEntity>> assignments = session.awaitAttackAssignments(me(), combat, legal);
            for (final Card attacker : new ArrayList<>(combat.getAttackers())) {
                if (attacker.getController() == player) {
                    combat.removeFromCombat(attacker);
                }
            }
            for (final Pair<Card, GameEntity> assignment : assignments) {
                if (done.getCount() == 0) {
                    return;
                }
                click(assignment.getRight());
                pch.selectCard(assignment.getLeft().getView(), null, null);
            }
        }
        ok(done);
    }

    private void block(final CountDownLatch done) {
        count("input:block");
        final Combat combat = game.getCombat();
        final List<Card> attackers = new ArrayList<>();
        for (final Card attacker : combat.getAttackers()) {
            if (combat.getDefendingPlayerRelatedTo(attacker) == player) {
                attackers.add(attacker);
            }
        }
        ChoiceSpace.sortNative(attackers, ParityOrder.cardComparator());
        final List<Card> blockers = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalBlockers(player, combat), ParityOrder.cardComparator());
        if (!attackers.isEmpty() && !blockers.isEmpty()) {
            final String error = sameInputPumps > 0 ? remote.lastError : null;
            remote.lastError = null;
            // Clicks toggle blocks, so a retry after a rejected declaration starts from none
            for (final Card blocker : new ArrayList<>(combat.getAllBlockers())) {
                if (blocker.getController() == player) {
                    combat.removeFromCombat(blocker);
                }
            }
            for (final Pair<Card, Card> assignment : session.awaitBlockers(me(), attackers, blockers,
                    EngineHandler.validBlockersByAttacker(combat, attackers, blockers), error)) {
                if (done.getCount() == 0) {
                    return;
                }
                pch.selectCard(assignment.getRight().getView(), null, null);
                pch.selectCard(assignment.getLeft().getView(), null, null);
            }
        }
        ok(done);
    }

    private void entities(final InputSelectEntitiesFromList<?> input, final CountDownLatch done) {
        final List<GameEntity> valid = new ArrayList<>(input.getValidChoices());
        final int min = (Integer) field(input, "min");
        final int max = (Integer) field(input, "max");
        if (valid.stream().allMatch(e -> e instanceof Card)) {
            count("input:cards");
            final CardCollection cards = new CardCollection();
            valid.forEach(e -> cards.add((Card) e));
            clickCards(session.awaitCardChoice("choose_cards", me(), cards, min, max, null, null, remote.lastPrompt), done);
        } else {
            count("input:entities");
            final List<String> labels = new ArrayList<>();
            valid.forEach(e -> labels.add(e.toString()));
            for (final int index : session.awaitModeChoice(me(), labels, min, max, remote.lastPrompt)) {
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

    private static Object field(final Object target, final String name) {
        REFLECTED.add(target.getClass().getSimpleName() + "." + name);
        for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {
            try {
                final Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f.get(target);
            } catch (NoSuchFieldException ignored) {
                // keep walking up
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
        throw new IllegalStateException("no field " + name + " on " + target.getClass());
    }

    private static String shortColor(final String color) {
        return switch (color) {
            case "White" -> "W";
            case "Blue" -> "U";
            case "Black" -> "B";
            case "Red" -> "R";
            case "Green" -> "G";
            case "Colorless" -> "C";
            default -> color;
        };
    }

    private Card card(final CardView view) {
        return view == null ? null : pch.getCard(view);
    }

    private Player playerOf(final PlayerView view) {
        return view == null ? null : game.getPlayer(view);
    }

    private GameEntity entity(final Object view) {
        if (view instanceof CardView cv) {
            return card(cv);
        }
        if (view instanceof PlayerView pv) {
            return playerOf(pv);
        }
        return null;
    }

    /** Blocking dialogs arrive here as protocol events; answers are the objects the dialog offered. */
    private Object dialog(final GuiGameEvent ev) {
        final Object[] a = ev.getObjects();
        if (TRACE) {
            System.err.println("[forge-human] dialog " + ev.getMethod());
        }
        switch (ev.getMethod()) {
            case getAbilityToPlay -> {
                final List<SpellAbilityView> options = (List<SpellAbilityView>) a[1];
                if (pendingAbility != null) {
                    for (final SpellAbilityView v : options) {
                        if (v.getId() == pendingAbility.getId()) {
                            count("dialog:getAbilityToPlay:pending");
                            return v;
                        }
                    }
                }
                if (options.size() == 1) {
                    count("dialog:getAbilityToPlay:single");
                    return options.get(0);
                }
                count("dialog:getAbilityToPlay");
                final List<String> labels = new ArrayList<>();
                options.forEach(o -> labels.add(o.toString()));
                final List<Integer> picked = session.awaitModeChoice(me(), labels, 1, 1, cardName(a[0]));
                return picked.isEmpty() ? null : options.get(picked.get(0));
            }
            case getChoices -> {
                final String message = (String) a[0];
                final int min = (Integer) a[1];
                final int max = (Integer) a[2];
                final List<Object> choices = (List<Object>) a[3];
                final FSerializableFunction<Object, String> display = (FSerializableFunction<Object, String>) a[5];
                if (min < 0 && max < 0) {
                    // Forge's reveal(): a list to look at, not a choice
                    if (!choices.isEmpty() && choices.stream().allMatch(c -> c instanceof CardView)) {
                        count("dialog:getChoices:reveal");
                        final List<CardView> views = new ArrayList<>();
                        choices.forEach(c -> views.add((CardView) c));
                        session.awaitRevealCardViews(me(), views, null, null, message);
                    } else {
                        count("dialog:getChoices:notify");
                        final List<String> labels = new ArrayList<>();
                        choices.forEach(c -> labels.add(display != null ? display.apply(c) : String.valueOf(c)));
                        session.awaitNotifyAcknowledgement(me(), message + ": " + String.join(", ", labels));
                    }
                    return new ArrayList<>();
                }
                if (!choices.isEmpty() && choices.stream().allMatch(c -> c instanceof CardView cv && card(cv) != null)) {
                    count("dialog:getChoices:cards");
                    return pickCards(choices, min, max, message);
                }
                if (!choices.isEmpty() && choices.stream().allMatch(c -> c instanceof CardView)) {
                    // Views of cards outside the game (naming a card): offer them by name
                    count("dialog:getChoices:cardNames");
                    if (TRACE || COVERAGE.get("dialog:getChoices:cardNames").get() <= 3) {
                        System.err.println("[forge-human] card-name choice: " + message + " (" + choices.size() + " options)");
                    }
                }
                count("dialog:getChoices:options");
                final List<String> labels = new ArrayList<>();
                for (final Object c : choices) {
                    labels.add(display != null ? display.apply(c) : String.valueOf(c));
                }
                final List<Object> result = new ArrayList<>();
                for (final int i : session.awaitModeChoice(me(), labels, min, max, message)) {
                    result.add(choices.get(i));
                }
                return result;
            }
            case confirm -> {
                count("dialog:confirm");
                final List<String> options = (List<String>) a[3];
                return session.awaitBooleanChoice("confirm_action", me(), (String) a[1], cardId(a[0]), "confirm",
                        null, null, options, null);
            }
            case showConfirmDialog -> {
                count("dialog:showConfirmDialog");
                return session.awaitBooleanChoice("confirm_action", me(), (String) a[0], null, "confirm", null, null,
                        List.of(String.valueOf(a[2]), String.valueOf(a[3])), null);
            }
            case showOptionDialog -> {
                count("dialog:showOptionDialog");
                final List<Integer> picked = session.awaitModeChoice(me(), (List<String>) a[3], 1, 1, (String) a[0]);
                return picked.isEmpty() ? a[4] : picked.get(0);
            }
            case showInputDialog -> {
                final List<String> options = (List<String>) a[4];
                if (options != null && !options.isEmpty()) {
                    count("dialog:showInputDialog:options");
                    return session.awaitStringChoice("choose_option", me(), options, null, (String) a[0]);
                }
                if (Boolean.TRUE.equals(a[5])) {
                    count("dialog:showInputDialog:number");
                    return String.valueOf(session.awaitNumberChoice(me(), 0, 99, null, (String) a[0]));
                }
                count("unsupported:showInputDialog:text");
                return a[3];
            }
            case order -> {
                final List<Object> source = (List<Object>) a[4];
                if (!source.isEmpty() && source.stream().allMatch(c -> c instanceof CardView)) {
                    count("dialog:order:cards");
                    final CardCollection cards = new CardCollection();
                    source.forEach(c -> cards.add(card((CardView) c)));
                    final List<Object> ordered = new ArrayList<>();
                    for (final Card c : session.awaitReorderZone(me(), cards, ZoneType.Library, true, (String) a[0], null)) {
                        ordered.add(c.getView());
                    }
                    return new IGuiGame.OrderResult<>(ordered, false);
                }
                count("unsupported:order:" + (source.isEmpty() ? "empty" : source.get(0).getClass().getSimpleName()));
                return new IGuiGame.OrderResult<>(new ArrayList<>(source), false);
            }
            case chooseSingleEntityForEffect -> {
                count("dialog:chooseSingleEntity");
                final List<Object> options = new ArrayList<>((List<?>) a[1]);
                final List<Object> picked = pickEntities(options, Boolean.TRUE.equals(a[3]) ? 0 : 1, 1, (String) a[0]);
                return picked.isEmpty() ? null : picked.get(0);
            }
            case chooseEntitiesForEffect -> {
                count("dialog:chooseEntities");
                return pickEntities(new ArrayList<>((List<?>) a[1]), (Integer) a[2], (Integer) a[3], (String) a[0]);
            }
            case manipulateCardList -> {
                // PCH.arrangeForMove reads one list: top cards first, bottom cards last in reverse
                final List<CardView> all = new ArrayList<>();
                ((Iterable<CardView>) a[1]).forEach(all::add);
                final List<CardView> movable = new ArrayList<>();
                ((Iterable<CardView>) a[2]).forEach(movable::add);
                if (!(Boolean.TRUE.equals(a[3]) && Boolean.TRUE.equals(a[4]))) {
                    count("unsupported:manipulateCardList");
                    return all;
                }
                count("dialog:manipulateCardList:scry");
                final CardCollection cards = new CardCollection();
                movable.forEach(v -> cards.add(card(v)));
                final Pair<CardCollection, CardCollection> decision =
                        session.awaitScryDecision("choose_scry", me(), cards, (String) a[0]);
                final List<CardView> result = new ArrayList<>();
                decision.getLeft().forEach(c -> result.add(c.getView()));
                for (final CardView v : all) {
                    if (!movable.contains(v)) {
                        result.add(v);
                    }
                }
                final List<CardView> bottom = new ArrayList<>();
                decision.getRight().forEach(c -> bottom.add(c.getView()));
                java.util.Collections.reverse(bottom);
                result.addAll(bottom);
                return result;
            }
            case assignGenericAmount -> {
                count("dialog:assignGenericAmount");
                final Map<Object, Integer> targets = (Map<Object, Integer>) a[1];
                final int amount = (Integer) a[2];
                final boolean atLeastOne = Boolean.TRUE.equals(a[3]);
                final List<Object> keys = new ArrayList<>(targets.keySet());
                final Map<Object, Integer> out = new LinkedHashMap<>();
                int remaining = amount;
                for (int i = 0; i < keys.size(); i++) {
                    final int left = keys.size() - i - 1;
                    if (left == 0) {
                        out.put(keys.get(i), remaining);
                        break;
                    }
                    final int floor = atLeastOne ? 1 : 0;
                    final int give = session.awaitNumberChoice(me(), floor, remaining - (atLeastOne ? left : 0),
                            cardId(a[0]), "Assign to " + (keys.get(i) instanceof GameEntityView g ? g.getName() : keys.get(i)));
                    out.put(keys.get(i), give);
                    remaining -= give;
                }
                return out;
            }
            case assignCombatDamage -> {
                count("dialog:assignCombatDamage");
                final CardCollection blockers = new CardCollection();
                ((List<CardView>) a[1]).forEach(v -> blockers.add(card(v)));
                final GameEntity defender = entity(a[3]);
                final Map<Card, Integer> assigned = session.awaitCombatDamageAssignment(me(), card((CardView) a[0]),
                        blockers, (Integer) a[2], defender, defender != null && Boolean.TRUE.equals(a[4]),
                        Boolean.TRUE.equals(a[5]));
                final Map<CardView, Integer> out = new LinkedHashMap<>();
                assigned.forEach((c, d) -> out.put(c == null ? null : c.getView(), d));
                return out;
            }
            default -> {
                // Zone display on the fork's older protocol; upstream removed both
                if ("tempShowZones".equals(ev.getMethod().name())) {
                    count("ui:tempShowZones");
                    return a[1];
                }
                if ("openZones".equals(ev.getMethod().name())) {
                    count("ui:openZones");
                    return null;
                }
                count("unsupported:" + ev.getMethod());
                System.err.println("[forge-human] unmapped dialog " + ev.getMethod());
                return null;
            }
        }
    }

    private List<Object> pickCards(final List<Object> views, final int min, final int max, final String message) {
        final CardCollection cards = new CardCollection();
        final Map<Card, Object> back = new LinkedHashMap<>();
        for (final Object v : views) {
            final Card c = card((CardView) v);
            if (c != null) {
                cards.add(c);
                back.put(c, v);
            }
        }
        final List<Object> result = new ArrayList<>();
        for (final Card c : session.awaitCardChoice("choose_cards", me(), cards, min, max, null, null, message)) {
            result.add(back.get(c));
        }
        return result;
    }

    private List<Object> pickEntities(final List<Object> views, final int min, final int max, final String message) {
        if (!views.isEmpty() && views.stream().allMatch(v -> v instanceof CardView)) {
            return pickCards(views, min, max, message);
        }
        final List<String> labels = new ArrayList<>();
        views.forEach(v -> labels.add(v instanceof GameEntityView g ? g.getName() : String.valueOf(v)));
        final List<Object> result = new ArrayList<>();
        for (final int i : session.awaitModeChoice(me(), labels, min, max, message)) {
            result.add(views.get(i));
        }
        return result;
    }

    private static String cardName(final Object view) {
        return view instanceof CardView cv ? cv.getName() : null;
    }

    private String cardId(final Object view) {
        final Card c = view instanceof CardView cv ? card(cv) : null;
        return c == null ? null : SnapshotExtractor.javaCardId(c);
    }

    /** In-process IRemote: fire-and-forget events feed the Input answers, blocking ones become prompts. */
    static final class Remote implements IRemote {
        ForgeHumanGui gui;
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
