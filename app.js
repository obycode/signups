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
app.use(express.json());
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

async function sendMagicLink(email, userID, code, item) {
  let link = `${process.env.BASE_URL}/magic?user=${userID}&code=${code}&item=${item}`;
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
            ID: record.id,
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

  // Retrieve the user to get the signups
  let signups = await base("Signups")
    .select({
      filterByFormula: `AND({Active}, {User ID} = '${userID}', {Number} > 0)`,
      view: "API",
    })
    .all()
    .catch((err) => {
      console.error(err);
      return res.render("error", {
        context: "Error retrieving signups.",
        error: err.toString(),
      });
    });

  res.render("user", {
    signups: signups.map((signup) => {
      return {
        id: signup.id,
        title: signup.get("Item Title"),
        count: signup.get("Number"),
        item: signup.get("Item")[0],
        start: signup.get("Start"),
        end: signup.get("End"),
        notes: signup.get("Notes"),
      };
    }),
    success: req.query.success,
    loggedIn: userID,
  });
});

app.get(
  "/magic",
  [
    check("user", "invalid user").trim().escape(),
    check("code", "invalid code").trim().escape(),
    check("item").trim().escape(),
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

    let user = await base("Users")
      .find(req.query.user)
      .catch((err) => {
        console.log(`Error retrieving user: ${err}`);
        return res.render("error", {
          context: "Error retrieving account.",
          error: err.toString(),
        });
      });

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

    if (req.body.item) {
      res.redirect(`/signup?item=${req.body.item}`);
    } else {
      res.redirect("/user");
    }
  }
);

app.get("/signout", async (req, res) => {
  res.clearCookie("token");
  res.render("login");
});

app.get("/login", [check("item").trim().escape()], async (req, res) => {
  res.render("login", { item: req.query.item });
});

app.post(
  "/login",
  [
    check("email", "Missing or invalid email").isEmail(),
    check("item").trim().escape(),
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
      return res.render("register", {
        email: req.body.email,
        item: req.body.item,
        errors: [
          { msg: "Email address not found. Please register a new account." },
        ],
      });
    }
    let user = users[0];
    sendMagicLink(
      req.body["email"],
      user.id,
      user.get("Magic Code"),
      req.body.item
    );

    res.render("link-sent");
  }
);

app.get("/register", [check("item").trim().escape()], async (req, res) => {
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
    check("item").trim().escape(),
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

    // If an account already exists for this email, just send the magic code email
    if (users.length > 0) {
      let user = users[0];
      sendMagicLink(
        req.body["email"],
        user.id,
        user.get("Magic Code"),
        req.body.item
      );

      return res.render("link-sent");
    }

    // Create a new user
    let magicCode = uuidv4();
    users = await base("Users")
      .create([
        {
          fields: {
            Name: req.body.name,
            Email: req.body.email,
            Phone: req.body.phone,
            "Magic Code": magicCode,
          },
        },
      ])
      .catch((err) => {
        console.error(err);
        return res.render("error", {
          context: "Error creating account.",
          error: err.toString(),
        });
      });

    if (!users.length) {
      res.render("register", {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        item: req.body.item,
        errors: [{ msg: "Something went wrong, please try again." }],
      });
    }
    let user = users[0];
    sendMagicLink(
      req.body["email"],
      user.id,
      user.get("Magic Code"),
      req.body.item
    );

    res.render("link-sent");
  }
);

async function renderEvent(userID, record, res) {
  let rawItems = await base("Items")
    .select({
      filterByFormula: `{Event} = '${record.get("ID")}'`,
    })
    .all()
    .catch((err) => {
      console.error(err);
      return res.render("error", {
        context: "Error retrieving items.",
        error: err.toString(),
      });
    });

  let items = rawItems.map((item) => {
    return {
      ID: item.id,
      Title: item.get("Title"),
      Notes: item.get("Notes"),
      Start: item.get("Start"),
      End: item.get("End"),
      Needed: item.get("Needed"),
      Have: item.get("Have"),
    };
  });
  return res.render("event", {
    loggedIn: userID,
    event: {
      ID: record.id,
      Active: record.get("Active"),
      Title: record.get("Title"),
      Description: record.get("Description"),
      Image: record.get("Image")[0].url,
    },
    items: items,
  });
}

app.get("/event/:eventID", async (req, res) => {
  let userID = isLoggedIn(req, res);
  // This case handles when the eventID is the record ID
  if (isNaN(req.params.eventID)) {
    base("Events").find(req.params.eventID, async function (err, record) {
      if (err) {
        console.error(err);
        return res.render("event", {
          loggedIn: userID,
          error: `Event not found`,
        });
      }
      return await renderEvent(userID, record, res);
    });
  } else {
    // This case handles when the eventID is the ID number from the table
    let events = await base("Events")
      .select({
        filterByFormula: `{ID} = '${req.params.eventID}'`,
      })
      .all()
      .catch((err) => {
        console.error(err);
        return res.render("error", {
          context: "Error retrieving event.",
          error: err.toString(),
        });
      });

    if (!events.length) {
      return res.redirect("/");
    }
    let record = events[0];
    return await renderEvent(userID, record, res);
  }
});

app.get(
  "/signup",
  [check("item", "Missing or invalid item ID").trim().escape()],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    let item = await base("Items")
      .find(req.query.item)
      .catch((err) => {
        console.log(`Error retrieving item: ${err}`);
        return res.render("error", {
          context: "Error retrieving item.",
          error: err.toString(),
        });
      });

    return res.render("signup", {
      loggedIn: userID,
      itemID: req.query.item,
      eventID: item.get("Event")[0],
      item: item.fields,
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

    let count = parseInt(req.body.quantity);
    let comment = req.body.comment;

    await base("Signups")
      .create([
        {
          fields: {
            Item: [req.body.item],
            User: [userID],
            Number: count,
            Comments: comment,
          },
        },
      ])
      .catch((err) => {
        console.error(err);
        return res.render("error", {
          loggedIn: userID,
          context: "Failed to store signup",
          error: err.toString(),
        });
      });

    let user = await base("Users")
      .find(userID)
      .catch((err) => {
        console.log(`Error retrieving user: ${err}`);
        return res.render("error", {
          context: "Error retrieving user.",
          error: err.toString(),
        });
      });

    let item = await base("Items")
      .find(req.body.item)
      .catch((err) => {
        console.log(`Error retrieving item: ${err}`);
        return res.render("error", {
          context: "Error retrieving item.",
          error: err.toString(),
        });
      });

    sendConfirmation(user.get("Email"), item.fields, count, comment);

    return res.render("success", {
      loggedIn: userID,
      item: item.fields,
      count: count,
      comment: comment,
      event: req.body.event,
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

    let signup = await base("Signups")
      .find(req.body.signup)
      .catch((err) => {
        console.log(`Error retrieving signup: ${err}`);
        return res.status(400).json({ error: "Invalid signup ID" });
      });

    if (signup && signup.get("User ID") == userID) {
      await base("Signups")
        .update([{ id: req.body.signup, fields: { Number: 0 } }])
        .catch((err) => {
          console.log(`Error deleting signup: ${err}`);
          return res.status(500).json({ error: "Error deleting signup" });
        });
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
