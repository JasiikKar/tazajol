// Observer: when a report's status changes, notify everyone who upvoted it (except the person who changed it).
function registerNotifier(bus, repo) {
  bus.on('status.changed', async ({ id, to, by }) => {
    try { await repo.notifyVoters(id, to, by); } catch (e) { console.error('notifier failed', e.message); }
  });
}
module.exports = { registerNotifier };
