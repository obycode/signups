const dotenv = require("dotenv");
dotenv.config();
var bodyParser = require("body-parser");
const express = require("express");
const app = express();
const { check, validationResult } = require("express-validator");
const pug = require("pug");
var inlineCss = require("inline-css");
const neoncrm = require("@obycode/neoncrm");
var cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

let neon = new neoncrm.Client(
  process.env.NEON_ORG_ID,
  process.env.NEON_API_KEY
);

// using Twilio SendGrid's v3 Node.js Library
// https://github.com/sendgrid/sendgrid-nodejs
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.set("view engine", "pug");

app.use(cookieParser(process.env.COOKIE_SECRET));

const Airtable = require("airtable");

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base(process.env.AIRTABLE_BASE);

// Serve static files from public/ (ex. /images/foo.jpg)
app.use(express.static("public"));

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

function isLoggedIn(req, res) {
  const token = req.cookies.token;

  if (!token) {
    return undefined;
  }

  var jwtPayload;
  try {
    jwtPayload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    console.log("isLoggedIn:", e.toString());
    return undefined;
  }

  return jwtPayload.userID;
}

async function sendMagicLink(email, userID, code) {
  let link = `${process.env.BASE_URL}/magic?user=${userID}&code=${code}`;
  let emailBody = pug.renderFile("views/e4l-mail.pug", {
    title: "Empower4Life Signups",
    preheader: "Your magic link!",
    header: {
      src: "https://images.squarespace-cdn.com/content/v1/5e0f48b1f2de9e7798c9150b/1581484830548-NDTK6YHUVSJILPCCMDPB/FINAL-_2_.png?format=750w",
      alt: "Empower4Life Logo",
    },
    bodyTop: pug.renderFile("views/magic-link-body.pug"),
    button: {
      url: link,
      text: "Sign in",
    },
  });
  emailBody = await inlineCss(emailBody, {
    url: `file://${process.cwd()}/public/`,
    preserveMediaQueries: true,
  });
  const msg = {
    to: email,
    from: "Empower4Life <jennifer@empower4lifemd.org>",
    subject: "Thanks for your support!",
    text: pug.renderFile("views/magic-link-text.pug", { link: link }),
    html: emailBody,
  };
  try {
    sgMail.send(msg);
  } catch (e) {
    console.log("Error sending mail:", e);
  }
}

app.get("/", async (req, res) => {
  let userID = isLoggedIn(req, res);
  var events = [];

  base("Events")
    .select({
      filterByFormula: "{Active}",
      sort: [{ field: "ID", direction: "asc" }],
    })
    .eachPage(
      function page(records, fetchNextPage) {
        for (const record of records) {
          events.push({
            ID: record.get("ID"),
            Active: record.get("Active"),
            Title: record.get("Title"),
            Description: record.get("Description"),
            Image: record.get("Image")[0].url,
          });
        }
        fetchNextPage();
      },
      function done(err) {
        if (err) {
          console.error(err);
          return res.render("error", {
            context: "Failed to retrieve events",
            error: err.toString(),
          });
        }
        res.render("events", {
          loggedIn: userID,
          events: events,
        });
      }
    );
});

app.get("/user", async (req, res) => {
  let userID = isLoggedIn(req, res);
  if (!userID) {
    return res.redirect("/login");
  }
  res.render("user", {
    loggedIn: userID,
  });
});

app.get(
  "/magic",
  [
    check("user", "invalid user").isInt(),
    check("code", "invalid code").trim().escape(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      var data = {
        errors: errors.array(),
      };
      return res.render("login", data);
    }

    let users = await base("Users")
      .select({
        filterByFormula: `{ID} = '${req.query.user}'`,
      })
      .all()
      .catch((err) => {
        console.log(`Error retrieving user: ${err}`);
        return res.render("error", {
          context: "Error retrieving account.",
          error: err.toString(),
        });
      });

    if (!users.length) {
      console.log(`User ${req.query.user} not found`);
      return res.render("error", {
        context: "User not found.",
        error: "Please try again.",
      });
    }
    let user = users[0];
    if (user.get("Magic Code") == req.query.code) {
      const token = jwt.sign(
        { userID: req.query.user },
        process.env.JWT_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "14d",
        }
      );

      res.cookie("token", token, {
        maxAge: 14 * 24 * 60 * 60 * 1000,
        httpOnly: true,
      });
    }
    res.redirect("/user");
  }
);

app.get("/signout", async (req, res) => {
  res.clearCookie("token");
  res.render("login");
});

app.get("/login", async (req, res) => {
  res.render("login");
});

app.post(
  "/login",
  [check("email", "Missing or invalid email").isEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      var data = {
        errors: errors.array(),
      };
      return res.render("login", data);
    }

    let users = await base("Users")
      .select({
        filterByFormula: `{Email} = '${req.body.email}'`,
      })
      .all()
      .catch((err) => {
        console.error(err);
        return res.render("error", {
          context: "Error retrieving account.",
          error: err.toString(),
        });
      });

    if (!users.length) {
      res.render("login", {
        email: req.body.email,
        errors: [{ msg: "Email address not found" }],
      });
    }
    let user = users[0];
    sendMagicLink(req.body["email"], user.get("ID"), user.get("Magic Code"));

    res.render("link-sent");
  }
);

const server = app.listen(process.env.PORT, "0.0.0.0", () => {
  console.log(
    `Express running → http://${server.address().address}:${
      server.address().port
    }`
  );
});
