package forge.harness.common;

import forge.game.GameEntity;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.card.CardUtil;
import forge.game.combat.AttackRestrictionType;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.cost.Cost;
import forge.game.player.Player;
import forge.game.player.PlayerController.FullControlFlag;
import forge.game.spellability.SpellAbility;

import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Unified entrypoints to correctly interface with the forge engine, and check correctness
 */
public final class EngineHandler {
    private EngineHandler() {
    }

    public static Integer announceRequirements(final Player player, final SpellAbility ability,
            final String announce, final Random rng) {
        final int[] bounds = announceBounds(player, ability, announce);
        if (bounds == null) {
            return null;
        }
        return ChoiceSpace.pickIntInRange(bounds[0], bounds[1], rng);
    }

    public static int[] announceBounds(final Player player, final SpellAbility ability, final String announce) {
        final Card host = ability.getHostCard();
        int max = Integer.MAX_VALUE;
        int min = 0;
        final boolean abXMin = ability.hasParam("XMin");
        final Cost cost = ability.getPayCosts();

        if ("X".equals(announce)) {
            if (abXMin) {
                min = Integer.parseInt(ability.getParam("XMin"));
            }
            if (ability.hasParam("XMaxLimit")) {
                max = Math.min(max, AbilityUtils.calculateAmount(host, ability.getParam("XMaxLimit"), ability));
            }
            if (cost != null) {
                Integer costX = cost.getMaxForNonManaX(ability, player, false);
                if (costX != null && !player.getController().isFullControl(FullControlFlag.AllowPaymentStartWithMissingResources)) {
                    max = Math.min(max, costX);
                }
                if (cost.hasManaCost() && !abXMin) {
                    min = cost.getCostMana().getXMin();
                }
            }
        }

        if (ability.hasParam("AnnounceMax")) {
            max = Math.min(max, AbilityUtils.calculateAmount(host, ability.getParam("AnnounceMax"), ability));
        }

        if (ability.usesTargeting() && ability.getTargetRestrictions() != null
                && announce.equals(ability.getTargetRestrictions().getMinTargets())) {
            max = Math.min(max, CardUtil.getValidCardsToTarget(ability).size());
        }

        if (min > max) {
            return null;
        }
        return new int[] {min, max};
    }

    public static String validateOption(final String chosen, final List<String> options, final boolean optional) {
        if (options == null || options.isEmpty()) {
            return optional ? null : "";
        }
        if (chosen != null && options.contains(chosen)) {
            return chosen;
        }
        return optional ? null : options.get(0);
    }

    public static <T> List<T> selectModes(final List<T> possible, final List<Integer> chosen, final boolean allowRepeat) {
        final List<T> selected = new ArrayList<>();
        final Set<Integer> used = new LinkedHashSet<>();
        for (final Integer index : chosen) {
            if (index == null || index < 0 || index >= possible.size()) {
                continue;
            }
            if (!allowRepeat && !used.add(index)) {
                continue;
            }
            selected.add(possible.get(index));
        }
        return selected;
    }

    public static String applyAttackerAssignments(
            final Combat combat,
            final List<Pair<Card, GameEntity>> assignments) {
        combat.clearAttackers();
        final Map<Card, GameEntity> selected = new LinkedHashMap<>();
        for (final Pair<Card, GameEntity> assignment : assignments) {
            final Card attacker = assignment.getLeft();
            final GameEntity defender = assignment.getRight();
            if (attacker == null || defender == null) {
                return "An attacker or its defender is no longer available.";
            }
            if (selected.containsKey(attacker)) {
                return attacker.getTranslatedName() + " may only be assigned to one defender.";
            }
            if (!CombatUtil.canAttack(attacker, defender)) {
                return attacker.getTranslatedName() + " can't attack " + defender.getName() + ".";
            }
            selected.put(attacker, defender);
        }
        selected.forEach(combat::addAttacker);
        if (CombatUtil.validateAttackers(combat)) {
            return null;
        }
        final String error = attackDeclarationError(combat, selected);
        combat.clearAttackers();
        return error;
    }

    private static String attackDeclarationError(final Combat combat, final Map<Card, GameEntity> selected) {
        final var constraints = combat.getAttackConstraints();
        final var global = constraints.getGlobalRestrictions();
        if (global.getMax() != null && selected.size() > global.getMax()) {
            return "No more than " + global.getMax() + (global.getMax() == 1 ? " creature may attack." : " creatures may attack.");
        }
        for (final var limit : global.getDefenderMax().entrySet()) {
            if (selected.values().stream().filter(defender -> defender == limit.getKey()).count() > limit.getValue()) {
                return "No more than " + limit.getValue() + (limit.getValue() == 1 ? " creature may attack " : " creatures may attack ") + limit.getKey().getName() + ".";
            }
        }
        for (final Card attacker : selected.keySet()) {
            final var restriction = constraints.getRestrictions().get(attacker);
            if (restriction == null) {
                continue;
            }
            for (final AttackRestrictionType violation : restriction.getViolation(selected)) {
                final String name = attacker.getTranslatedName();
                switch (violation) {
                    case ONLY_ALONE: return name + " can only attack alone.";
                    case NEED_GREATER_POWER: return name + " needs another attacker with greater power.";
                    case NEED_BLACK_OR_GREEN: return name + " needs another black or green attacker.";
                    case NOT_ALONE: return name + " can't attack alone.";
                    case NEED_TWO_OTHERS: return name + " needs at least two other attackers.";
                    case NEVER: return name + " can't attack.";
                }
            }
        }
        final Map<Card, GameEntity> legal = constraints.getLegalAttackers().getLeft();
        if (legal.isEmpty()) {
            return "This attack does not satisfy the attack requirements. Declaring no attackers is legal.";
        }
        final List<String> example = new ArrayList<>();
        legal.forEach((attacker, defender) -> example.add(attacker.getTranslatedName() + " attacks " + defender.getName()));
        return "This attack does not satisfy the attack requirements. A legal declaration is: " + String.join(", ", example) + ".";
    }

    public static Map<Card, List<Card>> validBlockersByAttacker(
            final Combat combat,
            final List<Card> attackers,
            final List<Card> availableBlockers) {
        final Map<Card, List<Card>> out = new LinkedHashMap<>();
        for (final Card attacker : attackers) {
            final List<Card> eligible = new ArrayList<>();
            for (final Card blocker : availableBlockers) {
                if (CombatChoiceSpace.canBlock(attacker, blocker, combat)) {
                    eligible.add(blocker);
                }
            }
            out.put(attacker, eligible);
        }
        return out;
    }

    public static String applyBlockerAssignments(
            final Combat combat,
            final Player defender,
            final List<Pair<Card, Card>> assignments) {
        final List<Card> applied = new ArrayList<>();
        for (final Pair<Card, Card> assignment : assignments) {
            final Card blocker = assignment.getLeft();
            final Card attacker = assignment.getRight();
            if (blocker == null || attacker == null) {
                continue;
            }
            if (!CombatChoiceSpace.canBlock(attacker, blocker, combat)) {
                for (final Card appliedBlocker : applied) {
                    combat.undoBlockingAssignment(appliedBlocker);
                }
                return blocker + " can't block " + attacker + ".";
            }
            combat.addBlocker(attacker, blocker);
            applied.add(blocker);
        }
        final String error = CombatUtil.validateBlocks(combat, defender);
        if (error != null) {
            for (final Card blocker : applied) {
                combat.undoBlockingAssignment(blocker);
            }
        }
        return error;
    }
}
