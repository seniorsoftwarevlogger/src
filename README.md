# Patreon, Youtube Memberships. Why not both? ![CI](https://github.com/nLight/src/workflows/CI/badge.svg)

Ghost CMS API Powered community website. Your sponsors can login with their Patreon Account as well as Youtube account.

Environment variables

```
GHOST_CONTENT_API=
GHOST_URL=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URL=
JWT_SECRET=

NODE_ENV="production"

PATREON_CLIENT_ID=
PATREON_CLIENT_SECRET=
PATREON_CREATOR_ACCESS_TOKEN=
PATREON_REDIRECT_URL=
SENTRY_DSN=
YOUTUBE_MEMBERS=
```

## Scrap youtube members from the dashboard

```js
console.log("YOUTUBE_MEMBERS='" + JSON.stringify(
    Object.fromEntries(
    $x("//*[contains(@class, 'row style-scope ytsp-sponsors-dialog')]").map((tr) => {
        const link = $("a", tr).getAttribute("href").split("/")[4];
        const level = $(".sponsor-current_tier", tr).innerText;
console.log(level);
        return [link, level];
    })
    )
) + "'");
```
