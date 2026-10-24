const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    req.user = { id: payload.sub, role: payload.role };

    
    req.mfaVerified = false;
    const mfa = req.headers['x-mfa-token'];
    if (mfa) {
      try {
        const m = jwt.verify(mfa, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        req.mfaVerified = m.mfa === true && m.sub === payload.sub;
      } catch (e) {  }
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};