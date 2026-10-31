// State pattern: the report lifecycle. Only valid transitions are allowed.
const TRANSITIONS = { new: ['in_progress', 'fixed'], in_progress: ['fixed'], fixed: ['in_progress'] };
module.exports = {
  STATUSES: Object.keys(TRANSITIONS),
  allowedNext: (s) => TRANSITIONS[s] || [],
  canMove: (from, to) => (TRANSITIONS[from] || []).includes(to),
};
