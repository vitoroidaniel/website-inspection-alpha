// middleware/auth.js — Session-based role guards

const auth = (req, res, next) =>
  req.session.user ? next() : res.redirect('/login');

const agent = (req, res, next) =>
  req.session.user && ['agent', 'superadmin'].includes(req.session.user.role)
    ? next()
    : res.status(403).json({ error: 'Access denied' });

const admin = (req, res, next) =>
  req.session.user && req.session.user.role === 'superadmin'
    ? next()
    : res.status(403).json({ error: 'Admin only' });

const driver = (req, res, next) =>
  req.session.user && req.session.user.role === 'driver'
    ? next()
    : res.status(403).json({ error: 'Access denied' });

module.exports = { auth, agent, admin, driver };
