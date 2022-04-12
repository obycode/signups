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

function isLoggedIn(req) {
  const token = req.cookies.token;

  if (!token) {
    return false;
  }

  var jwtPayload;
  try {
    jwtPayload = jwt.verify(token, process.env.JWT_SECRET)
  } catch(e) {
    console.log("isLoggedIn:", e.toString());
    return false;
  }

  return jwtPayload.userID;
}

function isLoggingIn(req) {
  const token = req.cookies.token;

  if (!token) {
    return false;
  }

  var jwtPayload;
  try {
    jwtPayload = jwt.verify(token, process.env.JWT_SECRET)
  } catch(e) {
    console.log("isLoggingIn:", e.toString());
    return false;
  }

  return jwtPayload.login;
}

app.get("/", async (req, res) => {
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
          events: events,
        });
      }
    );
});

app.get("/user", async (req, res) => {
  let userID = isLoggedIn(req);
  if (!userID) {
    return res.redirect("/login");
  }
  res.render("user");
});

app.get("/logout", async (req, res) => {
  res.clearCookie("token");
  res.render("login");
});

app.get("/login", async (req, res) => {
  let userID = isLoggedIn(req);
  let item = req.query.item;
  res.render("login", {
    loggedIn: userID,
    item: item,
  });
});

const server = app.listen(process.env.PORT, "0.0.0.0", () => {
  console.log(`Express running → PORT ${server.address().port}`);
});
