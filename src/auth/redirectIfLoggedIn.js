const jwt = require("jsonwebtoken");

const redirectIfLoggedIn = (target) => (req, res, next) => {
  const token = req.cookies.token || "";

  if (!token) return next();

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return res.redirect(target);
  } catch (err) {
    return next();
  }
};

module.exports = redirectIfLoggedIn;
