require("dotenv").config();
const crypto = require("crypto");
const path = require("path");

const fetch = require("node-fetch");
const GhostAdminAPI = require("@tryghost/admin-api");
const fs = require("fs");
const request = require("request");

const download = (url, path, callback) => {
  request.head(url, (err, res, body) => {
    request(url).pipe(fs.createWriteStream(path)).on("close", callback);
  });
};

const api = new GhostAdminAPI({
  key: process.env.GHOST_ADMIN_API,
  url: process.env.GHOST_URL,
  version: "v3",
});

const campaignId = "790735";

function deletePosts() {
  return api.posts
    .browse({ filter: "status:draft", limit: 300 })
    .then((posts) =>
      posts.map((post) => api.posts.delete({ id: post.id }).then(() => ""))
    )
    .then(() => console.log("DELETED"));
}

function fetchPage(cursor) {
  console.log(`Fetching: ${cursor}`);

  return fetch(
    `https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/posts?fields%5Bpost%5D=content,title,published_at,url,embed_url` +
      (cursor ? `&page%5Bcursor%5D=${cursor}` : ""),
    {
      headers: {
        Authorization: `Bearer ${process.env.PATREON_CREATOR_ACCESS_TOKEN}`,
      },
    }
  )
    .then((res) => res.json())
    .then((json) => {
      let nextPage;
      if (
        json &&
        json.meta &&
        json.meta.pagination &&
        json.meta.pagination.cursors &&
        json.meta.pagination.cursors.next
      ) {
        nextPage = fetchPage(json.meta.pagination.cursors.next);
      }

      return Promise.all([
        nextPage,
        ...json.data.map((post) => {
          console.log(post.attributes.title);

          let html = `${
            post.attributes.embed_url
              ? `<p><a href="${post.attributes.embed_url}">Прикрепленное видео</a></p>`
              : ""
          }${post.attributes.content}<p><a href="https://patreon.com${
            post.attributes.url
          }">Этот пост на Патреоне</a></p>`;
          return processImagesInHTML(html).then((html) =>
            api.posts
              .add(
                {
                  title: post.attributes.title,
                  html,
                  created_at: post.attributes.published_at,
                  published_at: post.attributes.published_at,
                  updated_at: post.attributes.published_at,
                  status: "draft",
                },
                { source: "html" }
              )
              .then((res) => "")
              .catch((err) => console.log(err))
          );
        }),
      ]);
    })
    .catch((error) => console.log(error));
}

function processImagesInHTML(html) {
  // Find images that Ghost Upload supports
  let imageRegex = /src="(https:\/\/[^"]*?(?:\.jpg|\.jpeg|\.gif|\.png|\.svg|\.sgvz)*?)"/gim;
  let imagePromises = [];
  let result;

  while ((result = imageRegex.exec(html)) !== null) {
    let url = result[1];

    console.log(url);

    // Upload the image, using the original matched filename as a reference
    imagePromises.push(
      new Promise((resolve, reject) => {
        const filename =
          "./patreon-" + crypto.randomBytes(4).readUInt32LE(0) + ".jpg";

        download(url, filename, () => {
          api.images
            .upload({
              ref: url,
              file: path.resolve(filename),
            })
            .then(resolve);
        });
      })
    );
  }

  return Promise.all(imagePromises).then((images) => {
    images.forEach((image) => (html = html.replace(image.ref, image.url)));
    return html;
  });
}

deletePosts().then(() => fetchPage().then(() => console.log("END")));
