const bcrypt = require('bcryptjs');
const db = require('./db');

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  const credentials = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const [username, password] = credentials.split(':');

  const user = db.prepare('SELECT password_hash FROM admin_users WHERE username = ?').get(username);
  // Use a dummy hash when user not found to prevent timing attacks on username enumeration
  const hash = user ? user.password_hash : '$2b$10$abcdefghijklmnopqrstuvxabcdefghijklmnopqrstu';
  const valid = bcrypt.compareSync(password, hash);
  if (!user || !valid) {
    // Do NOT send WWW-Authenticate when credentials were provided but invalid.
    // Sending it triggers the browser's native auth dialog, which overrides
    // the custom login page and confuses users. Only challenge when no
    // credentials were sent at all.
    return res.status(401).send('Invalid credentials');
  }
  next();
}

module.exports = { requireAuth };
