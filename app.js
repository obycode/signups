const dotenv = require("dotenv");
dotenv.config();
var bodyParser = require("body-parser");
const express = require("express");
const app = express();
app.set("trust proxy", 1);
const { check, validationResult } = require("express-validator");
const validator = require("validator");
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
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const awsClientConfig = {
  region: process.env.AWS_REGION,
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3 = new S3Client(awsClientConfig);
const ses = new SESClient(awsClientConfig);
const sns = new SNSClient(awsClientConfig);

const {
  init: dbInit,
  getEvents,
  getActiveEvents,
  getActiveSignupsForUser,
  getInactiveSignupsForUser,
  getMagicCodeForUser,
  createUser,
  getUser,
  getUserByEmail,
  getUserByPhone,
  getItemsForEvent,
  getActiveItemsForEvent,
  countItemsForEvent,
  countActiveItemsForEvent,
  countNeededForEvent,
  createEvent,
  getEvent,
  updateEvent,
  deleteEvent,
  activateEvent,
  getSignupsForEvent,
  getItem,
  createSignup,
  getSignup,
  cancelSignup,
  isAdmin,
  createItem,
  updateItem,
  deleteItem,
  hasActiveSignupsForItem,
  setItemActive,
  createKid,
  getKid,
  getKidsForEvent,
  getPendingKidsForEvent,
  updateKid,
  deleteKid,
  approveKid,
  getShelters,
  createShelter,
  setEventShelters,
  getSheltersForEvent,
  checkUserOTP,
  healthCheck: dbHealthCheck,
} = require("./db");

let neon = new neoncrm.Client(
  process.env.NEON_ORG_ID,
  process.env.NEON_API_KEY,
);

const defaultFromAddress =
  process.env.MAIL_FROM || "Empower4Life <jennifer@empower4lifemd.org>";
const supportEmail = process.env.SUPPORT_EMAIL || "brice@empower4lifemd.org";
const isProduction = process.env.NODE_ENV === "production";

function authCookieBaseOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
  };
}

function authCookieOptions() {
  return {
    ...authCookieBaseOptions(),
    maxAge: 14 * 24 * 60 * 60 * 1000,
  };
}

function renderError(res, options = {}) {
  const { status = 400, heading, message, context, error } = options;

  return res.status(status).render("error", {
    heading,
    message,
    context,
    error,
    supportEmail,
  });
}

async function sendEmailWithSES({
  to,
  from = defaultFromAddress,
  subject,
  text,
  html,
}) {
  const body = {
    Text: { Data: text || "", Charset: "UTF-8" },
  };

  if (html) {
    body.Html = { Data: html, Charset: "UTF-8" };
  }

  const command = new SendEmailCommand({
    Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
    Source: from,
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: body,
    },
  });

  return ses.send(command);
}

app.set("view engine", "pug");

app.use(cookieParser(process.env.COOKIE_SECRET));

// Serve static files from public/ (ex. /images/foo.jpg)
app.use(express.static("public"));
app.use(express.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  }),
);

let shelters = [];

async function refreshShelters() {
  shelters = await getShelters();
}

function getBCPSShelterId() {
  const bcpsShelter = shelters.find((shelter) => shelter.name === "BCPS");
  return bcpsShelter ? String(bcpsShelter.id) : null;
}

app.get("/healthz", async (req, res) => {
  try {
    await dbHealthCheck();
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed:", error);
    return res.status(503).json({ status: "error" });
  }
});

function parseShelterIds(rawShelters) {
  if (!rawShelters) {
    return [];
  }

  const ids = Array.isArray(rawShelters) ? rawShelters : [rawShelters];
  return ids
    .map((value) => parseInt(value, 10))
    .filter((value) => !Number.isNaN(value));
}

function parseNewShelterNames(rawNames) {
  if (!rawNames) {
    return [];
  }

  return rawNames
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

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

async function sendMagicLink(email, userID, code, login_code, item) {
  let link = `${process.env.BASE_URL}/magic?user=${userID}&code=${code}`;
  if (item) {
    link += `&item=${item}`;
  }
  console.log(`Sending login email: user=${userID}, item=${item}`);
  let emailBody = pug.renderFile("views/e4l-mail.pug", {
    title: "Empower4Life Signups",
    preheader: "Your login info!",
    header: {
      src: "https://images.squarespace-cdn.com/content/v1/5e0f48b1f2de9e7798c9150b/1581484830548-NDTK6YHUVSJILPCCMDPB/FINAL-_2_.png?format=750w",
      alt: "Empower4Life Logo",
    },
    bodyTop: pug.renderFile("views/magic-link-body.pug", {
      login_code,
    }),
    button: {
      url: link,
      text: "Sign in",
    },
    bodyBottom: pug.renderFile("views/magic-link-footer.pug"),
  });
  emailBody = await inlineCss(emailBody, {
    url: `file://${process.cwd()}/public/`,
    preserveMediaQueries: true,
  });
  const msg = {
    to: email,
    from: "Empower4Life <jennifer@empower4lifemd.org>",
    subject: "Your login info!",
    text: pug.renderFile("views/magic-link-text.pug", { link, login_code }),
    html: emailBody,
  };
  try {
    await sendEmailWithSES(msg);
  } catch (e) {
    console.log("Error sending mail:", e);
  }
}

async function sendLoginCode(phone, OTP) {
  // Normalize: remove non-digit characters
  const normalized = phone.replace(/\D/g, "");
  const message = `E4L Signups: Your OTP is ${OTP}.\nReply STOP to opt-out.`;

  try {
    await sns.send(
      new PublishCommand({
        PhoneNumber: `+1${normalized}`,
        Message: message,
        MessageAttributes: {
          "AWS.SNS.SMS.SMSType": {
            DataType: "String",
            StringValue: "Transactional",
          },
          "AWS.MM.SMS.OriginationNumber": {
            DataType: "String",
            StringValue: "+12562910284",
          },
        },
      }),
    );

    console.log("SMS sent");
  } catch (e) {
    console.error("Error sending SMS:", e.name || e.code, e.message);
  }
}

async function sendSmsOptInConfirmation(phone) {
  const normalized = phone.replace(/\D/g, "");
  const message =
    "E4L Signups: You have opted in to receive one-time login codes. " +
    "One message per login request. Msg & data rates may apply. Reply HELP for help or STOP to cancel.";

  try {
    await sns.send(
      new PublishCommand({
        PhoneNumber: `+1${normalized}`,
        Message: message,
        MessageAttributes: {
          "AWS.SNS.SMS.SMSType": {
            DataType: "String",
            StringValue: "Transactional",
          },
          "AWS.MM.SMS.OriginationNumber": {
            DataType: "String",
            StringValue: "+12562910284",
          },
        },
      }),
    );
    console.log("Opt-in confirmation SMS sent");
  } catch (e) {
    console.error("Error sending opt-in SMS:", e.name || e.code, e.message);
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
    await sendEmailWithSES(msg);
  } catch (e) {
    console.log("Error sending mail:", e);
  }
}

async function sendSignupAlert(user, event, item, count, comment) {
  const alertEmail = event.alert_on_signup ? event.alert_email : null;
  if (!alertEmail) {
    return;
  }

  const adminLink = `${process.env.BASE_URL}/admin/event/${event.id}`;
  let emailBody = pug.renderFile("views/e4l-mail.pug", {
    title: "Empower4Life Signup Alert",
    preheader: "New signup submitted",
    header: {
      src: "https://images.squarespace-cdn.com/content/v1/5e0f48b1f2de9e7798c9150b/1581484830548-NDTK6YHUVSJILPCCMDPB/FINAL-_2_.png?format=750w",
      alt: "Empower4Life Logo",
    },
    bodyTop: pug.renderFile("views/signup-alert.pug", {
      user: user.name,
      userEmail: user.email,
      event: event.title,
      item: item.title,
      count: count,
      comment: comment || "-",
    }),
    button: {
      url: adminLink,
      text: "Open Event Admin",
    },
  });
  emailBody = await inlineCss(emailBody, {
    url: `file://${process.cwd()}/public/`,
    preserveMediaQueries: true,
  });

  try {
    await sendEmailWithSES({
      to: alertEmail,
      from: "Empower4Life <jennifer@empower4lifemd.org>",
      subject: `New Signup: ${event.title}`,
      text: pug.renderFile("views/signup-alert-text.pug", {
        user: user.name,
        userEmail: user.email,
        event: event.title,
        item: item.title,
        count: count,
        comment: comment || "-",
        link: adminLink,
      }),
      html: emailBody,
    });
  } catch (e) {
    console.log("Error sending signup alert:", e);
  }
}

/// Send an email alert when a signup has been cancelled.
async function sendCancellation(signup) {
  const item = await getItem(signup.item_id);
  if (!item) {
    console.log(`Cancellation email skipped: missing item ${signup.item_id}`);
    return;
  }
  const event = await getEvent(item.event_id);
  if (!event) {
    console.log(
      `Cancellation email skipped: missing event ${item.event_id} for item ${signup.item_id}`,
    );
    return;
  }
  const email = event.alert_on_cancellation ? event.alert_email : null;
  if (!email) {
    return;
  }
  const user = await getUser(signup.user_id);
  if (!user) {
    console.log(
      `Cancellation email skipped: missing user ${signup.user_id} for signup ${signup.id}`,
    );
    return;
  }

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
    await sendEmailWithSES(msg);
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
  let admin = await isAdmin(userID);

  const events = await getActiveEvents();
  res.render("events", {
    loggedIn: userID,
    isAdmin: admin,
    events,
  });
});

app.get("/privacy", async (req, res) => {
  let userID = isLoggedIn(req, res);
  let admin = await isAdmin(userID);

  res.render("privacy", {
    loggedIn: userID,
    isAdmin: admin,
  });
});

app.get("/terms", async (req, res) => {
  let userID = isLoggedIn(req, res);
  let admin = await isAdmin(userID);

  res.render("terms", {
    loggedIn: userID,
    isAdmin: admin,
  });
});

app.get("/user", async (req, res) => {
  let userID = isLoggedIn(req, res);
  if (!userID) {
    return res.redirect("/login");
  }
  let admin = await isAdmin(userID);

  // Retrieve the active signups
  let signups = await getActiveSignupsForUser(userID);
  signups = signups.map(setTimes);

  // Retrieve the inactive signups
  let inactive = await getInactiveSignupsForUser(userID);
  inactive = inactive.map(setTimes);

  res.render("user", {
    loggedIn: userID,
    isAdmin: admin,
    signups,
    inactive,
    success: req.query.success,
    loggedIn: userID,
  });
});

app.get(
  "/magic",
  [
    check("user", "invalid user").isInt(),
    check("code", "invalid code").trim(),
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
        },
      );

      res.cookie("token", token, authCookieOptions());
    }

    if (req.query.item && req.query.item !== "undefined") {
      res.redirect(`/signup?item=${req.query.item}`);
    } else {
      res.redirect("/user");
    }
  },
);

app.get("/signout", async (req, res) => {
  res.clearCookie("token", authCookieBaseOptions());
  res.render("login");
});

app.get(
  "/login",
  [check("item").optional({ checkFalsy: true }).isInt()],
  async (req, res) => {
    res.render("login", { item: req.query.item });
  },
);

app.post(
  "/login",
  [
    check("identifier")
      .notEmpty()
      .withMessage("Email or phone number is required.")
      .custom((value) => {
        const emailRegex = /^\S+@\S+\.\S+$/;
        const phoneRegex = /^\d{10}$/;
        if (!emailRegex.test(value) && !phoneRegex.test(value)) {
          throw new Error(
            "Must be a valid email or phone number (e.g. 4105551212).",
          );
        }
        return true;
      }),
    check("item").optional({ checkFalsy: true }).isInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      var data = {
        errors: errors.array(),
        identifier: req.body.identifier,
        item: req.body.item,
      };
      return res.render("login", data);
    }

    // Determine if it's an email or phone
    const emailRegex = /^\S+@\S+\.\S+$/;
    const phoneRegex = /^\d{10}$/;

    let loginType = "email";
    if (emailRegex.test(req.body.identifier)) {
      loginType = "email";
    } else if (phoneRegex.test(req.body.identifier)) {
      loginType = "phone";
    }

    // Query the database based on the type
    let user;
    if (loginType === "email") {
      user = await getUserByEmail(req.body.identifier);
      if (!user) {
        return res.render("register", {
          email: req.body.email,
          item: req.body.item,
          errors: [
            { msg: "Email address not found. Please register a new account." },
          ],
        });
      }
      sendMagicLink(
        user.email,
        user.id,
        user.magic_code,
        user.login_code,
        req.body.item,
      );
    } else if (loginType === "phone") {
      user = await getUserByPhone(req.body.identifier);
      if (!user) {
        return res.render("register", {
          phone: req.body.phone,
          item: req.body.item,
          errors: [
            { msg: "Phone number not found. Please register a new account." },
          ],
        });
      }
      sendLoginCode(user.phone, user.login_code);
    }

    res.render("link-sent", { user_id: user.id, item: req.body.item });
  },
);

app.post(
  "/verify-otp",
  [
    check("otp")
      .notEmpty()
      .withMessage("OTP is required.")
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP must be exactly 6 digits.")
      .isNumeric()
      .withMessage("OTP must contain only numbers."),
    check("user_id").notEmpty().withMessage("User ID is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("link-sent", {
        errors: errors.array(),
        user_id: req.body.user_id,
        item: req.body.item,
      });
    }

    const user = await checkUserOTP(req.body.user_id, req.body.otp);

    if (!user) {
      return res.render("login", {
        errors: [{ msg: "Invalid or expired OTP." }],
        item: req.body.item,
      });
    }

    const token = jwt.sign(
      { userID: req.body.user_id },
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: "14d",
      },
    );

    res.cookie("token", token, authCookieOptions());

    if (req.body.item && req.body.item !== "undefined") {
      res.redirect(`/signup?item=${req.body.item}`);
    } else {
      res.redirect("/user");
    }
  },
);

app.get(
  "/register",
  [check("item").optional({ checkFalsy: true }).isInt()],
  async (req, res) => {
    res.render("register", { item: req.query.item });
  },
);

app.post(
  "/register",
  [
    check("name").trim(),
    check("email", "Missing or invalid email").isEmail(),
    check("phone", "Invalid phone number")
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (!/^\d{10}$/.test(value)) {
          throw new Error("Phone number must be in the format 1112223333");
        }
        return true;
      }),
    check("item")
      .optional({ checkFalsy: true })
      .custom((value) => {
        if (value === "undefined") return true; // Skip validation if the value is the string "undefined"
        if (!Number.isInteger(Number(value))) {
          throw new Error("Invalid value");
        }
        return true;
      }),
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
      sendMagicLink(
        req.body["email"],
        user.id,
        user.magic_code,
        user.login_code,
        req.body.item,
      );

      return res.render("link-sent", { user_id: user.id, item: req.body.item });
    }

    // Create a new user
    let magicCode = uuidv4();
    let new_user = await createUser({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      magic_code: magicCode,
    });

    if (req.body.phone) {
      sendSmsOptInConfirmation(req.body.phone);
    }

    sendMagicLink(
      req.body["email"],
      new_user.id,
      magicCode,
      new_user.login_code,
      req.body.item,
    );

    res.render("link-sent", {
      user_id: new_user.id,
      item: req.body.item,
      login_code: new_user.login_code,
    });
  },
);

async function renderEvent(userID, admin, event, page, limit, res) {
  const skip = (page - 1) * limit;
  let items = await getActiveItemsForEvent(event.id, skip, limit);
  items = items.map(setTimes);
  const totalItems = await countActiveItemsForEvent(event.id);
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return res.render("event", {
    loggedIn: userID,
    isAdmin: admin,
    event,
    items,
    currentPage: page,
    totalPages,
  });
}

app.get("/event/:eventID(\\d+)", async (req, res) => {
  let userID = isLoggedIn(req, res);
  let admin = await isAdmin(userID);
  const page = parseInt(req.query.page) || 1;
  const limit = 20;

  let event = await getEvent(req.params.eventID);
  if (!event) {
    return res.redirect("/");
  }

  return await renderEvent(userID, admin, event, page, limit, res);
});

app.get(
  "/signup",
  [check("item", "Missing or invalid item ID").isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/");
    }
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect(`/login?item=${req.query.item}`);
    }
    let admin = await isAdmin(userID);

    let item = await getItem(req.query.item);
    if (!item) {
      return res.redirect("/");
    }
    item = setTimes(item);
    let event = await getEvent(item.event_id);
    if (!event) {
      return res.redirect("/");
    }

    return res.render("signup", {
      loggedIn: userID,
      isAdmin: admin,
      event,
      item,
    });
  },
);

app.post(
  "/signup",
  [
    check("item", "Missing or invalid item ID").isInt(),
    check("event", "Missing or invalid event ID").isInt(),
    check("quantity", "Missing or invalid quantity").isInt(),
    check("comment").trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return renderError(res, {
        status: 400,
        heading: "Invalid signup",
        message: "Please check the form and try again.",
        context: "Signup submitted",
        error: "Invalid input",
      });
    }
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return renderError(res, {
        status: 401,
        heading: "Login required",
        message: "Please log in and try again.",
        context: "Signup submitted",
        error: "user not logged in",
      });
    }
    let admin = await isAdmin(userID);

    let item_id = parseInt(req.body.item, 10);
    let quantity = parseInt(req.body.quantity);
    let comment = req.body.comment;

    let signup = {
      item_id,
      user_id: userID,
      quantity,
      comment,
    };
    let signup_id = await createSignup(signup);

    let user = await getUser(userID);
    let item = await getItem(item_id);
    if (!item) {
      return renderError(res, {
        status: 404,
        heading: "Item not found",
        message: "That item may have been removed or is no longer available.",
        context: "Signup submitted",
        error: "Item not found",
      });
    }
    item = setTimes(item);
    let event = await getEvent(item.event_id);
    if (!event) {
      return renderError(res, {
        status: 404,
        heading: "Event not found",
        message: "That event may have been removed or is no longer available.",
        context: "Signup submitted",
        error: "Event not found",
      });
    }

    try {
      await sendConfirmation(
        user.email,
        {
          event: event.title,
          eventDescription: event.description,
          emailInfo: item.email_info,
          eventEmailInfo: event.email_info,
          title: item.title,
          start: item.start,
          end: item.end,
          notes: item.notes,
        },
        quantity,
        comment,
      );
    } catch (err) {
      console.log("Error sending confirmation:", err);
    }

    sendSignupAlert(user, event, item, quantity, comment).catch((err) => {
      console.log("Error sending signup alert:", err);
    });

    return res.render("success", {
      loggedIn: userID,
      isAdmin: admin,
      item: item,
      count: quantity,
      comment: comment,
      event: event,
    });
  },
);

app.delete(
  "/signup",
  [check("signup", "Missing signup ID").trim()],
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
      await cancelSignup(signup.id);
      sendCancellation(signup).catch((err) => {
        console.log("Error sending cancellation:", err);
      });
      return res.status(200).json({ success: true });
    } else {
      console.log("Error deleting signup: Invalid user ID");
      return res.status(401).json({ error: "Invalid user ID" });
    }
  },
);

app.get(
  "/signup/:signupID",
  [check("signupID", "Missing signup ID").isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/user");
    }

    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.redirect("/login");
    }
    let admin = await isAdmin(userID);

    let signup = await getSignup(req.params.signupID);
    if (!signup || signup.user_id != userID) {
      return res.redirect("/user");
    }

    let item = await getItem(signup.item_id);
    if (!item) {
      return res.redirect("/user");
    }
    item = setTimes(item);
    let event = await getEvent(item.event_id);
    if (!event) {
      return res.redirect("/user");
    }

    let signupItem = {
      event: event.title,
      eventDescription: event.description,
      emailInfo: item.email_info,
      eventEmailInfo: event.email_info,
      title: item.title,
      start: item.start,
      end: item.end,
      notes: item.notes,
    };

    return res.render("signup-detail", {
      loggedIn: userID,
      isAdmin: admin,
      item: signupItem,
      count: signup.quantity,
      comment: signup.comment,
      event,
    });
  },
);

app.get("/admin", async (req, res) => {
  let userID = isLoggedIn(req, res);
  if (!userID) {
    return res.redirect("/login");
  }

  let admin = await isAdmin(userID);
  if (!admin) {
    return res.redirect("/");
  }

  const events = await getEvents();
  res.render("admin", {
    loggedIn: userID,
    isAdmin: admin,
    events,
  });
});

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
    isAdmin: admin,
    event: {},
    shelters,
    eventShelterIds: [],
  });
});

app.get(
  "/admin/event/activate",
  [
    check("event", "Missing event ID").isInt(),
    check("active", "Active is required").isBoolean(),
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

    await activateEvent(req.query.event, req.query.active);

    console.log(
      `Updated event ${req.query.event} active status to ${req.query.active}`,
    );

    return res.redirect(`/admin/event/${req.query.event}`);
  },
);

app.get(
  "/admin/event/toggle-kids",
  [
    check("event", "Missing event ID").isInt(),
    check("allow_kids", "Allow kids is required").isBoolean(),
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

    // Get the current event and update only the allow_kids field
    let event = await getEvent(req.query.event);
    if (!event) {
      return res.redirect("/admin");
    }

    event.allow_kids = req.query.allow_kids === "true";
    await updateEvent(req.query.event, event);

    console.log(
      `Updated event ${req.query.event} allow_kids status to ${req.query.allow_kids}`,
    );

    return res.redirect(`/admin/event/${req.query.event}`);
  },
);

app.post(
  "/admin/event",
  upload.single("image"),
  [
    check("title", "Title is required").trim().notEmpty(),
    check("description", "Description is required").trim().notEmpty(),
    check("summary", "Summary is required").trim(),
    check("email_info").trim(),
    check("active", "Active is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for active"),
    check("adopt_signup", "Adopt signup is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for adopt_signup"),
    check("allow_kids", "Allow kids is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for allow_kids"),
    check("alert_email")
      .optional({ nullable: true, checkFalsy: true })
      .isEmail()
      .withMessage("Alert email must be a valid email address."),
    check("alert_on_signup", "Alert on signup is invalid")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for alert_on_signup"),
    check("alert_on_cancellation", "Alert on cancellation is invalid")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for alert_on_cancellation"),
    check("kid_title").trim().optional(),
    check("kid_notes").trim().optional(),
    check("kid_comments_label").trim().optional(),
    check("kid_comments_help").trim().optional(),
    check("kid_email_info").trim().optional(),
    check("kid_needed").isInt().optional(),
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

    const selectedShelterIds = parseShelterIds(req.body.shelters);
    const newShelterNames = parseNewShelterNames(req.body.new_shelters);

    const event = {
      title: req.body.title,
      description: req.body.description,
      summary: req.body.summary,
      email_info: req.body.email_info,
      active: req.body.active,
      form_code: uuidv4(),
      adopt_signup: req.body.adopt_signup,
      allow_kids: req.body.allow_kids,
      kid_title: req.body.kid_title,
      kid_notes: req.body.kid_notes,
      kid_comments_label: req.body.kid_comments_label,
      kid_comments_help: req.body.kid_comments_help,
      kid_email_info: req.body.kid_email_info,
      kid_needed: req.body.kid_needed,
      alert_email: req.body.alert_email ? req.body.alert_email.trim() : "",
      alert_on_signup: req.body.alert_on_signup,
      alert_on_cancellation: req.body.alert_on_cancellation,
      selectedShelters: selectedShelterIds,
    };

    const errors = validationResult(req);
    const renderedErrors = errors.array();
    if (
      (req.body.alert_on_signup === "on" ||
        req.body.alert_on_signup === "true" ||
        req.body.alert_on_cancellation === "on" ||
        req.body.alert_on_cancellation === "true") &&
      !event.alert_email
    ) {
      renderedErrors.push({
        msg: "Alert email is required when alert notifications are enabled.",
      });
    }
    if (renderedErrors.length > 0) {
      return res.render("new-event", {
        loggedIn: userID,
        isAdmin: admin,
        event,
        shelters,
        eventShelterIds: selectedShelterIds,
        newSheltersInput: req.body.new_shelters || "",
        errors: renderedErrors,
      });
    }

    if (req.body.active === "on" || req.body.active === "true") {
      req.body.active = true;
    } else {
      req.body.active = false;
    }
    if (req.body.adopt_signup === "on" || req.body.adopt_signup === "true") {
      req.body.adopt_signup = true;
    } else {
      req.body.adopt_signup = false;
    }
    if (req.body.allow_kids === "on" || req.body.allow_kids === "true") {
      req.body.allow_kids = true;
    } else {
      req.body.allow_kids = false;
    }
    if (
      req.body.alert_on_signup === "on" ||
      req.body.alert_on_signup === "true"
    ) {
      req.body.alert_on_signup = true;
    } else {
      req.body.alert_on_signup = false;
    }
    if (
      req.body.alert_on_cancellation === "on" ||
      req.body.alert_on_cancellation === "true"
    ) {
      req.body.alert_on_cancellation = true;
    } else {
      req.body.alert_on_cancellation = false;
    }

    event.active = req.body.active;
    event.adopt_signup = req.body.adopt_signup;
    event.allow_kids = req.body.allow_kids;
    event.alert_on_signup = req.body.alert_on_signup;
    event.alert_on_cancellation = req.body.alert_on_cancellation;
    event.alert_email = event.alert_email || null;

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
          isAdmin: admin,
          event,
          shelters,
          eventShelterIds: selectedShelterIds,
          newSheltersInput: req.body.new_shelters || "",
          errors: [{ msg: "Error uploading image" }],
        });
      }
    }

    const newEvent = await createEvent(event);
    if (!newEvent) {
      return res.render("new-event", {
        loggedIn: userID,
        isAdmin: admin,
        event,
        shelters,
        eventShelterIds: selectedShelterIds,
        newSheltersInput: req.body.new_shelters || "",
        errors: [{ msg: "Failed to create event" }],
      });
    }

    if (event.adopt_signup) {
      try {
        const createdShelterIds = [];
        if (newShelterNames.length > 0) {
          for (const name of newShelterNames) {
            const shelter = await createShelter(name);
            createdShelterIds.push(shelter.id);
          }
          await refreshShelters();
        }

        const shelterIdsForEvent = [
          ...selectedShelterIds,
          ...createdShelterIds,
        ];

        await setEventShelters(newEvent, shelterIdsForEvent);
      } catch (error) {
        console.error("Error setting event shelters:", error);
        await deleteEvent(newEvent);
        return res.status(500).render("new-event", {
          loggedIn: userID,
          isAdmin: admin,
          event,
          shelters,
          eventShelterIds: selectedShelterIds,
          newSheltersInput: req.body.new_shelters || "",
          errors: [{ msg: "Failed to associate shelters with event" }],
        });
      }
    }

    console.log("Created new event:", newEvent);

    return res.redirect(`/admin/event/${newEvent}`);
  },
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

    const eventShelters = await getSheltersForEvent(event.id);
    const eventShelterIds = eventShelters.map((shelter) => shelter.id);

    return res.render("edit-event", {
      loggedIn: userID,
      isAdmin: admin,
      event,
      shelters,
      eventShelterIds,
    });
  },
);

app.post(
  "/admin/event-edit",
  upload.single("image"),
  [
    check("title", "Title is required").trim().notEmpty(),
    check("description", "Description is required").trim().notEmpty(),
    check("summary").trim(),
    check("email_info").trim(),
    check("active", "Active is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for active"),
    check("adopt_signup", "Adopt signup is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for adopt_signup"),
    check("allow_kids", "Allow kids is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for allow_kids"),
    check("alert_email")
      .optional({ nullable: true, checkFalsy: true })
      .isEmail()
      .withMessage("Alert email must be a valid email address."),
    check("alert_on_signup", "Alert on signup is invalid")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for alert_on_signup"),
    check("alert_on_cancellation", "Alert on cancellation is invalid")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for alert_on_cancellation"),
    check("kid_title").trim().optional(),
    check("kid_notes").trim().optional(),
    check("kid_comments_label").trim().optional(),
    check("kid_comments_help").trim().optional(),
    check("kid_email_info").trim().optional(),
    check("kid_needed").isInt().optional(),
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

    const selectedShelterIds = parseShelterIds(req.body.shelters);
    const newShelterNames = parseNewShelterNames(req.body.new_shelters);

    const errors = validationResult(req);
    const renderedErrors = errors.array();
    if (
      (req.body.alert_on_signup === "on" ||
        req.body.alert_on_signup === "true" ||
        req.body.alert_on_cancellation === "on" ||
        req.body.alert_on_cancellation === "true") &&
      !(req.body.alert_email && req.body.alert_email.trim())
    ) {
      renderedErrors.push({
        msg: "Alert email is required when alert notifications are enabled.",
      });
    }
    if (renderedErrors.length > 0) {
      const event = {
        id: req.body.id,
        title: req.body.title,
        description: req.body.description,
        summary: req.body.summary,
        email_info: req.body.email_info,
        active: req.body.active,
        adopt_signup: req.body.adopt_signup,
        allow_kids: req.body.allow_kids,
        alert_email: req.body.alert_email ? req.body.alert_email.trim() : "",
        alert_on_signup: req.body.alert_on_signup,
        alert_on_cancellation: req.body.alert_on_cancellation,
        kid_title: req.body.kid_title,
        kid_notes: req.body.kid_notes,
        kid_comments_label: req.body.kid_comments_label,
        kid_comments_help: req.body.kid_comments_help,
        kid_email_info: req.body.kid_email_info,
        kid_needed: req.body.kid_needed,
        selectedShelters: selectedShelterIds,
      };
      return res.render("edit-event", {
        loggedIn: userID,
        isAdmin: admin,
        errors: renderedErrors,
        event,
        shelters,
        eventShelterIds: selectedShelterIds,
        newSheltersInput: req.body.new_shelters || "",
      });
    }

    if (req.body.active === "on" || req.body.active === "true") {
      req.body.active = true;
    } else {
      req.body.active = false;
    }
    if (req.body.adopt_signup === "on" || req.body.adopt_signup === "true") {
      req.body.adopt_signup = true;
    } else {
      req.body.adopt_signup = false;
    }
    if (req.body.allow_kids === "on" || req.body.allow_kids === "true") {
      req.body.allow_kids = true;
    } else {
      req.body.allow_kids = false;
    }
    if (
      req.body.alert_on_signup === "on" ||
      req.body.alert_on_signup === "true"
    ) {
      req.body.alert_on_signup = true;
    } else {
      req.body.alert_on_signup = false;
    }
    if (
      req.body.alert_on_cancellation === "on" ||
      req.body.alert_on_cancellation === "true"
    ) {
      req.body.alert_on_cancellation = true;
    } else {
      req.body.alert_on_cancellation = false;
    }

    const event = {
      id: req.body.id,
      title: req.body.title,
      description: req.body.description,
      summary: req.body.summary,
      email_info: req.body.email_info,
      active: req.body.active,
      adopt_signup: req.body.adopt_signup,
      allow_kids: req.body.allow_kids,
      alert_email: req.body.alert_email ? req.body.alert_email.trim() : null,
      alert_on_signup: req.body.alert_on_signup,
      alert_on_cancellation: req.body.alert_on_cancellation,
      kid_title: req.body.kid_title,
      kid_notes: req.body.kid_notes,
      kid_comments_label: req.body.kid_comments_label,
      kid_comments_help: req.body.kid_comments_help,
      kid_email_info: req.body.kid_email_info,
      kid_needed: req.body.kid_needed,
      selectedShelters: selectedShelterIds,
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
        return res.status(500).render("edit-event", {
          loggedIn: userID,
          isAdmin: admin,
          event,
          shelters,
          eventShelterIds: selectedShelterIds,
          newSheltersInput: req.body.new_shelters || "",
          errors: [{ msg: "Error uploading image" }],
        });
      }
    }

    try {
      await updateEvent(req.body.id, event);
    } catch (error) {
      console.error("Error updating event:", error);
      return res.status(500).render("edit-event", {
        loggedIn: userID,
        isAdmin: admin,
        event,
        shelters,
        eventShelterIds: selectedShelterIds,
        newSheltersInput: req.body.new_shelters || "",
        errors: [{ msg: "Failed to update event" }],
      });
    }

    try {
      if (event.adopt_signup) {
        const createdShelterIds = [];
        if (newShelterNames.length > 0) {
          for (const name of newShelterNames) {
            const shelter = await createShelter(name);
            createdShelterIds.push(shelter.id);
          }
          await refreshShelters();
        }

        const shelterIdsForEvent = [
          ...selectedShelterIds,
          ...createdShelterIds,
        ];

        await setEventShelters(req.body.id, shelterIdsForEvent);
      } else {
        await setEventShelters(req.body.id, []);
      }
    } catch (error) {
      console.error("Error updating event shelters:", error);
      return res.status(500).render("edit-event", {
        loggedIn: userID,
        isAdmin: admin,
        event,
        shelters,
        eventShelterIds: selectedShelterIds,
        newSheltersInput: req.body.new_shelters || "",
        errors: [{ msg: "Failed to update event shelters" }],
      });
    }

    console.log(`Edited event ${req.body.id}`);

    return res.redirect(`/admin/event/${req.body.id}`);
  },
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
      isAdmin: admin,
      event: req.query.event,
    });
  },
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
        isAdmin: admin,
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
        isAdmin: admin,
        errors: [{ msg: "Failed to create item" }],
      });
    }

    console.log(`Created new item ${newItem} for event ${item.event_id}`);

    return res.redirect(`/admin/event/${req.body.event}`);
  },
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
      isAdmin: admin,
      item,
    });
  },
);

app.post(
  "/admin/item-edit",
  [
    check("id", "ID is required").isInt(),
    check("event", "Event ID is required").isInt(),
    check("title", "Title is required").trim().notEmpty(),
    check("needed", "Needed is required").isInt(),
    check("active", "Active is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for active"),
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
        active: req.body.active,
      };
      return res.render("edit-item", {
        loggedIn: userID,
        isAdmin: admin,
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
      active: req.body.active,
    };

    await updateItem(req.body.id, item);

    console.log(`Edited item ${req.body.id} for event ${item.event_id}`);

    return res.redirect(`/admin/event/${req.body.event}`);
  },
);

app.get(
  "/admin/item/activate",
  [
    check("item", "Missing item ID").isInt(),
    check("event", "Missing event ID").isInt(),
    check("active", "Active is required").isBoolean(),
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

    await setItemActive(req.query.item, req.query.active === "true");

    console.log(
      `Updated item ${req.query.item} active status to ${req.query.active}`,
    );

    return res.redirect(`/admin/event/${req.query.event}`);
  },
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

    const hasSignups = await hasActiveSignupsForItem(req.query.item);
    if (hasSignups) {
      await setItemActive(req.query.item, false);
      console.log(
        `Disabled item ${req.query.item} because it has active signups`,
      );
    } else {
      await deleteItem(req.query.item);
      console.log(`Deleted item ${req.query.item}`);
    }

    return res.redirect(`/admin/event/${req.query.event}`);
  },
);

app.get(
  "/admin/event/:id",
  [check("id", "Missing event ID").isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/admin");
    }
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

    const totalItems = await countItemsForEvent(event.id);
    const itemsLimit = totalItems > 0 ? totalItems : 1000;
    let items = await getItemsForEvent(event.id, 0, itemsLimit);
    items = items.map(setTimes);

    let pending_kids = await getPendingKidsForEvent(event.id);
    let kids = await getKidsForEvent(event.id);

    // Collect a summary of the number of signups for each item
    let summary = {};
    let total_needed = 0;
    let total_signups = 0;
    if (kids.length == 0) {
      items.forEach((item) => {
        total_needed += item.needed;
        summary[item.id] = {
          signups: 0,
          needed: item.needed,
          title: item.title,
          start: item.start,
          end: item.end,
          active: item.active,
        };
      });
      signups.forEach((signup) => {
        const summaryItem = summary[signup.item_id];
        if (!summaryItem) {
          return;
        }
        const currentSignups = summaryItem.signups;
        const neededSignups = summaryItem.needed;
        const remainingNeeded = Math.max(neededSignups - currentSignups, 0);

        // Only add the minimum of the signup quantity or the remaining needed to total_signups
        const toAdd = Math.min(signup.quantity, remainingNeeded);
        total_signups += toAdd;
        summaryItem.signups += signup.quantity;
      });
    } else {
      total_needed = await countNeededForEvent(event.id);
      total_signups = signups.reduce((acc, signup) => acc + signup.quantity, 0);
    }

    return res.render("admin-event", {
      loggedIn: userID,
      isAdmin: admin,
      event,
      signups,
      summary,
      total_needed,
      total_signups,
      kids,
      pending_kids,
    });
  },
);

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
  },
);

app.get(
  "/add-kids",
  [
    check("event", "Missing event ID").isInt(),
    check("form_code", "Missing form code").trim(),
    check("success").optional({ checkFalsy: true }).isBoolean(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    let admin = await isAdmin(userID);

    let event = await getEvent(req.query.event);
    if (!event || event.form_code != req.query.form_code || !event.allow_kids) {
      return res.status(400).json({ error: "Invalid event ID or form code" });
    }

    const eventShelters = await getSheltersForEvent(event.id);
    const sheltersForForm = eventShelters.length > 0 ? eventShelters : shelters;

    return res.render("new-kid", {
      loggedIn: userID,
      isAdmin: admin,
      success: req.query.success,
      event,
      kid: {
        event: req.query.event,
        code: req.query.form_code,
      },
      shelters: sheltersForForm,
    });
  },
);

app.post(
  "/add-kid",
  [
    check("event", "Event ID is required").isInt(),
    check("name", "Name is required").trim().notEmpty(),
    check("shelter", "Shelter is required").isInt(),
    check("age", "Age is required").isInt(),
    check("gender").trim(),
    check("shirt_size").trim(),
    check("pant_size").trim(),
    check("color").trim(),
    check("comments").trim(),
    check("internal").trim(),
    check("code", "Missing form code").trim(),
    check("additional_contact_name")
      .trim()
      .custom((value, { req }) => {
        const bcpsId = getBCPSShelterId();
        if (bcpsId && String(req.body.shelter) === bcpsId) {
          if (!value) {
            throw new Error("Contact name is required for BCPS");
          }
        }
        return true;
      }),
    check("additional_contact_email")
      .trim()
      .custom((value, { req }) => {
        const bcpsId = getBCPSShelterId();
        const shelterMatches = bcpsId && String(req.body.shelter) === bcpsId;
        if (shelterMatches) {
          if (!value) {
            throw new Error("Contact email is required for BCPS");
          }
          if (!validator.isEmail(value)) {
            throw new Error("Contact email must be valid");
          }
        } else if (value && !validator.isEmail(value)) {
          throw new Error("Contact email must be valid");
        }
        return true;
      }),
    check("additional_contact_phone")
      .trim()
      .custom((value, { req }) => {
        const bcpsId = getBCPSShelterId();
        if (bcpsId && String(req.body.shelter) === bcpsId) {
          if (!value) {
            throw new Error("Contact cell is required for BCPS");
          }
        }
        return true;
      }),
  ],
  async (req, res) => {
    let event = await getEvent(req.body.event);
    if (!event || event.form_code != req.body.code || !event.allow_kids) {
      return res.status(400).json({ error: "Invalid event ID or form code" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: JSON.stringify(errors.array()) });
    }

    const kid = {
      name: req.body.name,
      shelter: req.body.shelter,
      age: req.body.age,
      gender: req.body.gender,
      shirt_size: req.body.shirt_size,
      pant_size: req.body.pant_size,
      color: req.body.color,
      comments: req.body.comments,
      internal: req.body.internal,
      added: false,
      additional_contact_name: req.body.additional_contact_name || null,
      additional_contact_email: req.body.additional_contact_email || null,
      additional_contact_phone: req.body.additional_contact_phone || null,
    };

    const bcpsId = getBCPSShelterId();
    if (!bcpsId || String(req.body.shelter) !== bcpsId) {
      kid.additional_contact_name = null;
      kid.additional_contact_email = null;
      kid.additional_contact_phone = null;
    }

    await createKid(req.body.event, kid);

    console.log(`Added kid for event ${req.body.event}`);

    return res.redirect(
      `/add-kids?event=${req.body.event}&form_code=${req.body.code}&success=true`,
    );
  },
);

app.get(
  "/admin/kid/edit",
  [
    check("kid", "Missing kid ID").isInt(),
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

    let kid = await getKid(req.query.kid);
    if (!kid) {
      return res.redirect("/admin/event/edit?event=" + req.query.event);
    }

    const kidEvent = await getEvent(kid.event);
    if (!kidEvent) {
      return res.redirect("/admin");
    }

    const eventShelters = await getSheltersForEvent(kid.event);
    const sheltersForForm = eventShelters.length > 0 ? eventShelters : shelters;

    return res.render("edit-kid", {
      loggedIn: userID,
      isAdmin: admin,
      kid,
      event: kidEvent,
      shelters: sheltersForForm,
    });
  },
);

app.post(
  "/admin/kid-edit",
  [
    check("id", "ID is required").isInt(),
    check("event", "Event ID is required").isInt(),
    check("name", "Name is required").trim().notEmpty(),
    check("shelter", "Shelter is required").isInt(),
    check("age", "Age is required").isInt(),
    check("gender").trim(),
    check("shirt_size").trim(),
    check("pant_size").trim(),
    check("color").trim(),
    check("comments").trim(),
    check("internal").trim(),
    check("added", "Added is required")
      .optional({ checkFalsy: true })
      .isIn(["on", "off", "true", "false"])
      .withMessage("Invalid value for added"),
    check("item_id").optional({ checkFalsy: true }).isInt(),
    check("additional_contact_name")
      .trim()
      .custom((value, { req }) => {
        const bcpsId = getBCPSShelterId();
        if (bcpsId && String(req.body.shelter) === bcpsId) {
          if (!value) {
            throw new Error("Contact name is required for BCPS");
          }
        }
        return true;
      }),
    check("additional_contact_email")
      .trim()
      .custom((value, { req }) => {
        const bcpsId = getBCPSShelterId();
        const shelterMatches = bcpsId && String(req.body.shelter) === bcpsId;
        if (shelterMatches) {
          if (!value) {
            throw new Error("Contact email is required for BCPS");
          }
          if (!validator.isEmail(value)) {
            throw new Error("Contact email must be valid");
          }
        } else if (value && !validator.isEmail(value)) {
          throw new Error("Contact email must be valid");
        }
        return true;
      }),
    check("additional_contact_phone")
      .trim()
      .custom((value, { req }) => {
        const bcpsId = getBCPSShelterId();
        if (bcpsId && String(req.body.shelter) === bcpsId) {
          if (!value) {
            throw new Error("Contact cell is required for BCPS");
          }
        }
        return true;
      }),
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
      const kid = {
        id: req.body.id,
        event: req.body.event,
        name: req.body.name,
        shelter: req.body.shelter,
        age: req.body.age,
        gender: req.body.gender,
        shirt_size: req.body.shirt_size,
        pant_size: req.body.pant_size,
        color: req.body.color,
        comments: req.body.comments,
        internal: req.body.internal,
        added: req.body.added,
        additional_contact_name: req.body.additional_contact_name,
        additional_contact_email: req.body.additional_contact_email,
        additional_contact_phone: req.body.additional_contact_phone,
      };
      return res.render("edit-kid", {
        loggedIn: userID,
        isAdmin: admin,
        errors: errors.array(),
        kid,
        shelters,
      });
    }

    if (req.body.added === "on" || req.body.added === "true") {
      req.body.added = true;
    } else {
      req.body.added = false;
    }

    const kid = {
      id: req.body.id,
      event: req.body.event,
      name: req.body.name,
      shelter: req.body.shelter,
      age: req.body.age,
      gender: req.body.gender,
      shirt_size: req.body.shirt_size,
      pant_size: req.body.pant_size,
      color: req.body.color,
      comments: req.body.comments,
      internal: req.body.internal,
      added: req.body.added,
      item_id: req.body.item_id,
      additional_contact_name: req.body.additional_contact_name || null,
      additional_contact_email: req.body.additional_contact_email || null,
      additional_contact_phone: req.body.additional_contact_phone || null,
    };

    const bcpsId = getBCPSShelterId();
    if (!bcpsId || String(req.body.shelter) !== bcpsId) {
      kid.additional_contact_name = null;
      kid.additional_contact_email = null;
      kid.additional_contact_phone = null;
    }

    await updateKid(req.body.id, kid);

    console.log(`Edited kid ${req.body.id} for event ${kid.event}`);

    return res.redirect(`/admin/event/${req.body.event}`);
  },
);

app.get(
  "/admin/kid/delete",
  [
    check("kid", "Missing kid ID").isInt(),
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

    await deleteKid(req.query.kid);

    console.log(`Deleted kid ${req.query.kid}`);

    return res.redirect(`/admin/event/${req.query.event}`);
  },
);

app.get(
  "/admin/kid/approve",
  [
    check("kid", "Missing kid ID").isInt(),
    check("event", "Missing event ID").isInt(),
  ],
  async (req, res) => {
    let userID = isLoggedIn(req, res);
    if (!userID) {
      return res.status(401).json({ error: "User not logged in" });
    }

    let admin = await isAdmin(userID);
    if (!admin) {
      return res.status(403).json({ error: "User not an admin" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: JSON.stringify(errors.array()) });
    }

    await approveKid(req.query.kid);

    console.log(`Approved kid ${req.query.kid}`);

    return res.status(200).json({ success: true });
  },
);

app.get(
  "/admin/kid/approve-all",
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
      return res.redirect("/admin");
    }

    const eventID = parseInt(req.query.event, 10);
    const pendingKids = await getPendingKidsForEvent(eventID);

    for (const kid of pendingKids) {
      await approveKid(kid.id);
    }

    console.log(
      `Approved ${pendingKids.length} pending kids for event ${eventID}`,
    );

    return res.redirect(`/admin/event/${eventID}`);
  },
);

async function startServer() {
  await dbInit();
  await refreshShelters();

  const port = process.env.PORT || 3000;
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(
      `Express running → http://${server.address().address}:${
        server.address().port
      }`,
    );
  });
}

startServer().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
