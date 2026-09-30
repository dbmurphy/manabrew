const tokenDeck = {
  format: "standard",
  cards: [
    { name: "Forest", count: 20 },
    { name: "Memnite", count: 20 },
    { name: "Sprout", count: 20 },
  ],
};

export const decks = {
  token: tokenDeck,
  combat: tokenDeck,
  scry: {
    format: "standard",
    cards: [
      { name: "Island", count: 20 },
      { name: "Memnite", count: 20 },
      { name: "Preordain", count: 20 },
    ],
  },
  bounce: {
    format: "standard",
    cards: [
      { name: "Forest", count: 10 },
      { name: "Island", count: 10 },
      { name: "Memnite", count: 20 },
      { name: "Sprout", count: 10 },
      { name: "Unsummon", count: 10 },
    ],
  },
  extra: {
    format: "standard",
    cards: [
      { name: "Island", count: 20 },
      { name: "Memnite", count: 20 },
      { name: "Savor the Moment", count: 20 },
    ],
  },
};

export function scriptedAnswer({ prompt }, { combat = false } = {}) {
  const input = prompt.input;
  let output;
  switch (input.type) {
    case "diceRolled":
      output = { type: "diceRolledAcknowledged" };
      break;
    case "mulligan":
      output = { type: "mulliganDecision", keep: true };
      break;
    case "revealCards":
      output = { type: "revealCardsAcknowledged" };
      break;
    case "payManaCost":
      output = { type: "pay", auto: !input.canConfirmFromPool };
      break;
    case "chooseAction": {
      const action = input.actions.find((entry) => entry.type === "cast");
      output = action ? { type: "act", actionId: action.id } : { type: "pass" };
      break;
    }
    case "chooseAttackers":
      output = {
        type: "declareAttackers",
        assignments: combat
          ? input.attackers
              .filter((entry) => entry.validTargetIds.length)
              .map((entry) => ({ attackerId: entry.attackerId, targetId: entry.validTargetIds[0] }))
          : [],
      };
      break;
    case "chooseBlockers": {
      const used = new Set(),
        assignments = [];
      if (combat)
        for (const attacker of input.attackers) {
          const choices = attacker.validBlockerIds.filter((id) => !used.has(id));
          const count = Math.max(1, attacker.minBlockers);
          if (choices.length >= count)
            for (const blockerId of choices.slice(0, count)) {
              used.add(blockerId);
              assignments.push({ blockerId, attackerId: attacker.attackerId });
            }
        }
      output = { type: "declareBlockers", assignments };
      break;
    }
    case "chooseBoardTargets":
      output = { type: "boardTargetsDecision", chosen: [input.candidates[0]] };
      break;
    case "scry":
      output = {
        type: "scryDecision",
        zoneCardIds: [
          input.cards.map((card) => card.id).reverse(),
          ...input.zones.slice(1).map(() => []),
        ],
      };
      break;
    case "chooseCards":
      output = {
        type: "chooseCardsDecision",
        chosenCardIds: input.cards
          .slice(0, Math.max(input.min, Math.min(1, input.max)))
          .map((card) => card.id),
      };
      break;
    default:
      throw new Error(`Unsupported fixture prompt ${input.type}`);
  }
  return { type: input.type, output };
}
