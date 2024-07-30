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
const { v4: uuidv4 } = require("uuid");
const {
  init: dbInit,
  getActiveEvents,
  getActiveSignupsForUser,
  getInactiveSignupsForUser,
  getMagicCodeForUser,
  getUser,
  getUserByEmail,
  getItemsForEvent,
  getEvent,
  getItem,
  createSignup,
  getSignup,
  cancelSignup,
} = require("./db");

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

// Serve static files from public/ (ex. /images/foo.jpg)
app.use(express.static("public"));
app.use(express.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

(async () => {
  await dbInit(false);
})();

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

async function sendMagicLink(email, userID, code, item) {
  let link = `${process.env.BASE_URL}/magic?user=${userID}&code=${code}`;
  if (item) {
    link += `&item=${item}`;
  }
  console.log(`Sending magic link: user=${userID}, item=${item}`);
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
    subject: "Your magic link!",
    text: pug.renderFile("views/magic-link-text.pug", { link: link }),
    html: emailBody,
  };
  try {
    sgMail.send(msg);
  } catch (e) {
    console.log("Error sending mail:", e);
  }
}

async function sendConfirmation(email, item, count, comment) {
  let link = `${process.env.BASE_URL}/user`;
  let emailBody = pug.renderFile("views/e4l-mail.pug", {
    title: "Empower4Life Signups",
    preheader: "Thanks for signing up!",
    header: {
      src: "https://images.squarespace-cdn.com/content/v1/5e0f48b1f2de9e7798c9150b/1581484830548-NDTK6YHUVSJILPCCMDPB/FINAL-_2_.png?format=750w",
      alt: "Empower4Life Logo",
    },
    bodyTop: pug.renderFile("views/confirmation.pug", {
      item: item,
      count: count,
      comment: comment,
    }),
    button: {
      url: link,
      text: "Manage Signups",
    },
  });
  emailBody = await inlineCss(emailBody, {
    url: `file://${process.cwd()}/public/`,
    preserveMediaQueries: true,
  });
  const msg = {
    to: email,
    from: "Empower4Life <jennifer@empower4lifemd.org>",
    subject: "Thanks for signing up!",
    text: pug.renderFile("views/confirmation-text.pug", {
      item: item,
      count: count,
      link: link,
      comment: comment,
    }),
    html: emailBody,
  };
  try {
    sgMail.send(msg);
  } catch (e) {
    console.log("Error sending mail:", e);
  }
}

/// Send an email to Ashley letting her know that a signup has been cancelled.
async function sendCancellation(signup) {
  const email = "ashley@empower4lifemd.org";
  const item = await getItem(signup.item_id);
  const event = await getEvent(item.event_id);
  const user = await getUser(signup.user_id);

  const itemsLink = "https://signups.empower4lifemd.org/event/" + event.id;

  let emailBody = pug.renderFile("views/e4l-mail.pug", {
    title: "Empower4Life Signups Cancellation",
    preheader: "Signup cancelled",
    header: {
      src: "https://images.squarespace-cdn.com/content/v1/5e0f48b1f2de9e7798c9150b/1581484830548-NDTK6YHUVSJILPCCMDPB/FINAL-_2_.png?format=750w",
      alt: "Empower4Life Logo",
    },
    bodyTop: pug.renderFile("views/cancellation.pug", {
      user: user.name,
      event: event.title,
      item: item.title,
    }),
    button: {
      url: itemsLink,
      text: "Go to Signups Event",
    },
  });
  emailBody = await inlineCss(emailBody, {
    url: `file://${process.cwd()}/public/`,
    preserveMediaQueries: true,
  });
  const msg = {
    to: email,
    from: "Empower4Life <jennifer@empower4lifemd.org>",
    subject: "Signup Cancellation",
    text: pug.renderFile("views/cancellation-text.pug", {
      user: user.name,
      event: event.title,
      item: item.title,
      link: itemsLink,
    }),
    html: emailBody,
  };
  try {
    sgMail.send(msg);
  } catch (e) {
    console.log("Error sending mail:", e);
  }
}

function setTimes(record) {
  if (record.start_time) {
    const date = new Date(record.start_time);
    record.start = date.toLocaleString("en-US", {
      timeZone: "America/New_York",
    });
  }
  if (record.end_time) {
    const date = new Date(record.end_time);
    record.end = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  }
  return record;
}

app.get("/", async (req, res) => {
  let userID = isLoggedIn(req, res);

  const events = await getActiveEvents();
  res.render("events", {
    loggedIn: userID,
    events,
  });
});

app.get("/user", async (req, res) => {
  let userID = isLoggedIn(req, res);
  if (!userID) {
    return res.redirect("/login");
  }

  // Retrieve the active signups
  let signups = await getActiveSignupsForUser(userID);

  // Retrieve the inactive signups
  let inactive = await getInactiveSignupsForUser(userID);

  res.render("user", {
    signups: await Promise.all(
      signups.map(async (signup) => {
        return {
          id: signup.id,
          title: signup.item_title,
          count: signup.quantity,
          start: signup.start_time,
          end: signup.end_time,
          notes: signup.notes,
        };
      })
    ),
    inactive: await Promise.all(
      inactive.map(async (signup) => {
        return {
          id: signup.id,
          title: signup.item_title,
          count: signup.quantity,
          start: signup.start_time,
          end: signup.end_time,
          notes: signup.notes,
        };
      })
    ),
    success: req.query.success,
    loggedIn: userID,
  });
});

app.get(
  "/magic",
  [
    check("user", "invalid user").isInt(),
    check("code", "invalid code").trim().escape(),
    check("item").optional().isInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      var data = {
        errors: errors.array(),
        item: req.query.item,
      };
      return res.render("login", data);
    }

    let code = await getMagicCodeForUser(req.query.user);
    if (code == req.query.code) {
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

    if (req.query.item) {
      res.redirect(`/signup?item=${req.query.item}`);
    } else {
      res.redirect("/user");
    }
  }
);

app.get("/signout", async (req, res) => {
  res.clearCookie("token");
  res.render("login");
});

app.get("/login", [check("item").optional().isInt()], async (req, res) => {
  res.render("login", { item: req.query.item });
});

app.post(
  "/login",
  [
    check("email", "Missing or invalid email").isEmail(),
    check("item").optional().isInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      var data = {
        errors: errors.array(),
        item: req.body.item,
      };
      return res.render("login", data);
    }

    let user = await getUserByEmail(req.body.email);
    if (!user) {
      return res.render("register", {
        email: req.body.email,
        item: req.body.item,
        errors: [
          { msg: "Email address not found. Please register a new account." },
        ],
      });
    }
    console.log("Sending magic link from login page");
    sendMagicLink(req.body["email"], user.id, user.magic_code, req.body.item);

    res.render("link-sent");
  }
);

app.get("/register", [check("item").optional().isInt()], async (req, res) => {
  res.render("register", { item: req.query.item });
});

app.post(
  "/register",
  [
    check("name").trim(),
    check("email", "Missing or invalid email").isEmail(),
    check("phone", "Invalid phone number")
      .isMobilePhone()
      .optional({ nullable: true, checkFalsy: true }),
    check("item").optional().isInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      var data = {
        errors: errors.array(),
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        item: req.body.item,
      };
      return res.render("register", data);
    }

    // First check if this user already exists
    let user = await getUserByEmail(req.body.email);

    // If an account already exists for this email, just send the magic code email
    if (user) {
      console.log("Sending magic link for existing user", user);
      sendMagicLink(req.body["email"], user.id, user.magic_code, req.body.item);

      return res.render("link-sent");
    }

    // Create a new user
    let magicCode = uuidv4();
    let user_id = await createUser({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      magic_code: magicCode,
    });

    console.log("Sending magic link for new user");
    sendMagicLink(req.body["email"], user_id, magicCode, req.body.item);

    res.render("link-sent");
  }
);

async function renderEvent(userID, event, res) {
  let items = await getItemsForEvent(event.id);
  items = items.map(setTimes);

  return res.render("event", {
    loggedIn: userID,
    event,
    items,
  });
}

app.get("/event/:eventID", async (req, res) => {
  let userID = isLoggedIn(req, res);

  let event = await getEvent(req.params.eventID);
  if (!event) {
    return res.redirect("/");
  }

  return await renderEvent(userID, event, res);
});

app.get(
  "/signup",
  [check("item", "Missing or invalid item ID").trim().escape()],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    let item = await getItem(req.query.item);
    let event = await getEvent(item.event_id);

    return res.render("signup", {
      loggedIn: userID,
      event,
      item,
    });
  }
);

app.post(
  "/signup",
  [
    check("item", "Missing or invalid item ID").trim().escape(),
    check("event", "Missing or invalid event ID").trim().escape(),
    check("quantity", "Missing or invalid quantity").isInt(),
    check("comment").trim(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.render("error", {
        context: "Signup submitted",
        error: "user not logged in",
      });
    }

    let item_id = req.body.item;
    let quantity = parseInt(req.body.quantity);
    let comment = req.body.comment;

    let signup = {
      item_id,
      user_id: userID,
      quantity,
      comment,
    };
    let signup_id = createSignup(signup);

    let user = await getUser(userID);
    let item = await getItem(item_id);
    let event = await getEvent(item.event_id);

    sendConfirmation(
      user.email,
      {
        event: item.title,
        eventDescription: event.description,
        emailInfo: item.email_info,
        eventEmailInfo: event.email_info,
        title: item.title,
        start: item.start_time,
        end: item.end_time,
        notes: item.notes,
      },
      quantity,
      comment
    );

    return res.render("success", {
      loggedIn: userID,
      item: item,
      count: quantity,
      comment: comment,
      event: event,
    });
  }
);

app.delete(
  "/signup",
  [check("signup", "Missing signup ID").trim().escape()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      var data = {
        errors: errors.array(),
      };
      console.log("Signup deletion attempted: Missing signup ID");
      return res.status(400).json(data);
    }

    let userID = isLoggedIn(req, res);
    if (!userID) {
      console.log("Signup deletion attempted: User not logged in");
      return res.status(401).json({ error: "User not logged in" });
    }

    let signup = await getSignup(req.body.signup);
    if (signup && signup.user_id == userID) {
      cancelSignup(signup.id);

      sendCancellation(signup);
      return res.status(200).json({ success: true });
    } else {
      console.log("Error deleting signup: Invalid user ID");
      return res.status(401).json({ error: "Invalid user ID" });
    }
  }
);

const server = app.listen(process.env.PORT, "0.0.0.0", () => {
  console.log(
    `Express running → http://${server.address().address}:${
      server.address().port
    }`
  );
});
