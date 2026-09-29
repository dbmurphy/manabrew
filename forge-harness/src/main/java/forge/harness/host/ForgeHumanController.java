package forge.harness.host;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.harness.common.SnapshotExtractor;
import forge.player.PlayerControllerHuman;

import forge.card.ICardFace;
import forge.game.GameEntity;
import forge.game.player.DelayedReveal;
import forge.util.collect.FCollectionView;

import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * Forge's own human controller. Overrides only where the GUI boundary loses the model: the casting
 * entry for the snapshot, trigger order (Forge offers views whose abilities are not reachable), and
 * who may see a secret choice (the dialog does not say it is secret), and which names a
 * name-a-card prompt offers (Forge offers the whole catalog; we offer the game's cards).
 */
public final class ForgeHumanController extends PlayerControllerHuman {
    private final ManaBrewInteractiveSession session;

    public ForgeHumanController(final Game game, final Player player, final LobbyPlayer lobbyPlayer,
                                final ManaBrewInteractiveSession session) {
        super(game, player, lobbyPlayer);
        this.session = session;
    }

    @Override
    public boolean playChosenSpellAbility(final SpellAbility sa) {
        session.beginCast(sa);
        try {
            return super.playChosenSpellAbility(sa);
        } finally {
            session.endCast();
        }
    }

    @Override
    public List<SpellAbility> orderSimultaneousSa(final List<SpellAbility> activePlayerSAs) {
        if (!needPromptForOrder(activePlayerSAs)) {
            return activePlayerSAs;
        }
        return session.awaitTriggerOrder(SnapshotExtractor.playerIndex(getGame(), getPlayer()), activePlayerSAs, null);
    }

    /** Same rule as ManaBrewInteractiveController: identical untargeted triggers need no order. */
    private static boolean needPromptForOrder(final List<SpellAbility> sas) {
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
    public int chooseNumber(final SpellAbility sa, final String title, final int min, final int max) {
        final int chosen = super.chooseNumber(sa, title, min, max);
        if (sa != null && sa.hasParam("Secretly") && sa.hasParam("KeepSecret")) {
            session.rememberSecretNumberViewer(sourceCardId(sa), getPlayer());
            ForgeHumanGui.COVERAGE.computeIfAbsent("secret:number", k -> new java.util.concurrent.atomic.AtomicInteger()).incrementAndGet();
        }
        return chosen;
    }

    @Override
    public int chooseNumber(final SpellAbility sa, final String title, final List<Integer> choices, final Player relatedPlayer) {
        final int chosen = super.chooseNumber(sa, title, choices, relatedPlayer);
        if (sa != null && sa.hasParam("Secretly") && sa.hasParam("KeepSecret")) {
            session.rememberSecretNumberViewer(sourceCardId(sa), getPlayer());
            ForgeHumanGui.COVERAGE.computeIfAbsent("secret:number", k -> new java.util.concurrent.atomic.AtomicInteger()).incrementAndGet();
        }
        return chosen;
    }

    @Override
    public String chooseSomeType(final String kindOfType, final SpellAbility sa, final Collection<String> validTypes,
                                 final boolean isOptional) {
        final String chosen = super.chooseSomeType(kindOfType, sa, validTypes, isOptional);
        if (chosen != null && sa != null && sa.hasParam("Secretly")) {
            session.rememberSecretTypeViewer(sourceCardId(sa), getPlayer());
            ForgeHumanGui.COVERAGE.computeIfAbsent("secret:type", k -> new java.util.concurrent.atomic.AtomicInteger()).incrementAndGet();
        }
        return chosen;
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(final FCollectionView<T> optionList,
            final DelayedReveal delayedReveal, final SpellAbility sa, final String title, final boolean isOptional,
            final Player targetedPlayer, final Map<String, Object> params) {
        final T chosen = super.chooseSingleEntityForEffect(optionList, delayedReveal, sa, title, isOptional, targetedPlayer, params);
        if (chosen instanceof Player p && sa != null && sa.hasParam("Secretly")) {
            session.rememberSecretPlayerViewer(sourceCardId(sa), p);
            ForgeHumanGui.COVERAGE.computeIfAbsent("secret:player", k -> new java.util.concurrent.atomic.AtomicInteger()).incrementAndGet();
        }
        return chosen;
    }

    private static String sourceCardId(final SpellAbility sa) {
        return sa.getHostCard() == null ? null : SnapshotExtractor.javaCardId(sa.getHostCard());
    }

    @Override
    public ICardFace chooseSingleCardFace(final SpellAbility sa, final String message,
                                          final java.util.function.Predicate<ICardFace> cpp, final String name) {
        final List<ICardFace> faces = ManaBrewInteractiveController.nameableFaces(getGame(), cpp);
        ForgeHumanGui.COVERAGE.computeIfAbsent("nameCard:" + faces.size(), k -> new java.util.concurrent.atomic.AtomicInteger()).incrementAndGet();
        return faces.isEmpty() ? null : super.chooseSingleCardFace(sa, faces, message);
    }
}
