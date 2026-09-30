package forge.harness.embedded;

import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.card.CardCollectionView;
import forge.game.card.CardView;
import forge.game.combat.Combat;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.PlayerController;
import forge.game.spellability.SpellAbility;
import org.apache.commons.lang3.tuple.Pair;

import java.util.List;
import java.util.Map;

/**
 * Whoever answers for a human seat that Forge's own PlayerControllerHuman runs. Every question
 * PlayerControllerHuman asks through a dialog goes to {@link #questions()}; the decisions it takes
 * through an Input come here, and {@link EmbeddedHumanGui} replays them as clicks.
 */
public interface HumanSeat {

    PlayerController questions();

    Priority priority();

    boolean keepHand(int mulligans);

    List<Card> bottom(CardCollectionView hand, int count);

    Target target(SpellAbility sa, List<GameEntity> candidates, boolean mustChoose);

    Payment payMana(SpellAbility paidFor, ManaCostBeingPaid cost, List<SpellAbility> sources,
                    List<Card> convokeSources, boolean canCancel);

    List<Pair<Card, GameEntity>> declareAttackers(Combat combat);

    List<Pair<Card, Card>> declareBlockers(Combat combat, String error);

    List<Card> chooseCards(Context context, String prompt, List<Card> cards, int min, int max);

    boolean confirm(Context context, String prompt, List<String> labels);

    List<Integer> choose(Context context, String prompt, List<String> labels, int min, int max);

    int chooseNumber(Context context, String prompt, int min, int max);

    Map<GameEntity, Integer> divide(Context context, List<GameEntity> targets, int amount);

    List<Card> reorder(Context context, String prompt, List<Card> cards);

    void reveal(String prompt, List<CardView> cards);

    void notify(String message);

    List<SpellAbility> orderTriggers(List<SpellAbility> sas);

    /** Asks only; Forge pays once the answer is yes. */
    boolean payToPrevent(Cost cost, SpellAbility sa, boolean duringRoll);

    boolean confirmPayment(Context context, CostPart part, String question, SpellAbility sa);

    /** The seat went away: Inputs still waiting get no answer. */
    default boolean closed() {
        return false;
    }

    default void castBegin(final SpellAbility sa) {
    }

    default void castEnd() {
    }

    /** What PlayerControllerHuman was doing when an Input or dialog asked. */
    record Context(Kind kind, SpellAbility sa) {
        public enum Kind { NONE, CAST, TARGET, PAY_TO_PREVENT }

        public static final Context NONE = new Context(Kind.NONE, null);

        public boolean paying() {
            return kind == Kind.CAST || kind == Kind.PAY_TO_PREVENT;
        }
    }

    sealed interface Priority {
        record Pass() implements Priority { }

        record Play(SpellAbility ability) implements Priority { }
    }

    sealed interface Target {
        record Pick(GameEntity entity) implements Target { }

        record Done() implements Target { }

        record Cancel() implements Target { }
    }

    sealed interface Payment {
        record Tap(SpellAbility manaAbility) implements Payment { }

        record Convoke(Card card) implements Payment { }

        record Pay() implements Payment { }

        record Cancel() implements Payment { }
    }
}
