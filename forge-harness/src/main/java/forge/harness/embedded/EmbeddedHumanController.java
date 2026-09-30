package forge.harness.embedded;

import com.google.common.collect.ListMultimap;
import com.google.common.collect.Multimap;
import forge.LobbyPlayer;
import forge.card.ColorSet;
import forge.card.ICardFace;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameObject;
import forge.game.GameType;
import forge.game.PlanarDice;
import forge.game.ability.effects.RollDiceEffect;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardState;
import forge.game.card.CardView;
import forge.game.card.CounterType;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.cost.CostPartWithList;
import forge.game.keyword.KeywordInterface;
import forge.game.mana.Mana;
import forge.game.player.DelayedReveal;
import forge.game.player.Player;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.player.PlayerView;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.OptionalCostValue;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.spellability.TargetChoices;
import forge.game.staticability.StaticAbility;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.PlayerZone;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.player.PlayerControllerHuman;
import forge.util.ITriggerEvent;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

/**
 * Forge's PlayerControllerHuman for a seat answered by a {@link HumanSeat}. Forge keeps the rules
 * (priority, casting, payment, targeting, combat declarations, mulligans) and asks through its
 * Inputs, which {@link EmbeddedHumanGui} answers; every question it would ask through a dialog goes
 * to the seat's own controller instead.
 */
public class EmbeddedHumanController extends PlayerControllerHuman {
    private final HumanSeat seat;
    private HumanSeat.Context context = HumanSeat.Context.NONE;
    private SpellAbility pendingManaAbility;
    private boolean carryingOutPayment;

    public EmbeddedHumanController(final Game game, final Player player, final LobbyPlayer lobbyPlayer, final HumanSeat seat) {
        super(game, player, lobbyPlayer);
        this.seat = seat;
    }

    public HumanSeat seat() {
        return seat;
    }

    HumanSeat.Context context() {
        return context;
    }

    /** The answer being replayed is a payment: what Forge asks while carrying it out was consented to. */
    void carryOutPayment(final SpellAbility manaAbility, final Runnable click) {
        pendingManaAbility = manaAbility;
        carryingOutPayment = true;
        try {
            click.run();
        } finally {
            pendingManaAbility = null;
            carryingOutPayment = false;
        }
    }

    private <T> T in(final HumanSeat.Context.Kind kind, final SpellAbility sa, final java.util.function.Supplier<T> body) {
        final HumanSeat.Context outer = context;
        context = new HumanSeat.Context(kind, sa);
        try {
            return body.get();
        } finally {
            context = outer;
        }
    }

    @Override
    public boolean playChosenSpellAbility(final SpellAbility sa) {
        seat.castBegin(sa);
        try {
            return in(HumanSeat.Context.Kind.CAST, sa, () -> super.playChosenSpellAbility(sa));
        } finally {
            seat.castEnd();
        }
    }

    @Override
    public boolean chooseTargetsFor(final SpellAbility sa) {
        return in(HumanSeat.Context.Kind.TARGET, sa, () -> super.chooseTargetsFor(sa));
    }

    @Override
    public boolean payCostToPreventEffect(final Cost cost, final SpellAbility sa, final boolean alreadyPaid,
                                          final FCollectionView<Player> allPayers) {
        return seat.payToPrevent(cost, sa, false)
                && in(HumanSeat.Context.Kind.PAY_TO_PREVENT, sa, () -> super.payCostToPreventEffect(cost, sa, alreadyPaid, allPayers));
    }

    @Override
    public boolean payCostDuringRoll(final Cost cost, final SpellAbility sa) {
        return seat.payToPrevent(cost, sa, true)
                && in(HumanSeat.Context.Kind.PAY_TO_PREVENT, sa, () -> super.payCostDuringRoll(cost, sa));
    }

    @Override
    public boolean confirmPayment(final CostPart costPart, final String question, final SpellAbility sa) {
        return carryingOutPayment || seat.confirmPayment(context, costPart, question, sa);
    }

    @Override
    public SpellAbility getAbilityToPlay(final Card hostCard, final List<SpellAbility> abilities, final ITriggerEvent triggerEvent) {
        if (pendingManaAbility != null && abilities.contains(pendingManaAbility)) {
            return pendingManaAbility;
        }
        return seat.questions().getAbilityToPlay(hostCard, abilities, triggerEvent);
    }

    @Override
    public List<SpellAbility> orderSimultaneousSa(final List<SpellAbility> activePlayerSAs) {
        return needPromptForOrder(activePlayerSAs) ? seat.orderTriggers(activePlayerSAs) : activePlayerSAs;
    }

    /** PlayerControllerHuman's rule, without its remembered orders: identical untargeted triggers need no order. */
    public static boolean needPromptForOrder(final List<SpellAbility> sas) {
        if (sas.size() < 2) {
            return false;
        }
        final SpellAbility first = sas.get(0);
        boolean needPrompt = !first.isTrigger();
        for (final SpellAbility sa : sas) {
            if (sa.usesTargeting()
                    || (sa.isTrigger() && sa.getTrigger().hasParam("OrderDuplicates"))
                    || !sa.toString().equals(first.toString())) {
                needPrompt = true;
            }
        }
        return needPrompt;
    }

    @Override
    public Integer announceRequirements(final SpellAbility ability, final int min, final int max, final String announce) {
        return seat.questions().announceRequirements(ability, min, max, announce);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(final CardCollection topN) {
        return seat.questions().arrangeForScry(topN);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(final CardCollection topN) {
        return seat.questions().arrangeForSurveil(topN);
    }

    @Override
    public Map<Card, Integer> assignCombatDamage(final Card attacker, final CardCollectionView blockers, final CardCollectionView remaining, final int damageDealt, final GameEntity defender, final boolean overrideOrder) {
        return seat.questions().assignCombatDamage(attacker, blockers, remaining, damageDealt, defender, overrideOrder);
    }

    @Override
    public boolean chooseBinary(final SpellAbility sa, final String question, final BinaryChoiceType kindOfChoice, final Boolean defaultVal) {
        return seat.questions().chooseBinary(sa, question, kindOfChoice, defaultVal);
    }

    @Override
    public String chooseCardName(final SpellAbility sa, final List<ICardFace> faces, final String message) {
        return seat.questions().chooseCardName(sa, faces, message);
    }

    @Override
    public String chooseCardName(final SpellAbility sa, final Predicate<ICardFace> cpp, final String valid, final String message) {
        return seat.questions().chooseCardName(sa, cpp, valid, message);
    }

    @Override
    public CardCollectionView chooseCardsForCost(final CardCollectionView optionList, final SpellAbility sa, final CostPartWithList cpl, final int amount, final boolean isOptional, final String prompt) {
        return seat.questions().chooseCardsForCost(optionList, sa, cpl, amount, isOptional, prompt);
    }

    @Override
    public CardCollectionView chooseCardsForEffect(final CardCollectionView sourceList, final SpellAbility sa, final String title, final int min, final int max, final boolean isOptional, final Map<String, Object> params) {
        return seat.questions().chooseCardsForEffect(sourceList, sa, title, min, max, isOptional, params);
    }

    @Override
    public CardCollection chooseCardsForEffectMultiple(final Map<String, CardCollection> validMap, final SpellAbility sa, final String title, final boolean isOptional) {
        return seat.questions().chooseCardsForEffectMultiple(validMap, sa, title, isOptional);
    }

    @Override
    public List<Card> chooseCardsForSplice(final SpellAbility sa, final List<Card> cards) {
        return seat.questions().chooseCardsForSplice(sa, cards);
    }

    @Override
    public List<Card> chooseCardsForZoneChange(final ZoneType destination, final List<ZoneType> origin, final SpellAbility sa, final CardCollection fetchList, final int min, final int max, final DelayedReveal delayedReveal, final String selectPrompt, final Player decider) {
        return seat.questions().chooseCardsForZoneChange(destination, origin, sa, fetchList, min, max, delayedReveal, selectPrompt, decider);
    }

    @Override
    public boolean chooseCardsPile(final SpellAbility sa, final CardCollectionView pile1, final CardCollectionView pile2, final String faceUp) {
        return seat.questions().chooseCardsPile(sa, pile1, pile2, faceUp);
    }

    @Override
    public CardCollectionView chooseCardsToDiscardFrom(final Player p, final SpellAbility sa, final CardCollection valid, final int min, final int max, final CardCollectionView visibleToChooser) {
        return seat.questions().chooseCardsToDiscardFrom(p, sa, valid, min, max, visibleToChooser);
    }

    @Override
    public CardCollectionView chooseCardsToDiscardToMaximumHandSize(final int nDiscard) {
        return seat.questions().chooseCardsToDiscardToMaximumHandSize(nDiscard);
    }

    @Override
    public CardCollectionView chooseCardsToDiscardUnlessType(final int num, final CardCollectionView hand, final String[] uTypes, final SpellAbility sa) {
        return seat.questions().chooseCardsToDiscardUnlessType(num, hand, uTypes, sa);
    }

    @Override
    public CardCollectionView chooseCardsToRevealFromHand(final int min, final int max, final CardCollectionView valid) {
        return seat.questions().chooseCardsToRevealFromHand(min, max, valid);
    }

    @Override
    public List<PaperCard> chooseCardsYouWonToAddToDeck(final List<PaperCard> losses) {
        return seat.questions().chooseCardsYouWonToAddToDeck(losses);
    }

    @Override
    public byte chooseColor(final String message, final SpellAbility sa, final ColorSet colors) {
        return seat.questions().chooseColor(message, sa, colors);
    }

    @Override
    public byte chooseColorAllowColorless(final String message, final Card c, final ColorSet colors) {
        return seat.questions().chooseColorAllowColorless(message, c, colors);
    }

    @Override
    public ColorSet chooseColors(final String message, final SpellAbility sa, final int min, final int max, final ColorSet options) {
        return seat.questions().chooseColors(message, sa, min, max, options);
    }

    @Override
    public List<Card> chooseContraptionsToCrank(final List<Card> contraptions) {
        return seat.questions().chooseContraptionsToCrank(contraptions);
    }

    @Override
    public CounterType chooseCounterType(final List<CounterType> options, final SpellAbility sa, final String prompt, final Map<String, Object> params) {
        return seat.questions().chooseCounterType(options, sa, prompt, params);
    }

    @Override
    public List<Integer> chooseDiceToReroll(final List<Integer> rolls) {
        return seat.questions().chooseDiceToReroll(rolls);
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(final FCollectionView<T> optionList, final int min, final int max, final DelayedReveal delayedReveal, final SpellAbility sa, final String title, final Player targetedPlayer, final Map<String, Object> params) {
        return seat.questions().chooseEntitiesForEffect(optionList, min, max, delayedReveal, sa, title, targetedPlayer, params);
    }

    @Override
    public boolean chooseFlipResult(final SpellAbility sa, final Player flipper, final boolean call) {
        return seat.questions().chooseFlipResult(sa, flipper, call);
    }

    @Override
    public String chooseKeywordForPump(final List<String> options, final SpellAbility sa, final String prompt, final Card tgtCard) {
        return seat.questions().chooseKeywordForPump(options, sa, prompt, tgtCard);
    }

    @Override
    public Mana chooseManaFromPool(final List<Mana> manaChoices) {
        return seat.questions().chooseManaFromPool(manaChoices);
    }

    @Override
    public List<AbilitySub> chooseModeForAbility(final SpellAbility sa, final List<AbilitySub> possible, final int min, final int num, final boolean allowRepeat) {
        return seat.questions().chooseModeForAbility(sa, possible, min, num, allowRepeat);
    }

    @Override
    public TargetChoices chooseNewTargetsFor(final SpellAbility ability, final Predicate<GameObject> filter, final boolean optional) {
        return seat.questions().chooseNewTargetsFor(ability, filter, optional);
    }

    @Override
    public int chooseNumber(final SpellAbility sa, final String title, final List<Integer> choices, final Player relatedPlayer) {
        return seat.questions().chooseNumber(sa, title, choices, relatedPlayer);
    }

    @Override
    public int chooseNumber(final SpellAbility sa, final String title, final int min, final int max) {
        return seat.questions().chooseNumber(sa, title, min, max);
    }

    @Override
    public int chooseNumberForCostReduction(final SpellAbility sa, final int min, final int max) {
        return seat.questions().chooseNumberForCostReduction(sa, min, max);
    }

    @Override
    public int chooseNumberForKeywordCost(final SpellAbility sa, final Cost cost, final KeywordInterface keyword, final String prompt, final int max) {
        return seat.questions().chooseNumberForKeywordCost(sa, cost, keyword, prompt, max);
    }

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(final SpellAbility choosen, final List<OptionalCostValue> optionalCost) {
        return seat.questions().chooseOptionalCosts(choosen, optionalCost);
    }

    @Override
    public PlanarDice choosePDRollToIgnore(final List<PlanarDice> rolls) {
        return seat.questions().choosePDRollToIgnore(rolls);
    }

    @Override
    public CardCollectionView choosePermanentsToDestroy(final SpellAbility sa, final int min, final int max, final CardCollectionView valid, final String message) {
        return seat.questions().choosePermanentsToDestroy(sa, min, max, valid, message);
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(final SpellAbility sa, final int min, final int max, final CardCollectionView valid, final String message) {
        return seat.questions().choosePermanentsToSacrifice(sa, min, max, valid, message);
    }

    @Override
    public Player choosePlayerToAssistPayment(final FCollectionView<Player> optionList, final SpellAbility sa, final String title, final int max) {
        return seat.questions().choosePlayerToAssistPayment(optionList, sa, title, max);
    }

    @Override
    public String chooseProtectionType(final SpellAbility sa, final List<String> choices) {
        return seat.questions().chooseProtectionType(sa, choices);
    }

    @Override
    public String chooseRollSwapValue(final List<String> swapChoices, final Integer currentResult, final int power, final int toughness) {
        return seat.questions().chooseRollSwapValue(swapChoices, currentResult, power, toughness);
    }

    @Override
    public Integer chooseRollToIgnore(final List<Integer> rolls) {
        return seat.questions().chooseRollToIgnore(rolls);
    }

    @Override
    public Integer chooseRollToModify(final List<Integer> rolls) {
        return seat.questions().chooseRollToModify(rolls);
    }

    @Override
    public RollDiceEffect.DieRollResult chooseRollToSwap(final List<RollDiceEffect.DieRollResult> rolls) {
        return seat.questions().chooseRollToSwap(rolls);
    }

    @Override
    public List<SpellAbility> chooseSaToActivateFromOpeningHand(final List<SpellAbility> usableFromOpeningHand) {
        return seat.questions().chooseSaToActivateFromOpeningHand(usableFromOpeningHand);
    }

    @Override
    public String chooseSector(final Card assignee, final String ai, final List<String> sectors) {
        return seat.questions().chooseSector(assignee, ai, sectors);
    }

    @Override
    public ICardFace chooseSingleCardFace(final SpellAbility sa, final List<ICardFace> faces, final String message) {
        return seat.questions().chooseSingleCardFace(sa, faces, message);
    }

    @Override
    public ICardFace chooseSingleCardFace(final SpellAbility sa, final String message, final Predicate<ICardFace> cpp, final String name) {
        return seat.questions().chooseSingleCardFace(sa, message, cpp, name);
    }

    @Override
    public Card chooseSingleCardForZoneChange(final ZoneType destination, final List<ZoneType> origin, final SpellAbility sa, final CardCollection fetchList, final DelayedReveal delayedReveal, final String selectPrompt, final boolean isOptional, final Player decider) {
        return seat.questions().chooseSingleCardForZoneChange(destination, origin, sa, fetchList, delayedReveal, selectPrompt, isOptional, decider);
    }

    @Override
    public CardState chooseSingleCardState(final SpellAbility sa, final List<CardState> states, final String message, final Map<String, Object> params) {
        return seat.questions().chooseSingleCardState(sa, states, message, params);
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(final FCollectionView<T> optionList, final DelayedReveal delayedReveal, final SpellAbility sa, final String title, final boolean isOptional, final Player targetedPlayer, final Map<String, Object> params) {
        return seat.questions().chooseSingleEntityForEffect(optionList, delayedReveal, sa, title, isOptional, targetedPlayer, params);
    }

    @Override
    public ReplacementEffect chooseSingleReplacementEffect(final List<ReplacementEffect> possibleReplacers) {
        return seat.questions().chooseSingleReplacementEffect(possibleReplacers);
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(final List<SpellAbility> spells, final SpellAbility sa, final String title, final Map<String, Object> params) {
        return seat.questions().chooseSingleSpellForEffect(spells, sa, title, params);
    }

    @Override
    public StaticAbility chooseSingleStaticAbility(final List<StaticAbility> possibleStatics) {
        return seat.questions().chooseSingleStaticAbility(possibleStatics);
    }

    @Override
    public String chooseSomeType(final String kindOfType, final SpellAbility sa, final Collection<String> validTypes, final boolean isOptional) {
        return seat.questions().chooseSomeType(kindOfType, sa, validTypes, isOptional);
    }

    @Override
    public List<SpellAbility> chooseSpellAbilitiesForEffect(final List<SpellAbility> spells, final SpellAbility sa, final String title, final int num, final Map<String, Object> params) {
        return seat.questions().chooseSpellAbilitiesForEffect(spells, sa, title, num, params);
    }

    @Override
    public int chooseSprocket(final Card assignee, final List<Integer> sprockets) {
        return seat.questions().chooseSprocket(assignee, sprockets);
    }

    @Override
    public PlayerZone chooseStartingHand(final List<PlayerZone> zones) {
        return seat.questions().chooseStartingHand(zones);
    }

    @Override
    public Player chooseStartingPlayer(final boolean isFirstGame) {
        return seat.questions().chooseStartingPlayer(isFirstGame);
    }

    @Override
    public Pair<SpellAbilityStackInstance, GameObject> chooseTarget(final SpellAbility saSpellskite, final List<Pair<SpellAbilityStackInstance, GameObject>> allTargets) {
        return seat.questions().chooseTarget(saSpellskite, allTargets);
    }

    @Override
    public boolean confirmAction(final SpellAbility sa, final PlayerActionConfirmMode mode, final String message, final List<String> options, final Card cardToShow, final Map<String, Object> params) {
        return seat.questions().confirmAction(sa, mode, message, options, cardToShow, params);
    }

    @Override
    public boolean confirmBidAction(final SpellAbility sa, final PlayerActionConfirmMode bidlife, final String string, final int bid, final Player winner) {
        return seat.questions().confirmBidAction(sa, bidlife, string, bid, winner);
    }

    @Override
    public boolean confirmReplacementEffect(final ReplacementEffect replacementEffect, final SpellAbility effectSA, final GameEntity affected, final String question) {
        return seat.questions().confirmReplacementEffect(replacementEffect, effectSA, affected, question);
    }

    @Override
    public boolean confirmStaticApplication(final Card hostCard, final PlayerActionConfirmMode mode, final String message, final String logic) {
        return seat.questions().confirmStaticApplication(hostCard, mode, message, logic);
    }

    @Override
    public boolean confirmTrigger(final WrappedAbility wrapper) {
        return seat.questions().confirmTrigger(wrapper);
    }

    @Override
    public Map<GameEntity, Integer> divideShield(final Card effectSource, final Map<GameEntity, Integer> affected, final int shieldAmount) {
        return seat.questions().divideShield(effectSource, affected, shieldAmount);
    }

    @Override
    public List<Card> enlistAttackers(final List<Card> attackers) {
        return seat.questions().enlistAttackers(attackers);
    }

    @Override
    public List<Card> exertAttackers(final List<Card> attackers) {
        return seat.questions().exertAttackers(attackers);
    }

    @Override
    public void notifyOfValue(final SpellAbility sa, final GameObject realtedTarget, final String value) {
        seat.questions().notifyOfValue(sa, realtedTarget, value);
    }

    @Override
    public CardCollection orderAttackers(final Card blocker, final CardCollection attackers) {
        return seat.questions().orderAttackers(blocker, attackers);
    }

    @Override
    public CardCollection orderBlocker(final Card attacker, final Card blocker, final CardCollection oldBlockers) {
        return seat.questions().orderBlocker(attacker, blocker, oldBlockers);
    }

    @Override
    public CardCollection orderBlockers(final Card attacker, final CardCollection blockers) {
        return seat.questions().orderBlockers(attacker, blockers);
    }

    @Override
    public List<CostPart> orderCosts(final List<CostPart> costs) {
        return seat.questions().orderCosts(costs);
    }

    @Override
    public CardCollectionView orderMoveToZoneList(final CardCollectionView cards, final ZoneType destinationZone, final SpellAbility source) {
        return seat.questions().orderMoveToZoneList(cards, destinationZone, source);
    }

    @Override
    public void reveal(final CardCollectionView cards, final ZoneType zone, final Player owner, final String message, final boolean addSuffix) {
        seat.questions().reveal(cards, zone, owner, message, addSuffix);
    }

    @Override
    public void reveal(final List<CardView> cards, final ZoneType zone, final PlayerView owner, final String message, final boolean addSuffix) {
        seat.questions().reveal(cards, zone, owner, message, addSuffix);
    }

    @Override
    public void revealAISkipCards(final String message, final Map<Player, Map<DeckSection, List<? extends PaperCard>>> unplayable) {
        seat.questions().revealAISkipCards(message, unplayable);
    }

    @Override
    public void revealAnte(final String message, final Multimap<Player, PaperCard> removedAnteCards) {
        seat.questions().revealAnte(message, removedAnteCards);
    }

    @Override
    public void revealUnsupported(final Map<Player, List<PaperCard>> unsupported) {
        seat.questions().revealUnsupported(unsupported);
    }

    @Override
    public List<PaperCard> sideboard(final Deck deck, final GameType gameType, final String message) {
        return seat.questions().sideboard(deck, gameType, message);
    }

    @Override
    public Map<Byte, Integer> specifyManaCombo(final SpellAbility sa, final ColorSet colorSet, final int manaAmount, final boolean different) {
        return seat.questions().specifyManaCombo(sa, colorSet, manaAmount, different);
    }

    @Override
    public Object vote(final SpellAbility sa, final String prompt, final List<Object> options, final ListMultimap<Object, Player> votes, final Player forPlayer, final boolean optional) {
        return seat.questions().vote(sa, prompt, options, votes, forPlayer, optional);
    }

    @Override
    public boolean willPutCardOnTop(final Card c) {
        return seat.questions().willPutCardOnTop(c);
    }
}
