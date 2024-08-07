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
const path = require("path");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const {
  init: dbInit,
  getActiveEvents,
  getActiveSignupsForUser,
  getInactiveSignupsForUser,
  getMagicCodeForUser,
  createUser,
  getUser,
  getUserByEmail,
  getItemsForEvent,
  createEvent,
  getEvent,
  updateEvent,
  deleteEvent,
  getSignupsForEvent,
  getItem,
  createSignup,
  getSignup,
  cancelSignup,
  isAdmin,
  createItem,
  updateItem,
  deleteItem,
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

function formatDateTimeForForm(date) {
  const pad = (number) => number.toString().padStart(2, "0");

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function setTimes(record) {
  if (record.start_time) {
    const date = new Date(record.start_time);
    record.start = date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    record.start_form = formatDateTimeForForm(date);
  }
  if (record.end_time) {
    const date = new Date(record.end_time);
    record.end = date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    record.end_form = formatDateTimeForForm(date);
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
    check("item").optional({ checkFalsy: true }).isInt(),
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

app.get(
  "/login",
  [check("item").optional({ checkFalsy: true }).isInt()],
  async (req, res) => {
    res.render("login", { item: req.query.item });
  }
);

app.post(
  "/login",
  [
    check("email", "Missing or invalid email").isEmail(),
    check("item").optional({ checkFalsy: true }).isInt(),
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
    sendMagicLink(req.body["email"], user.id, user.magic_code, req.body.item);

    res.render("link-sent");
  }
);

app.get(
  "/register",
  [check("item").optional({ checkFalsy: true }).isInt()],
  async (req, res) => {
    res.render("register", { item: req.query.item });
  }
);

app.post(
  "/register",
  [
    check("name").trim(),
    check("email", "Missing or invalid email").isEmail(),
    check("phone", "Invalid phone number")
      .isMobilePhone()
      .optional({ nullable: true, checkFalsy: true }),
    check("item").optional({ checkFalsy: true }).isInt(),
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

    sendMagicLink(req.body["email"], user_id, magicCode, req.body.item);

    res.render("link-sent");
  }
);

async function renderEvent(userID, admin, event, res) {
  let items = await getItemsForEvent(event.id);
  items = items.map(setTimes);

  return res.render("event", {
    loggedIn: userID,
    isAdmin: admin,
    event,
    items,
  });
}

app.get("/event/:eventID", async (req, res) => {
  let userID = isLoggedIn(req, res);
  let admin = await isAdmin(userID);

  let event = await getEvent(req.params.eventID);
  if (!event) {
    return res.redirect("/");
  }

  return await renderEvent(userID, admin, event, res);
});

app.get(
  "/signup",
  [check("item", "Missing or invalid item ID").trim().escape()],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    let item = await getItem(req.query.item);
    item = setTimes(item);
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

app.get("/admin/event/new", async (req, res) => {
  let userID = isLoggedIn(req, res);
  if (!userID) {
    return res.redirect("/login");
  }

  let admin = await isAdmin(userID);
  if (!admin) {
    return res.redirect("/");
  }

  return res.render("new-event", {
    loggedIn: userID,
  });
});

app.post(
  "/admin/event",
  upload.single("image"),
  [
    check("title", "Title is required").trim().notEmpty(),
    check("description", "Description is required").trim().notEmpty(),
    check("summary", "Summary is required").trim(),
    check("email_info").trim(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("new-event", {
        loggedIn: userID,
        errors: errors.array(),
      });
    }

    const event = {
      title: req.body.title,
      description: req.body.description,
      summary: req.body.summary,
      email_info: req.body.email_info,
      active: false,
    };

    if (req.file) {
      const fileContent = req.file.buffer;
      const fileExtension = path.extname(req.file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;

      const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileName,
        Body: fileContent,
        ContentType: req.file.mimetype,
      };

      try {
        const upload = new Upload({
          client: s3,
          params: params,
        });

        const data = await upload.done();
        event.image = `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`;
      } catch (error) {
        console.error("Error uploading image to S3:", error);
        return res.status(500).render("new-event", {
          loggedIn: userID,
          errors: [{ msg: "Error uploading image" }],
        });
      }
    }

    const newEvent = await createEvent(event);
    if (!newEvent) {
      return res.render("new-event", {
        loggedIn: userID,
        errors: [{ msg: "Failed to create event" }],
      });
    }

    console.log("Created new event:", newEvent);

    return res.redirect(`/admin/event/${newEvent}`);
  }
);

app.get(
  "/admin/event/edit",
  [check("event", "Missing event ID").isInt()],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/admin/event/" + req.query.event);
    }

    let event = await getEvent(req.query.event);
    if (!event) {
      return res.redirect("/admin");
    }

    return res.render("edit-event", {
      loggedIn: userID,
      event,
    });
  }
);

app.post(
  "/admin/event-edit",
  upload.single("image"),
  [
    check("title", "Title is required").trim().notEmpty(),
    check("description", "Description is required").trim().notEmpty(),
    check("summary").trim(),
    check("email_info").trim(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const event = {
        title: req.body.title,
        description: req.body.description,
        summary: req.body.summary,
        email_info: req.body.email_info,
        active: req.body.active,
      };
      return res.render("edit-event", {
        loggedIn: userID,
        errors: errors.array(),
        event,
      });
    }

    const event = {
      title: req.body.title,
      description: req.body.description,
      summary: req.body.summary,
      email_info: req.body.email_info,
      active: req.body.active == "on",
    };

    if (req.file) {
      const fileContent = req.file.buffer;
      const fileExtension = path.extname(req.file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;

      const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileName,
        Body: fileContent,
        ContentType: req.file.mimetype,
      };

      try {
        const upload = new Upload({
          client: s3,
          params: params,
        });

        const data = await upload.done();
        event.image = `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`;
      } catch (error) {
        console.error("Error uploading image to S3:", error);
        return res.status(500).render("new-event", {
          loggedIn: userID,
          errors: [{ msg: "Error uploading image" }],
        });
      }
    }

    await updateEvent(req.body.id, event);

    console.log(`Edited event ${req.body.id}`);

    return res.redirect(`/admin/event/${req.body.id}`);
  }
);

app.get(
  "/admin/item/new",
  [check("event", "Missing event ID").isInt()],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    return res.render("new-item", {
      loggedIn: userID,
      event: req.query.event,
    });
  }
);

app.post(
  "/admin/item",
  [
    check("title", "Title is required").trim().notEmpty(),
    check("event", "Event ID is required").isInt(),
    check("needed", "Needed is required").isInt(),
    check("notes").trim(),
    check("email_info").trim(),
    check("start", "Start time must be valid date")
      .optional({
        nullable: true,
        checkFalsy: true,
      })
      .isISO8601(),
    check("end", "End time must be valid date")
      .optional({
        nullable: true,
        checkFalsy: true,
      })
      .isISO8601(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("new-item", {
        loggedIn: userID,
        errors: errors.array(),
        event: req.body.event,
        item_title: req.body.title,
        notes: req.body.notes,
        email_info: req.body.email_info,
        start: req.body.start,
        end: req.body.end,
        needed: req.body.needed,
      });
    }

    const item = {
      event_id: req.body.event,
      title: req.body.title,
      notes: req.body.notes,
      email_info: req.body.email_info,
      start_time: req.body.start,
      end_time: req.body.end,
      needed: req.body.needed,
    };

    const newItem = await createItem(item);
    if (!newItem) {
      return res.render("new-item", {
        loggedIn: userID,
        errors: [{ msg: "Failed to create item" }],
      });
    }

    console.log(`Created new item ${newItem} for event ${item.event_id}`);

    return res.redirect(`/admin/event/${req.body.event}`);
  }
);

app.get(
  "/admin/item/edit",
  [
    check("item", "Missing item ID").isInt(),
    check("event", "Missing event ID").isInt(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/admin/event/" + req.query.event);
    }

    let item = await getItem(req.query.item);
    if (!item) {
      return res.redirect("/admin/item/new?event=" + req.query.event);
    }

    item = setTimes(item);

    return res.render("edit-item", {
      loggedIn: userID,
      item,
    });
  }
);

app.post(
  "/admin/item-edit",
  [
    check("id", "ID is required").isInt(),
    check("event", "Event ID is required").isInt(),
    check("title", "Title is required").trim().notEmpty(),
    check("needed", "Needed is required").isInt(),
    check("notes").trim(),
    check("email_info").trim(),
    check("start", "Start time must be valid date")
      .optional({
        nullable: true,
        checkFalsy: true,
      })
      .isISO8601(),
    check("end", "End time must be valid date")
      .optional({
        nullable: true,
        checkFalsy: true,
      })
      .isISO8601(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const item = {
        id: req.body.id,
        event_id: req.body.event,
        title: req.body.title,
        notes: req.body.notes,
        email_info: req.body.email_info,
        start_form: req.body.start,
        end_form: req.body.end,
        needed: req.body.needed,
      };
      return res.render("edit-item", {
        loggedIn: userID,
        errors: errors.array(),
        item,
      });
    }

    const item = {
      event_id: req.body.event,
      title: req.body.title,
      notes: req.body.notes,
      email_info: req.body.email_info,
      start_time: req.body.start,
      end_time: req.body.end,
      needed: req.body.needed,
    };

    await updateItem(req.body.id, item);

    console.log(`Edited item ${req.body.id} for event ${item.event_id}`);

    return res.redirect(`/admin/event/${req.body.event}`);
  }
);

app.get(
  "/admin/item/delete",
  [
    check("item", "Missing item ID").isInt(),
    check("event", "Missing event ID").isInt(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/admin/event/" + req.query.event);
    }

    await deleteItem(req.query.item);

    console.log(`Deleted item ${req.query.item}`);

    return res.redirect(`/admin/event/${req.query.event}`);
  }
);

app.get("/admin/event/:id", async (req, res) => {
  let userID = isLoggedIn(req, res);
  if (!userID) {
    return res.redirect("/login");
  }

  let admin = await isAdmin(userID);
  if (!admin) {
    return res.redirect("/");
  }

  let event = await getEvent(req.params.id);
  if (!event) {
    return res.redirect("/");
  }

  let signups = await getSignupsForEvent(event.id);
  signups = signups.map(setTimes);

  let items = await getItemsForEvent(event.id);
  items = items.map(setTimes);

  // Collect a summary of the number of signups for each item
  let summary = {};
  if (items.length < 20) {
    items.forEach((item) => {
      summary[item.id] = {
        signups: 0,
        needed: item.needed,
        title: item.title,
        start: item.start,
        end: item.end,
      };
    });
    signups.forEach((signup) => {
      summary[signup.item_id].signups += signup.quantity;
    });
  }

  return res.render("admin-event", {
    loggedIn: userID,
    event,
    signups,
    summary,
  });
});

app.get(
  "/admin/signup/delete",
  [
    check("signup", "Missing signup ID").isInt(),
    check("event", "Missing event ID").isInt(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.redirect("/");
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/admin/event/" + req.query.event);
    }

    await cancelSignup(req.query.signup);

    console.log(`Canceled signup ${req.query.signup}`);

    return res.redirect(`/admin/event/${req.query.event}`);
  }
);

const server = app.listen(process.env.PORT, "0.0.0.0", () => {
  console.log(
    `Express running → http://${server.address().address}:${
      server.address().port
    }`
  );
});
