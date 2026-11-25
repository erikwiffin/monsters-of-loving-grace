// Data-driven game definitions and balance constants.
// Everything here is copied into the game state's `config` at creation, so
// experiments can override any value via createGame(configOverrides, seed).

export const ENGINE_VERSION = '0.10.0';
export const SCHEMA_VERSION = 7;

export const SLOT_ORDER = ['arm1', 'arm2', 'leg1', 'leg2', 'chest', 'head'];
export const ATTRIBUTES = ['vitality', 'humanity'];
export const ALLOWED_DICE = [4, 6, 8, 10, 12, 20];
export const PHASES = ['day', 'night', 'commitment', 'resolution', 'dawn', 'ended'];

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
  playerNames: [],
  startingMoney: 3,
  // The mob threshold. null: take it from suspicionMaxByPlayers for the player count.
  suspicionMax: null,
  suspicionMaxByPlayers: { 3: 10, 4: 10, 5: 9, 6: 8 },
  maxIgors: 3, // including the starting Igor(s)
  startingIgors: 1,
  igorCosts: [4, 7, 10],
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
  // capacity: null means unlimited. igor: whether a hired Igor may take it.
  actions: {
    medicine: { phase: 'day', name: 'Practise medicine', location: 'Hospital', capacity: 2, igor: true, gain: 3 },
    research: { phase: 'day', name: 'Study research', location: 'University', capacity: 2, igor: false, cost: 2 },
    specimens: { phase: 'day', name: 'Buy specimens', location: 'Anatomical supplier', capacity: 2, igor: true, cost: 2, count: 1 },
    hire: { phase: 'day', name: 'Hire an Igor', location: 'Tavern', capacity: null, igor: false },
    charity: { phase: 'day', name: 'Donate to charity', location: 'Town hall', capacity: null, igor: true, cost: 3, reduction: 2 },
    // cap: null means no cap on lecture income.
    lecture: { phase: 'day', name: 'Give a lecture', location: 'Scientific society', capacity: 2, igor: false, base: 1, cap: null },
    // scientist: false makes an action Igor-only.
    garrison: { phase: 'day', name: 'Garrison the watch', location: 'Watch house', capacity: 2, igor: true, scientist: false },
    graves: { phase: 'night', name: 'Rob graves', location: 'Graveyard', capacity: 2, igor: true, parts: 2, suspicionTable: [1, 1, 1, 1, 0, 0] },
    // Morgue: draw `parts` random parts, keep one of them, discard the rest.
    morgue: { phase: 'night', name: 'Raid the morgue', location: 'Morgue', capacity: 1, igor: true, parts: 3, keep: 1, suspicionTable: [2, 2, 1, 1, 0, 0] },
    assemble: { phase: 'night', name: 'Assemble body', location: 'Private laboratory', capacity: null, igor: true, max: null }, // max: null = any number of parts
    experiment: { phase: 'night', name: 'Experiment', location: 'Private laboratory', capacity: null, igor: false, partCost: 2 },
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
  // resurrection (same shape as part effects). Every effective copy applies.
  research: {
    discretion: { name: 'Discreet Methods', text: 'Reduce suspicion from each graves or morgue action by 1 (floor 0).', effects: [{ kind: 'suspicionReduction', amount: 1 }] },
    galvanism: { name: 'Galvanic Mastery', text: 'Add 1d6 to resurrection Vitality.', effects: [{ kind: 'resurrection', attribute: 'vitality', op: 'die', die: 6, sign: 1 }] },
    medicine: { name: 'Medical Expertise', text: '+1 money on medicine, for any worker.', effects: [{ kind: 'medicineBonus', amount: 1 }] },
    neurology: { name: 'Neural Conditioning', text: '+1 control attempt for subduing monsters.', effects: [{ kind: 'controlAttempts', amount: 1 }] },
    mesmerism: { name: 'Mesmerism', text: 'Add 1d6 to control rolls.', effects: [{ kind: 'control', op: 'die', die: 6, sign: 1 }] },
    restraint: { name: 'Restraining Apparatus', text: 'Add +4 to control rolls.', effects: [{ kind: 'control', op: 'fixed', amount: 4 }] },
    philosophy: { name: 'Moral Philosophy', text: 'Add +5 to resurrection Humanity.', effects: [{ kind: 'resurrection', attribute: 'humanity', op: 'fixed', amount: 5 }] },
  },
};
