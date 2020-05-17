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

const format = require("url").format;

const { oauth } = patreonModule;

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const app = express();

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

const scopes = ["https://www.googleapis.com/auth/youtube"];

const googleUrl = oauth2Client.generateAuthUrl({
  access_type: "online",
  scope: scopes,
});

const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API,
  version: "v3",
});

app.get("/", verifyToken, checkMembership, function (req, res) {
  ghostApi.posts
    .browse({ limit: 5 })
    .then((posts) => res.render("home", { posts }))
    .catch((error) => res.render("error", { error }));
});

app.get("/privacy", verifyToken, checkMembership, function (req, res) {
  ghostApi.pages
    .read({ slug: "privacy" }, { formats: ["html"] })
    .then((page) => res.render("post", { post: page }))
    .catch((error) => res.render("error", { error }));
});

app.get("/posts/:slug", verifyToken, (req, res) => {
  ghostApi.posts
    .read({ slug: req.params.slug }, { formats: ["html"] })
    .then((post) => res.render("post", { post }))
    .catch((error) => res.render("error", { error }));
});

app.get("/login", function (req, res) {
  res.render("login", { patreonUrl, googleUrl, layout: "login" });
});

app.get("/oauth/redirect/youtube", (req, res) => {
  const { code } = req.query;

  oauth2Client.getToken(code).then(({ tokens }) => {
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
          console.log(errors);
          // res.status(response.code);
        }

        // store JWT
        generateToken(res, {
          name: response.data.items[0].snippet.title,
          youtube: {
            accessToken: tokens.access_token,
            channelId: response.data.items[0].id,
          },
        });
        res.redirect("/");
      })
      .catch((err) => {
        console.log(err);
        res.redirect("/");
      });
  });
});

app.get("/oauth/redirect/patreon", (req, res) => {
  const { code } = req.query;

  return oauthClient
    .getTokens(code, patreonRedirect)
    .then(({ access_token }) => {
      generateToken(res, {
        patreon: {
          accessToken: access_token,
        },
      });

      return res.redirect("/");
    })
    .catch((err) => {
      console.log(err);
      console.log("Redirecting to login");
      res.redirect("/");
    });
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

function checkMembership(req, res, next) {
  if (req.user.patreon) {
    const patreonLevelMapping = {
      "Стрим, видео без рекламы и письма": "entry",
      "Стрим + видео без рекламы": "basic",
      "Доступ в закулисье": "advanced",
    };

    fetch(
      `https://www.patreon.com/api/oauth2/v2/identity?include=memberships,memberships.currently_entitled_tiers&fields%5Bmember%5D=full_name,patron_status,last_charge_date&fields%5Btier%5D=title`,
      {
        headers: {
          Authorization: `Bearer ${req.user.patreon.accessToken}`,
        },
      }
    )
      .then((res) => res.json())
      .then((json) => {
        if (json.errors && json.errors[0].status === "401") {
          console.log(json.errors);
          res.render("error", { error: json.errors[0] });
        } else {
          const store = new JsonApiDataStore();
          store.sync(json);

          const tier = store.findAll("tier")[0];

          if (tier) {
            req.user.level = patreonLevelMapping[tier.title];
            console.log(
              `${store.findAll("tier")[0].title} : ${req.user.level}`
            );

            next();
          } else {
            console.log("User entitled to no tiers");
            res.redirect("/login");
          }
        }
      });
  } else if (req.user.youtube) {
    // Extract from the studio :)
    // JSON.stringify(
    //   Object.fromEntries(
    //     $x("//*[contains(@class, 'channel-name')]/ancestor::tr").map((tr) => {
    //       const link = $("a", tr).getAttribute("href").split("/")[4];
    //       const level = $("td:nth-of-type(3)", tr).innerHTML;
    //       return [link, level];
    //     })
    //   )
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
          console.log(`Unknown user`, response.data.items);
          res.render("error", {
            error: `Unknown user ${JSON.stringify(response.data.items)}`,
          });
        }
      })
      .catch((err) => {
        console.log(err);
        res.redirect("/login");
      });
  }
}
