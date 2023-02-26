const google = require("@googleapis/youtube");
const google_oauth2 = require("@googleapis/oauth2");
const GhostAdminAPI = require("@tryghost/admin-api");

const tiers = {
  "Архив семьи": "63b994d7550c9b6ec3fef9cf",
  "Добро пожаловать в семью!": "63b99523550c9b6ec3fef9d5",
  "Секреты семьи": "63b99553550c9b6ec3fef9dd",
  "Виртуальный друг": "63b99598550c9b6ec3fef9e3",
};

const ghostAdminApi = new GhostAdminAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_ADMIN_API,
  version: "v5.0",
});

module.exports = function getYoutubeHandler(firebase, oauth2Client) {
  return async function (req, res) {
    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const googleAuth = google_oauth2.oauth2({
      version: "v2",
      auth: oauth2Client,
    });

    const getChannel = google
      .youtube({
        version: "v3",
        auth: oauth2Client,
      })
      .channels.list({
        part: "snippet",
        mine: true,
      });

    const [emailResult, channelResult] = await Promise.allSettled([
      googleAuth.userinfo.get(),
      getChannel,
    ]);

    if (
      emailResult.status === "rejected" ||
      channelResult.status === "rejected"
    ) {
      return renderError(res, [emailResult.reason, channelResult.reason]);
    }

    // check if user exists in firebase
    const channelId = channelResult?.value?.data?.items[0]?.id;
    const youtubeMemberRef = await firebase
      .ref(`/youtube-members/${channelId}`)
      .get();

    if (!youtubeMemberRef.exists()) {
      return renderError(res, ["Похоже у вас нет реги на ютубе"]);
    }

    const subscription = {
      tier: tiers[youtubeMemberRef.val().tier],
      plan: {
        id: "",
        nickname: "Complimentary",
        interval: "year",
        currency: "USD",
        amount: 0,
      },
    };

    // check if user already exists in ghost
    const memberInGhost = await ghostAdminApi.members.browse({
      filter: `email:${emailResult.value.data.email}`,
    });

    if (memberInGhost.meta.pagination.total === 0) {
      // create ghost member with ghost api
      await ghostAdminApi.members.add(
        {
          email: emailResult.value.data.email,
          name: channelResult.value.data.items[0].snippet.title,
          note: `https://www.youtube.com/channel/${channelId}`,
          subscribed: true,
          labels: [],
          subscriptions: [subscription],
        },
        { send_email: true, email_type: "subscribe" }
      );
    } else if (memberInGhost[0] && memberInGhost[0].status === "free") {
      // add complementary subscription to existing user
      await ghostAdminApi.members.edit(
        {
          ...memberInGhost[0],
          status: "comped",
          comped: true,
          subscriptions: [subscription, ...memberInGhost[0].subscriptions],
        },
        { send_email: true, email_type: "subscribe" }
      );
    } else {
      // existing member with paid or comped subscription, do nothing
    }

    res.redirect("https://seniorsoftwarevlogger.com");
  };
};
