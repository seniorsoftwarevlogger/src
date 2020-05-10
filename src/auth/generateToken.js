const jwt = require("jsonwebtoken");

const generateToken = (res, data) => {
  const expiration = 604800000;
  const token = jwt.sign(data, process.env.JWT_SECRET, {
    expiresIn: process.env.DB_ENV === "production" ? "7d" : "1d",
  });
  return res.cookie("token", token, {
    expires: new Date(Date.now() + expiration),
    secure: process.env.DB_ENV === "production",
    httpOnly: true,
  });
};
module.exports = generateToken;
