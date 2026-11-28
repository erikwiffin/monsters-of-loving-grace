// Data-driven game definitions and balance constants.
// Everything here is copied into the game state's `config` at creation, so
// experiments can override any value via createGame(configOverrides, seed).

export const ENGINE_VERSION = '0.15.0';
export const SCHEMA_VERSION = 10;

export const SLOT_ORDER = ['arm1', 'arm2', 'leg1', 'leg2', 'chest', 'head'];
export const ATTRIBUTES = ['vitality', 'humanity'];
export const ALLOWED_DICE = [4, 6, 8, 10, 12, 20];
export const PHASES = ['day', 'night', 'resolution', 'dawn', 'ended'];

export const OBJECTIVE_INFO = {
  prometheus: {
    name: 'Prometheus',
    summary: 'Create life.',
    condition: 'Be the only player whose Creature becomes stable in a round. You win at dawn. If another Creature stabilizes in the same round, you lose.',
  },
  visionary: {
    name: 'Visionary',
    summary: 'Witness a new age.',
    condition: 'At least two distinct Creatures become stable in the same round, regardless of who made them.',
  },
  inquisitor: {
    name: 'Inquisitor',
    summary: 'Expose the blasphemers.',
    condition: 'Village suspicion reaches the mob threshold before the game ends.',
  },
  unleasher: {
    name: 'Unleasher',
    summary: 'Let the monster loose.',
    condition: 'Any monster is unleashed because its Humanity fails and no player subdues it, regardless of creator.',
  },
};

export const DEFAULT_CONFIG = {
  playerCount: 5,
  // The Visionary card is only in the objective deck from this many players.
  visionaryMinPlayers: 4,
  // Unleasher cards in the objective deck: a number, or tiers keyed by the
  // smallest player count, like action capacities. They share a victory.
  unleashers: { 3: 1, 6: 2 },
  playerNames: [],
  startingMoney: 3,
  // The mob threshold, the same at every player count.
  suspicionMax: 10,
  maxIgors: 3, // including the starting Igor(s)
  startingIgors: 1,
  marketSize: 4,
  // Vitality is a known total, checked when preparing; Humanity is one roll
  // of baseDie plus every Humanity die, checked at resolution (spec 025).
  resurrection: {
    baseDie: 20,
    thresholds: { vitality: 10, humanity: 20 },
  },
  // Subduing a monster whose Humanity failed (spec 025).
  control: {
    // A control roll succeeds on baseDie + control science >= threshold.
    baseDie: 20,
    threshold: 20,
    declineSuspicion: 2,
    subdueSuspicion: 1,
  },
  // capacity: null = unlimited; a number = the same at every player count; or
  //   an object keyed by the smallest player count of each tier, e.g.
  //   { 3: 2, 5: 3 } = 2 slots with 3-4 players, 3 slots with 5-6.
  // igor: false = Scientist only; scientist: false = Igor only.
  // suspicion: added, flat, after the action's other effects.
  actions: {
    medicine: { phase: 'day', name: 'Practice medicine', location: 'Hospital', capacity: null, igor: true, gain: 3 },
    research: { phase: 'day', name: 'Conduct research', location: 'University', capacity: { 3: 2, 5: 3 }, igor: true, cost: 2 },
    specimens: { phase: 'day', name: 'Buy specimens', location: 'Anatomical supplier', capacity: { 3: 2, 5: 3 }, igor: true, cost: 2, draw: 3 },
    charity: { phase: 'day', name: 'Donate to charity', location: 'Town hall', capacity: { 3: 2, 5: 3 }, igor: true, cost: 3, reduction: 2, maxUnits: 1 },
    hire: { phase: 'day', name: 'Hire an Igor', location: 'Tavern', capacity: { 3: 2, 5: 3 }, igor: true, cost: 4 },
    garrison: { phase: 'day', name: 'Garrison the watch', location: 'Watch house', capacity: 3, igor: true, scientist: false },
    prepare: { phase: 'night', name: 'Prepare resurrection', location: 'Private laboratory', capacity: null, igor: false },
    sell: { phase: 'night', name: 'Sell parts', location: 'Back alley', capacity: { 3: 2, 5: 3 }, igor: true, gain: 7, parts: 2, suspicion: 1 },
    experiment: { phase: 'night', name: 'Conduct experiments', location: 'Private laboratory', capacity: { 3: 2, 5: 3 }, igor: true, parts: 2, cards: 2, suspicion: 1 },
    graves: { phase: 'night', name: 'Rob graves', location: 'Graveyard', capacity: { 3: 2, 5: 3 }, igor: true, parts: 2, suspicion: 1 },
    vespers: { phase: 'night', name: 'Attend vespers', location: 'Chapel', capacity: null, igor: true, reduction: 1 },
    rest: { phase: 'night', name: 'Rest', location: 'Home', capacity: 1, igor: true },
  },
  partTypes: {
    arm: { name: 'Arm', slots: ['arm1', 'arm2'] },
    leg: { name: 'Leg', slots: ['leg1', 'leg2'] },
    chest: { name: 'Chest', slots: ['chest'] },
    head: { name: 'Head', slots: ['head'] },
  },
  // The body-part deck: `copies` cards of each variant (spec 024). Effects:
  // Vitality { op: 'fixed', amount } and Humanity { op: 'die', die, sign }.
  partVariants: {
    ordinary_arm: { name: 'Ordinary arm', type: 'arm', copies: 5, effects: [{ attribute: 'vitality', op: 'fixed', amount: 1 }] },
    labourer_arm: { name: 'Arm of a labourer', type: 'arm', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: 3 }] },
    blacksmith_arm: { name: 'Arm of a blacksmith', type: 'arm', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 4 }, { attribute: 'humanity', op: 'die', die: 4, sign: -1 }] },
    surgeon_arm: { name: 'Arm of a surgeon', type: 'arm', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 1 }, { attribute: 'humanity', op: 'die', die: 4, sign: 1 }] },
    strangler_arm: { name: 'Arm of a strangler', type: 'arm', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: 2 }, { attribute: 'humanity', op: 'die', die: 6, sign: -1 }] },
    damaged_arm: { name: 'Damaged arm', type: 'arm', copies: 4, effects: [{ attribute: 'vitality', op: 'fixed', amount: -1 }] },
    withered_arm: { name: 'Withered arm', type: 'arm', copies: 3, effects: [{ attribute: 'vitality', op: 'fixed', amount: -2 }] },
    gangrenous_arm: { name: 'Gangrenous arm', type: 'arm', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: -3 }] },
    ordinary_leg: { name: 'Ordinary leg', type: 'leg', copies: 5, effects: [{ attribute: 'vitality', op: 'fixed', amount: 1 }] },
    athlete_leg: { name: 'Leg of an athlete', type: 'leg', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: 3 }] },
    highwayman_leg: { name: 'Leg of a highwayman', type: 'leg', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 3 }, { attribute: 'humanity', op: 'die', die: 6, sign: -1 }] },
    soldier_leg: { name: 'Leg of a soldier', type: 'leg', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: 2 }, { attribute: 'humanity', op: 'die', die: 4, sign: -1 }] },
    dancer_leg: { name: 'Leg of a dancer', type: 'leg', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 1 }, { attribute: 'humanity', op: 'die', die: 4, sign: 1 }] },
    frail_leg: { name: 'Frail leg', type: 'leg', copies: 4, effects: [{ attribute: 'vitality', op: 'fixed', amount: -1 }] },
    lame_leg: { name: 'Lame leg', type: 'leg', copies: 3, effects: [{ attribute: 'vitality', op: 'fixed', amount: -2 }] },
    crushed_leg: { name: 'Crushed leg', type: 'leg', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: -3 }] },
    ordinary_chest: { name: 'Ordinary chest', type: 'chest', copies: 3, effects: [{ attribute: 'vitality', op: 'fixed', amount: 2 }] },
    robust_chest: { name: 'Robust chest', type: 'chest', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 4 }] },
    prizefighter_chest: { name: 'Chest of a prizefighter', type: 'chest', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 4 }, { attribute: 'humanity', op: 'die', die: 6, sign: -1 }] },
    priest_chest: { name: 'Chest of a priest', type: 'chest', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 1 }, { attribute: 'humanity', op: 'die', die: 6, sign: 1 }] },
    scarred_chest: { name: 'Scarred chest', type: 'chest', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: -1 }] },
    consumptive_chest: { name: 'Consumptive chest', type: 'chest', copies: 2, effects: [{ attribute: 'vitality', op: 'fixed', amount: -3 }] },
    ordinary_head: { name: 'Ordinary head', type: 'head', copies: 3, effects: [] },
    scholar_brain: { name: 'Brain of a scholar', type: 'head', copies: 1, effects: [{ attribute: 'humanity', op: 'die', die: 6, sign: 1 }] },
    poet_brain: { name: 'Brain of a poet', type: 'head', copies: 1, effects: [{ attribute: 'humanity', op: 'die', die: 4, sign: 1 }] },
    saint_brain: { name: 'Brain of a saint', type: 'head', copies: 1, effects: [{ attribute: 'humanity', op: 'die', die: 8, sign: 1 }] },
    criminal_brain: { name: 'Brain of a criminal', type: 'head', copies: 2, effects: [{ attribute: 'humanity', op: 'die', die: 6, sign: -1 }] },
    madman_brain: { name: 'Brain of a madman', type: 'head', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: 2 }, { attribute: 'humanity', op: 'die', die: 8, sign: -1 }] },
    drunkard_brain: { name: 'Brain of a drunkard', type: 'head', copies: 1, effects: [{ attribute: 'vitality', op: 'fixed', amount: -1 }, { attribute: 'humanity', op: 'die', die: 4, sign: -1 }] },
  },
  // Science (spec 023): every card held applies; every effect is positive.
  // Kinds: resurrection (Vitality fixed or Humanity die), control (a die or
  // fixed amount added to control rolls), medicineBonus, researchCalm
  // (suspicion lowered when the holder conducts research), charityBonus
  // (extra reduction per charity unit), subdueOwn (subdue your own monster
  // without a garrison). `copies` is the number of cards in the deck.
  science: {
    anatomy: { name: 'Comparative Anatomy', kind: 'vitality', copies: 5, text: 'Vitality +1.', effects: [{ kind: 'resurrection', attribute: 'vitality', op: 'fixed', amount: 1 }] },
    galvanism: { name: 'Galvanic Mastery', kind: 'vitality', copies: 4, text: 'Vitality +2.', effects: [{ kind: 'resurrection', attribute: 'vitality', op: 'fixed', amount: 2 }] },
    voltaic: { name: 'Voltaic Pile', kind: 'vitality', copies: 2, text: 'Vitality +3.', effects: [{ kind: 'resurrection', attribute: 'vitality', op: 'fixed', amount: 3 }] },
    sentiment: { name: 'Sentimental Education', kind: 'humanity', copies: 4, text: 'Humanity +d4.', effects: [{ kind: 'resurrection', attribute: 'humanity', op: 'die', die: 4, sign: 1 }] },
    philosophy: { name: 'Moral Philosophy', kind: 'humanity', copies: 4, text: 'Humanity +d6.', effects: [{ kind: 'resurrection', attribute: 'humanity', op: 'die', die: 6, sign: 1 }] },
    theology: { name: 'Natural Theology', kind: 'humanity', copies: 2, text: 'Humanity +d8.', effects: [{ kind: 'resurrection', attribute: 'humanity', op: 'die', die: 8, sign: 1 }] },
    restraint: { name: 'Restraining Apparatus', kind: 'control', copies: 3, text: 'Control +3.', effects: [{ kind: 'control', op: 'fixed', amount: 3 }] },
    mesmerism: { name: 'Mesmerism', kind: 'control', copies: 3, text: 'Control +d6.', effects: [{ kind: 'control', op: 'die', die: 6, sign: 1 }] },
    medicine: { name: 'Medical Expertise', kind: 'other', copies: 1, text: '+1 money from Practice medicine.', effects: [{ kind: 'medicineBonus', amount: 1 }] },
    lectures: { name: 'Public Lectures', kind: 'other', copies: 1, text: 'When you conduct research, suspicion −1.', effects: [{ kind: 'researchCalm', amount: 1 }] },
    benefactor: { name: 'Parish Benefactor', kind: 'other', copies: 1, text: 'Your charity removes 1 more suspicion per unit.', effects: [{ kind: 'charityBonus', amount: 1 }] },
    neurology: { name: 'Neural Conditioning', kind: 'other', copies: 1, text: 'You may subdue your own monster without a garrison.', effects: [{ kind: 'subdueOwn' }] },
  },
};
