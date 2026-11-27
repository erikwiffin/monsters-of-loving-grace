// Data-driven game definitions and balance constants.
// Everything here is copied into the game state's `config` at creation, so
// experiments can override any value via createGame(configOverrides, seed).

export const ENGINE_VERSION = '0.12.0';
export const SCHEMA_VERSION = 8;

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
  researchCopies: 4,
  resurrection: {
    baseDie: 20,
    thresholds: { vitality: 20, humanity: 20 },
    failedVitalityRefund: 3,
    failedVitalitySuspicion: 1,
  },
  // Subduing a monster whose Humanity failed (spec 025).
  control: {
    startingAttempts: 3,
    // A control attempt succeeds on baseDie + research modifiers >= threshold.
    baseDie: 20,
    threshold: 20,
    declineSuspicion: 2,
    subdueSuspicion: 1,
    subdueSalvage: 3,
  },
  // capacity: null = unlimited; a number = the same at every player count; or
  //   an object keyed by the smallest player count of each tier, e.g.
  //   { 3: 2, 5: 3 } = 2 slots with 3-4 players, 3 slots with 5-6.
  // igor: false = Scientist only; scientist: false = Igor only.
  // suspicion: a discovery roll. Roll `die`; the first band whose `max` is at
  //   least the roll adds its `amount` (before Discreet Methods); a roll above
  //   every band adds nothing.
  actions: {
    medicine: { phase: 'day', name: 'Practise medicine', location: 'Hospital', capacity: null, igor: true, gain: 3 },
    research: { phase: 'day', name: 'Conduct research', location: 'University', capacity: { 3: 2, 5: 3 }, igor: true, cost: 2 },
    specimens: { phase: 'day', name: 'Buy specimens', location: 'Anatomical supplier', capacity: { 3: 2, 5: 3 }, igor: true, cost: 2, count: 1 },
    charity: { phase: 'day', name: 'Donate to charity', location: 'Town hall', capacity: { 3: 2, 5: 3 }, igor: true, cost: 3, reduction: 2, maxUnits: 1 },
    hire: { phase: 'day', name: 'Hire an Igor', location: 'Tavern', capacity: { 3: 2, 5: 3 }, igor: true, cost: 4 },
    garrison: { phase: 'day', name: 'Garrison the watch', location: 'Watch house', capacity: 3, igor: true, scientist: false },
    assemble: { phase: 'night', name: 'Assemble body', location: 'Private laboratory', capacity: null, igor: true, max: null }, // max: null = any number of parts
    prepare: { phase: 'night', name: 'Prepare resurrection', location: 'Private laboratory', capacity: null, igor: false },
    sell: { phase: 'night', name: 'Sell parts', location: 'Back alley', capacity: { 3: 2, 5: 3 }, igor: true, gain: 7, parts: 2, suspicion: { die: 6, bands: [{ max: 2, amount: 1 }] } },
    experiment: { phase: 'night', name: 'Conduct experiments', location: 'Private laboratory', capacity: { 3: 2, 5: 3 }, igor: true, maxParts: 3, suspicion: { die: 6, bands: [{ max: 3, amount: 1 }] } },
    graves: { phase: 'night', name: 'Rob graves', location: 'Graveyard', capacity: { 3: 2, 5: 3 }, igor: true, parts: 2, suspicion: { die: 6, bands: [{ max: 4, amount: 1 }] } },
    rest: { phase: 'night', name: 'Rest', location: 'Home', capacity: 1, igor: true },
  },
  partTypes: {
    arm: { name: 'Arm', slots: ['arm1', 'arm2'], weight: 2 },
    leg: { name: 'Leg', slots: ['leg1', 'leg2'], weight: 2 },
    chest: { name: 'Chest', slots: ['chest'], weight: 1 },
    head: { name: 'Head', slots: ['head'], weight: 1 },
  },
  // Effects: { attribute, op: 'die' | 'fixed' | 'threshold', die?, sign?, amount? }
  partVariants: {
    ordinary_arm: { name: 'Ordinary arm', type: 'arm', effects: [] },
    labourer_arm: { name: 'Arm of a labourer', type: 'arm', effects: [{ attribute: 'vitality', op: 'die', die: 4, sign: 1 }] },
    damaged_arm: { name: 'Damaged arm', type: 'arm', effects: [{ attribute: 'vitality', op: 'die', die: 4, sign: -1 }] },
    ordinary_leg: { name: 'Ordinary leg', type: 'leg', effects: [] },
    athlete_leg: { name: 'Leg of an athlete', type: 'leg', effects: [{ attribute: 'vitality', op: 'die', die: 6, sign: 1 }] },
    frail_leg: { name: 'Frail leg', type: 'leg', effects: [{ attribute: 'vitality', op: 'fixed', amount: -2 }] },
    ordinary_chest: { name: 'Ordinary chest', type: 'chest', effects: [] },
    robust_chest: { name: 'Robust chest', type: 'chest', effects: [{ attribute: 'vitality', op: 'die', die: 8, sign: 1 }] },
    scarred_chest: { name: 'Scarred chest', type: 'chest', effects: [{ attribute: 'vitality', op: 'die', die: 6, sign: -1 }] },
    ordinary_head: { name: 'Ordinary head', type: 'head', effects: [] },
    criminal_brain: { name: 'Brain of a criminal', type: 'head', effects: [{ attribute: 'humanity', op: 'threshold', amount: 3 }] },
    scholar_brain: { name: 'Brain of a scholar', type: 'head', effects: [{ attribute: 'humanity', op: 'die', die: 6, sign: 1 }] },
    poet_brain: { name: 'Brain of a poet', type: 'head', effects: [{ attribute: 'humanity', op: 'die', die: 4, sign: 1 }] },
  },
  // Research effect kinds: medicineBonus, suspicionReduction, controlAttempts,
  // control ({ op: 'die' | 'fixed', ... } added to control rolls),
  // resurrection (same shape as part effects), researchCalm (suspicion lowered
  // when the holder conducts research), charityBonus (extra reduction per
  // charity unit). Every effective copy applies. A type may set `copies`
  // (default researchCopies); the engine also supports experimental kinds and
  // `stacks: false` for configuration overrides (see experiments/).
  research: {
    discretion: { name: 'Discreet Methods', text: 'Reduce suspicion from each graves, sell or experiment action by 1 (floor 0).', effects: [{ kind: 'suspicionReduction', amount: 1 }] },
    galvanism: { name: 'Galvanic Mastery', text: 'Add 1d6 to resurrection Vitality.', effects: [{ kind: 'resurrection', attribute: 'vitality', op: 'die', die: 6, sign: 1 }] },
    medicine: { name: 'Medical Expertise', text: '+1 money on medicine, for any worker.', effects: [{ kind: 'medicineBonus', amount: 1 }] },
    neurology: { name: 'Neural Conditioning', text: '+1 control attempt for subduing monsters.', effects: [{ kind: 'controlAttempts', amount: 1 }] },
    mesmerism: { name: 'Mesmerism', text: 'Add 1d6 to control rolls.', effects: [{ kind: 'control', op: 'die', die: 6, sign: 1 }] },
    restraint: { name: 'Restraining Apparatus', text: 'Add +4 to control rolls.', effects: [{ kind: 'control', op: 'fixed', amount: 4 }] },
    philosophy: { name: 'Moral Philosophy', text: 'Add +3 to resurrection Humanity.', effects: [{ kind: 'resurrection', attribute: 'humanity', op: 'fixed', amount: 3 }] },
    lectures: { name: 'Public Lectures', text: 'When you conduct research, suspicion −1.', effects: [{ kind: 'researchCalm', amount: 1 }] },
    benefactor: { name: 'Parish Benefactor', text: 'Your charity removes 1 more suspicion per unit.', effects: [{ kind: 'charityBonus', amount: 1 }] },
  },
};
