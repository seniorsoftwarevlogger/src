require("dotenv").config();

const fetch = require("node-fetch");
const GhostAdminAPI = require("@tryghost/admin-api");

const api = new GhostAdminAPI({
  key: process.env.GHOST_ADMIN_API,
  url: process.env.GHOST_URL,
  version: "v3",
});

const campaignId = "790735";

api.posts.browse().then((posts) =>
  posts.forEach((post) => {
    api.posts.delete({ id: post.id });
  })
);

fetch(
  `https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/posts?fields%5Bpost%5D=title,content,published_at`,
  {
    headers: {
      Authorization: `Bearer ${process.env.PATREON_CREATOR_ACCESS_TOKEN}`,
    },
  }
)
  .then((res) => res.json())
  .then((json) => {
    [json.data[0]].forEach((post) => {
      api.posts
        .add(
          {
            title: post.attributes.title,
            html: post.attributes.content,
            created_at: post.attributes.published_at,
            published_at: post.attributes.published_at,
            updated_at: post.attributes.published_at,
            status: "published",
          },
          { source: "html" }
        )
        .then((res) => console.log(JSON.stringify(res)))
        .catch((err) => console.log(err));
    });
  })
  .catch((error) => console.log(error));

// fetch(
//   `https://www.patreon.com/api/oauth2/v2/posts/${req.params.postId}?fields%5Bpost%5D=title,content,embed_data,embed_url,published_at,is_public,is_paid,app_status,app_id,url`,
//   {
//     headers: {
//       Authorization: `Bearer ${process.env.PATREON_CREATOR_ACCESS_TOKEN}`,
//     },
//   }
// )
//   .then((res) => res.json())
//   .then((json) => res.render("post", json))
//   .catch((error) => res.render("error", { error }));
