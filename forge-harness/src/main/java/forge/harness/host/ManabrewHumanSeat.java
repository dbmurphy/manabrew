package forge.harness.host;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardView;
import forge.game.combat.Combat;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.player.PlayerController;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.harness.common.ChoiceSpace;
import forge.harness.common.CombatChoiceSpace;
import forge.harness.common.EngineHandler;
import forge.harness.common.HarnessCostPlumbing;
import forge.harness.common.ParityOrder;
import forge.harness.common.SnapshotExtractor;
import forge.harness.embedded.HumanSeat;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * A Manabrew player answering for Forge's own human controller. Every question goes out as the prompt
 * ManaBrewInteractiveController sends for the same decision: dialogs through that controller itself,
 * Input decisions through the same session calls with the same kinds.
 */
final class ManabrewHumanSeat implements HumanSeat {
    private final ManaBrewInteractiveSession session;
    private final Game game;
    private final Player player;
    private final ManaBrewInteractiveController questions;

    ManabrewHumanSeat(final Game game, final Player player, final LobbyPlayer lobbyPlayer,
                      final ManaBrewInteractiveSession session) {
        this.session = session;
        this.game = game;
        this.player = player;
        this.questions = new ManaBrewInteractiveController(game, player, lobbyPlayer, session);
    }

    private int me() {
        return SnapshotExtractor.playerIndex(game, player);
    }

    /** Its payability probes call the player's choosers, which must be its own silent ones. */
    private <T> T asInteractiveController(final Supplier<T> body) {
        final List<T> out = new ArrayList<>(1);
        player.runWithController(() -> out.add(body.get()), questions);
        return out.get(0);
    }

    @Override
    public PlayerController questions() {
        return questions;
    }

    @Override
    public boolean closed() {
        return session.isClosed();
    }

    @Override
    public Priority priority() {
        final List<SpellAbility> chosen = asInteractiveController(questions::chooseSpellAbilityToPlay);
        return chosen == null || chosen.isEmpty() ? new Priority.Pass() : new Priority.Play(chosen.get(0));
    }

    @Override
    public boolean keepHand(final int mulligans) {
        return session.awaitMulliganDecision(me(), mulligans);
    }

    @Override
    public List<Card> bottom(final CardCollectionView hand, final int count) {
        return session.awaitMulliganPutBack(me(), hand, count);
    }

    @Override
    public Target target(final SpellAbility sa, final List<GameEntity> candidates, final boolean mustChoose) {
        final List<Pair<GameEntity, GameObject>> pairs = new ArrayList<>();
        candidates.forEach(c -> pairs.add(ImmutablePair.of(c, c)));
        final Pair<GameEntity, GameObject> chosen = session.awaitTargetChoice(me(), sa, pairs, mustChoose);
        if (chosen == ManaBrewInteractiveSession.CANCELLED_TARGETING) {
            return new Target.Cancel();
        }
        return chosen == null ? new Target.Done() : new Target.Pick(chosen.getLeft());
    }

    @Override
    public Payment payMana(final SpellAbility paidFor, final ManaCostBeingPaid cost, final List<SpellAbility> sources,
                           final List<Card> convokeSources, final boolean canCancel) {
        while (true) {
            final ManaBrewInteractiveSession.ManaPaymentChoice choice = session.awaitManaPaymentChoice(
                    me(), paidFor == null ? null : paidFor.getHostCard(), cost.toString(), sources, new ArrayList<>(),
                    convokeSources, new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(),
                    !convokeSources.isEmpty(), canCancel, false, 0);
            switch (choice.kind()) {
                case TAP -> {
                    if (choice.convokeCard() != null) {
                        return new Payment.Convoke(choice.convokeCard());
                    }
                    final SpellAbility ma = choice.tapAbility();
                    if (ma != null) {
                        if (choice.color() != null && ma.getManaPart() != null) {
                            ma.getManaPart().setExpressChoice(choice.color());
                        }
                        return new Payment.Tap(ma);
                    }
                }
                case PAY -> {
                    return new Payment.Pay();
                }
                case CANCEL -> {
                    return new Payment.Cancel();
                }
                default -> throw new UnsupportedOperationException("payment action not offered: " + choice.kind());
            }
        }
    }

    @Override
    public List<Pair<Card, GameEntity>> declareAttackers(final Combat combat) {
        final List<Card> legal = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalAttackers(player, combat), ParityOrder.cardComparator());
        return legal.isEmpty() ? List.of() : session.awaitAttackAssignments(me(), combat, legal);
    }

    @Override
    public List<Pair<Card, Card>> declareBlockers(final Combat combat, final String error) {
        final List<Card> attackers = new ArrayList<>();
        for (final Card attacker : combat.getAttackers()) {
            if (combat.getDefendingPlayerRelatedTo(attacker) == player) {
                attackers.add(attacker);
            }
        }
        ChoiceSpace.sortNative(attackers, ParityOrder.cardComparator());
        final List<Card> blockers = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalBlockers(player, combat), ParityOrder.cardComparator());
        if (attackers.isEmpty() || blockers.isEmpty()) {
            return List.of();
        }
        return session.awaitBlockers(me(), attackers, blockers,
                EngineHandler.validBlockersByAttacker(combat, attackers, blockers), error);
    }

    @Override
    public List<Card> chooseCards(final Context context, final String prompt, final List<Card> cards, final int min, final int max) {
        final String kind = context.paying() ? "choose_cards_for_cost" : "choose_cards_for_effect";
        return session.awaitCardChoice(kind, me(), new CardCollection(cards), min, max,
                ManaBrewInteractiveController.sourceName(context.sa()),
                ManaBrewInteractiveController.sourceCardId(context.sa()), prompt);
    }

    @Override
    public boolean confirm(final Context context, final String prompt, final List<String> labels) {
        final SpellAbility sa = context.sa();
        return session.awaitBooleanChoice("confirm_action", me(), prompt,
                ManaBrewInteractiveController.sourceCardId(sa), "confirm_action", null,
                sa == null || sa.getApi() == null ? null : sa.getApi().toString(),
                labels != null && labels.size() == 2 ? labels : null, null);
    }

    @Override
    public List<Integer> choose(final Context context, final String prompt, final List<String> labels, final int min, final int max) {
        return session.awaitModeChoice(me(), labels, min, max, prompt);
    }

    @Override
    public int chooseNumber(final Context context, final String prompt, final int min, final int max) {
        return session.awaitNumberChoice(me(), min, max, ManaBrewInteractiveController.sourceCardId(context.sa()), prompt);
    }

    @Override
    public Map<GameEntity, Integer> divide(final Context context, final List<GameEntity> targets, final int amount) {
        return session.awaitDividedAllocation(me(), context.sa(), targets, amount);
    }

    @Override
    public List<Card> reorder(final Context context, final String prompt, final List<Card> cards) {
        return session.awaitReorderZone(me(), new CardCollection(cards), ZoneType.Library, true, prompt,
                ManaBrewInteractiveController.sourceCardId(context.sa()));
    }

    @Override
    public void reveal(final String prompt, final List<CardView> cards) {
        session.awaitRevealCardViews(me(), cards, null, null, prompt);
    }

    @Override
    public void notify(final String message) {
        session.awaitNotifyAcknowledgement(me(), message);
    }

    @Override
    public List<SpellAbility> orderTriggers(final List<SpellAbility> sas) {
        return session.awaitTriggerOrder(me(), sas, null);
    }

    @Override
    public boolean payToPrevent(final Cost cost, final SpellAbility sa, final boolean duringRoll) {
        return asInteractiveController(() -> duringRoll
                ? questions.askToPayCostDuringRoll(cost, sa)
                : questions.askToPayCostToPreventEffect(cost, sa));
    }

    @Override
    public boolean confirmPayment(final Context context, final CostPart part, final String question, final SpellAbility sa) {
        // Like the interactive controller: spell costs and an accepted pay-to-prevent are not asked again
        if (context.kind() == Context.Kind.PAY_TO_PREVENT || HarnessCostPlumbing.isSpellPaymentContext(sa)) {
            return true;
        }
        return questions.confirmPayment(part, question, sa);
    }

    @Override
    public void castBegin(final SpellAbility sa) {
        session.beginCast(sa);
    }

    @Override
    public void castEnd() {
        session.endCast();
    }
}
