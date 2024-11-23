const dotenv = require("dotenv");
dotenv.config();
const {
  init: dbInit,
  createEvent,
  createItem,
  createUser,
  createSignup,
} = require("../db");
const Airtable = require("airtable");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const AWS = require("aws-sdk");

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base(process.env.AIRTABLE_BASE);

AWS.config.update({
  region: "us-east-2",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

async function main() {
  await dbInit();

  // Events
  let eventIdMap = {};

  let events = await base("Events")
    .select({
      sort: [{ field: "ID", direction: "asc" }],
    })
    .all();

  events.map(async (record) => {
    const oldId = record.get("ID");
    let imageUrl = record.get("Image")[0].url;
    let imageFilename = record.get("Image")[0].filename;

    // download the image and save it to public/assets/events/
    const dir = path.join(__dirname, "../public/assets/events");

    const imagePath = path.join(dir, imageFilename);
    const writer = fs.createWriteStream(imagePath);

    const response = await axios({
      url: imageUrl,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // upload the image to S3
    const params = {
      Bucket: "e4l-signups",
      Key: imageFilename,
      Body: fs.createReadStream(imagePath),
    };
    function uploadToS3(params) {
      return new Promise((resolve, reject) => {
        s3.upload(params, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data.Location);
          }
        });
      });
    }

    let url = await uploadToS3(params);

    const event = {
      title: record.get("Title"),
      description: record.get("Description"),
      email_info: record.get("Email Info"),
      image: url,
      active: record.get("Active"),
    };
    let id = await createEvent(event);
    eventIdMap[oldId] = id;
  });

  // Items
  let itemIdMap = {};

  let items = await base("Items")
    .select({
      sort: [{ field: "ID", direction: "asc" }],
    })
    .all();

  items.map(async (record) => {
    const oldId = record.get("ID");
    const item = {
      event_id: eventIdMap[record.get("Event ID")[0]],
      title: record.get("Title"),
      notes: record.get("Notes"),
      start_time: record.get("Start Time"),
      end_time: record.get("End Time"),
      needed: record.get("Needed"),
    };

    let id = await createItem(item);
    itemIdMap[oldId] = id;
  });

  // Users
  let userIdMap = {};
  let users = await base("Users")
    .select({
      sort: [{ field: "ID", direction: "asc" }],
    })
    .all();

  users.map(async (record) => {
    const oldId = record.get("ID");
    const user = {
      name: record.get("Name"),
      email: record.get("Email"),
      phone: record.get("Phone"),
      magic_code: record.get("Magic Code"),
    };

    let id = await createUser(user);
    userIdMap[oldId] = id;
  });

  // Signups
  let signups = await base("Signups")
    .select({
      sort: [{ field: "ID", direction: "asc" }],
    })
    .all();

  signups.map(async (record) => {
    const oldId = record.get("ID");
    let item_id = 0;
    // For some reason, a bunch of signups have no associated item
    if (record.get("Item ID")) {
      item_id = itemIdMap[record.get("Item ID")[0]];
    }
    const signup = {
      item_id,
      user_id: userIdMap[record.get("User Num")[0]],
      quantity: record.get("Number"),
      comment: record.get("Comment"),
      created_at: record.get("Created"),
    };

    await createSignup(signup);
  });
}

(async () => {
  await main();
})();
