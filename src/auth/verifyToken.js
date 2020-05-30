const jwt = require("jsonwebtoken");

const verifyToken = async (req, res, next) => {
  const token = req.cookies.token || "";

  if (!token) return res.redirect("/login");

  try {
    req.user = await jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.redirect("/login");
  }
};

module.exports = verifyToken;
