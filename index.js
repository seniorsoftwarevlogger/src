require("dotenv").config();

const Sentry = require("@sentry/node");

const GhostContentAPI = require("@tryghost/content-api");

const google = require("@googleapis/youtube");

const firebaseAdmin = require("firebase-admin");
const fs = require("fs");

const express = require("express");
const handlebars = require("express-handlebars");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const getYoutubeHandler = require("./src/youtube/handler");

const serviceAccount = fs.readFileSync(process.env.FIREBASE_CREDENTIALS);
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(JSON.parse(serviceAccount)),
  databaseURL: process.env.DATABASEURL,
  databaseAuthVariableOverride: {
    uid: process.env.AUTH_UID,
  },
});

const firebase = firebaseAdmin.database();

const app = express();

Sentry.init({ dsn: process.env.SENTRY_DSN });

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());

app.use(
  morgan("tiny", {
    skip: function (req, res) {
      return req.path.startsWith("/assets");
    },
  })
);
app.use(helmet());
app.use(express.static("public"));
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5000", "https://src.seniorsoftwarevlogger.com"],
    credentials: true,
  })
);
app.use(cookieParser());
app.use(compression());

app.engine("handlebars", handlebars.engine());
app.set("view engine", "handlebars");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL ||
    "http://localhost:5000/oauth/redirect/youtube"
);

const scopes = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const googleUrl = oauth2Client.generateAuthUrl({
  access_type: "online",
  scope: scopes,
  // prompt: "consent", // Uncomment to force consent screen
});

const ghostContentApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API,
  version: "v3",
});

app.get("/", function (req, res) {
  ghostContentApi.pages
    .read({ slug: "src-index" }, { formats: ["html"] })
    .then((page) => res.render("index", { ...page }))
    .catch((err) => renderError(res, err));
});

app.get("/privacy", function (req, res) {
  ghostContentApi.pages
    .read({ slug: "privacy" }, { formats: ["html"] })
    .then((page) => res.render("post", { post: page }))
    .catch((err) => renderError(res, err));
});

app.get("/login", function (req, res) {
  res.render("login", { googleUrl, layout: "login" });
});

app.get("/oauth/redirect/youtube", getYoutubeHandler(firebase, oauth2Client));

app.get("/logout", (req, res) => {
  res.cookie("token", "", {
    expires: new Date(Date.now()),
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });

  res.redirect("/");
});

const server = app.listen(process.env.PORT || 5000, () => {
  const { port } = server.address();
  console.log(`Listening on http:/localhost:${port}`);
});

function renderError(res, err) {
  console.log(err);
  res.render("error", { error: JSON.stringify(err, null, 4) });
}
