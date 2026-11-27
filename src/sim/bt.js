// A minimal behaviour-tree library for decision policies.
//
// A decision is one tick of the tree. Each node's tick(bb) returns SUCCESS or
// FAILURE; there is no RUNNING state, because every engine decision is
// answered immediately with one command. Action leaves succeed by writing a
// command to bb.command. The blackboard (bb) holds the facts the tree's
// conditions and actions read, computed once per decision.
//
// When bb.trace is an array, every node visited is recorded as
// `depth name status`, which makes a decision easy to explain.

export const SUCCESS = 'success';
export const FAILURE = 'failure';

function record(bb, node, status, depth) {
  if (bb.trace && node.name) bb.trace.push(`${'  '.repeat(depth)}${node.name}: ${status}`);
  return status;
}

/** Ticks children in order; succeeds at the first child that succeeds. */
export function selector(name, ...children) {
  return {
    name,
    tick(bb, depth = 0) {
      for (const c of children) if (c.tick(bb, depth + 1) === SUCCESS) return record(bb, this, SUCCESS, depth);
      return record(bb, this, FAILURE, depth);
    },
  };
}

/** Ticks children in order; fails at the first child that fails. */
export function sequence(name, ...children) {
  return {
    name,
    tick(bb, depth = 0) {
      for (const c of children) if (c.tick(bb, depth + 1) === FAILURE) return record(bb, this, FAILURE, depth);
      return record(bb, this, SUCCESS, depth);
    },
  };
}

/** A leaf that succeeds when its predicate holds. */
export function condition(name, predicate) {
  return {
    name,
    tick(bb, depth = 0) { return record(bb, this, predicate(bb) ? SUCCESS : FAILURE, depth); },
  };
}

/**
 * A leaf that tries to produce a command. `make(bb)` returns a command, or
 * null when the action is not possible now. The command must be legal: the
 * leaf checks it against bb.isLegal before succeeding.
 */
export function action(name, make) {
  return {
    name,
    tick(bb, depth = 0) {
      const cmd = make(bb);
      if (!cmd || (bb.isLegal && !bb.isLegal(cmd))) return record(bb, this, FAILURE, depth);
      bb.command = cmd;
      return record(bb, this, SUCCESS, depth);
    },
  };
}

/** Inverts a child's result. */
export function not(name, child) {
  return {
    name,
    tick(bb, depth = 0) { return record(bb, this, child.tick(bb, depth + 1) === SUCCESS ? FAILURE : SUCCESS, depth); },
  };
}

/** Shorthand: run `children` only when `predicate` holds. */
export function guard(name, predicate, ...children) {
  return sequence(name, condition(`${name}?`, predicate), selector(`${name}:do`, ...children));
}
