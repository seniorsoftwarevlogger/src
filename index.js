const Sentry = require("@sentry/node");
const fetch = require("node-fetch");
const GhostContentAPI = require("@tryghost/content-api");

const patreonModule = require("patreon");
const JsonApiDataStore = require("jsonapi-datastore").JsonApiDataStore;

const { google } = require("googleapis");

const express = require("express");
const handlebars = require("express-handlebars");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const generateToken = require("./src/auth/generateToken");
const verifyToken = require("./src/auth/verifyToken");
const redirectIfLoggedIn = require("./src/auth/redirectIfLoggedIn");

const format = require("url").format;

const { oauth } = patreonModule;

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

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

app.engine("handlebars", handlebars());
app.set("view engine", "handlebars");

const clientId = process.env.PATREON_CLIENT_ID;
const clientSecret = process.env.PATREON_CLIENT_SECRET;
const patreonRedirect =
  process.env.PATREON_REDIRECT_URL ||
  "http://localhost:5000/oauth/redirect/patreon";

const oauthClient = oauth(clientId, clientSecret);

const patreonUrl = format({
  protocol: "https",
  host: "patreon.com",
  pathname: "/oauth2/authorize",
  query: {
    response_type: "code",
    client_id: clientId,
    redirect_uri: patreonRedirect,
    state: "chill",
    scope: "identity identity[email]",
  },
});

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL ||
    "http://localhost:5000/oauth/redirect/youtube"
);

const scopes = ["https://www.googleapis.com/auth/youtube.readonly"];

const googleUrl = oauth2Client.generateAuthUrl({
  access_type: "online",
  scope: scopes,
  // prompt: "consent", // Uncomment to force consent screen
});

const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API,
  version: "v3",
});

app.get("/", redirectIfLoggedIn("/posts"));
app.get("/", function (req, res) {
  ghostApi.pages
    .read({ slug: "index" }, { formats: ["html"] })
    .then((page) => res.render("index", { ...page }))
    .catch((err) => renderError(res, err));
});

app.get("/posts", verifyToken, checkMembership, function (req, res) {
  const tags = tagsForLevel(req.user.level);

  ghostApi.posts
    .browse({
      limit: 25,
      filter: tags,
    })
    .then((posts) => res.render("home", { posts, user: req.user }))
    .catch((err) => renderError(res, err));
});

app.get("/privacy", function (req, res) {
  ghostApi.pages
    .read({ slug: "privacy" }, { formats: ["html"] })
    .then((page) => res.render("post", { post: page }))
    .catch((err) => renderError(res, err));
});

app.get("/posts/:slug", verifyToken, checkMembership, (req, res) => {
  const tags = tagsForLevel(req.user.level);

  ghostApi.posts
    .browse({ limit: 1, filter: `${tags} + slug:${req.params.slug}` })
    .then((posts) => {
      if (posts.length === 1) {
        return posts[0];
      }

      return {
        title: "🔒 Пост недоступен",
        html: "<p>Пост доступен со следующего уровня поддержки.</p>",
      };
    })
    .then((post) => res.render("post", { post }))
    .catch((err) => renderError(res, err));
});

app.get("/login", redirectIfLoggedIn("/posts"));
app.get("/login", function (req, res) {
  res.render("login", { patreonUrl, googleUrl, layout: "login" });
});

app.get("/oauth/redirect/youtube", (req, res) => {
  const { code } = req.query;

  oauth2Client
    .getToken(code)
    .then(({ tokens }) => {
      oauth2Client.setCredentials(tokens);

      google
        .youtube({ version: "v3", auth: oauth2Client })
        .channels.list({
          part: "snippet",
          mine: true,
        })
        .then((response) => {
          if (response.errors) {
            // The response structure is different in case of errors ¯\_(ツ)_/¯
            return renderError(res, response.errors);
          }

          // store JWT
          generateToken(res, {
            name: response.data.items[0].snippet.title,
            photo_url: response.data.items[0].snippet.thumbnails.medium.url,
            url: `https://www.youtube.com/channel/${response.data.items[0].id}`,
            youtube: {
              accessToken: tokens.access_token,
              channelId: response.data.items[0].id,
            },
          });

          res.redirect("/posts");
        })
        .catch((err) => renderError(res, err));
    })
    .catch((err) => renderError(res, err));
});

app.get("/oauth/redirect/patreon", (req, res) => {
  const { code } = req.query;

  return oauthClient
    .getTokens(code, patreonRedirect)
    .then(({ access_token }) => {
      generateToken(res, {
        name: "",
        photo_url: "",
        url: "",
        patreon: {
          accessToken: access_token,
        },
      });

      res.redirect("/posts");
    })
    .catch((err) => renderError(res, err));
});

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

function checkMembership(req, res, next) {
  if (req.user.patreon) {
    const patreonLevelMapping = {
      "Стрим, видео без рекламы и письма": "entry",
      "Стрим + видео без рекламы": "basic",
      "Доступ в закулисье": "advanced",
    };

    fetch(
      `https://www.patreon.com/api/oauth2/v2/identity?include=memberships,memberships.currently_entitled_tiers&fields%5Buser%5D=full_name,image_url,url&fields%5Bmember%5D=full_name,patron_status,last_charge_date&fields%5Btier%5D=title`,
      {
        headers: {
          Authorization: `Bearer ${req.user.patreon.accessToken}`,
        },
      }
    )
      .then((res) => res.json())
      .then((json) => {
        if (json.errors && json.errors[0].status === "401") {
          renderError(res, json.errors);
        } else {
          const store = new JsonApiDataStore();
          store.sync(json);

          const tier = store.findAll("tier")[0];

          if (tier) {
            req.user.level = patreonLevelMapping[tier.title];
            req.user.name = store.findAll("user")[0].full_name;
            req.user.photo_url = store.findAll("user")[0].image_url;
            req.user.url = store.findAll("user")[0].url;
            console.log(
              `${store.findAll("tier")[0].title} : ${req.user.level}`
            );

            next();
          } else {
            renderError(res, ["Похоже, что у вас нет реги"]);
          }
        }
      })
      .catch((err) => renderError(res, err));
  } else if (req.user.youtube) {
// Extract from the studio :)
// JSON.stringify(
//     Object.fromEntries(
//     $x("//*[contains(@class, 'row style-scope ytsp-sponsors-dialog')]").map((tr) => {
//         const link = $("a", tr).getAttribute("href").split("/")[4];
//         const level = $(".sponsor-current_tier", tr).innerText;
// console.log(level);
//         return [link, level];
//     })
//     )
// );

    const knownYoutubeMembers = JSON.parse(process.env.YOUTUBE_MEMBERS);
    const youtubeLevelMapping = {
      admin: "admin",
      "Стрим + чат": "basic",
      "Эксклюзив и черновики": "advanced",
    };

    oauth2Client.setCredentials({
      access_token: req.user.youtube.accessToken,
    });

    google
      .youtube({ version: "v3", auth: oauth2Client })
      .channels.list({
        part: "snippet",
        mine: true,
      })
      .then((response) => {
        const knownUser = response.data.items.find(
          ({ id }) => knownYoutubeMembers[id]
        );
        if (knownUser != null) {
          req.user.level =
            youtubeLevelMapping[knownYoutubeMembers[knownUser.id]];

          console.log(`${knownUser.id} : ${req.user.level}`);

          next();
        } else {
          renderError(res, ["Похоже, что у вас нет реги", response.data.items]);
        }
      })
      .catch((err) => renderError(res, err));
  }
}

function tagsForLevel(level) {
  return (
    {
      entry: `tags:[hash-basic]`,
      basic: `tags:[hash-basic]`,
      advanced: `tags:[hash-basic, hash-advanced]`,
      admin: `tags:[hash-basic, hash-advanced]`,
    }[level] || "tags:[hash-basic]"
  );
}
