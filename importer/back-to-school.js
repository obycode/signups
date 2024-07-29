const dotenv = require("dotenv");
dotenv.config();
const Airtable = require("airtable");
const sanitizeHtml = require("sanitize-html");
const { init: dbInit, createItem, createKid } = require("../db");

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const signupBase = Airtable.base(process.env.AIRTABLE_BASE);

const sourceBase = Airtable.base("appWT0Yk9UfeIQhN4");
const signupEvent = 11;

dbInit();

async function fetchChildren() {
  let children = await sourceBase("Children")
    .select({
      filterByFormula: "{Added} = 0",
      sort: [{ field: "ID", direction: "asc" }],
    })
    .all()
    .catch((err) => {
      console.error("error fetching children", err);
    });

  return children;
}

function normalizeGender(input) {
  if (!input) {
    return "";
  }

  const lowerInput = input.toLowerCase();
  const genderMap = {
    boy: "boy",
    male: "boy",
    m: "boy",
    girl: "girl",
    female: "girl",
    f: "girl",
  };

  return genderMap[lowerInput] || "";
}

async function addChildrenToEvent(children) {
  for (let child of children) {
    let kid = {
      event: signupEvent,
      name: child.get("Name"),
      shelter: child.get("Shelter"),
      age: child.get("Age"),
      gender: normalizeGender(child.get("Gender")),
      shirt_size: child.get("Shirt Size"),
      pant_size: child.get("Pant Size"),
      color: child.get("Favorite Color"),
      comments: child.get("Additional Comments"),
    };
    kid.id = await createKid(kid);

    let notes = `${kid.age} year old ${kid.gender}`;
    let email_info = `<ul><li><b>Age:</b> ${kid.age}</li><li><b>Gender:</b> ${kid.gender}</li><li><b>Shirt Size:</b> ${kid.shirt_size}</li><li><b>Pant Size:</b> ${kid.pant_size}</li><li><b>Favorite Color:</b> ${kid.color}</li>`;
    if (kid.comments) {
      email_info = `${email_info}<li><b>Additional Comments:</b> ${kid.comments}</li>`;
    }
    email_info = sanitizeHtml(email_info, {
      allowedTags: ["b", "i", "em", "strong", "a", "br", "ul", "li"],
      allowedAttributes: {
        a: ["href"],
      },
    });
    let item = {
      id: kid.id,
      event_id: signupEvent,
      title: `Child ${kid.id}`,
      notes,
      email_info,
      needed: 1,
    };
    createItem(item);
  }
}

async function markChildrenAsAdded(children) {
  await sourceBase("Children")
    .update(
      children.map((child) => {
        return {
          id: child.id,
          fields: {
            Added: true,
          },
        };
      })
    )
    .catch((err) => {
      console.error("error updating children", err);
    });
}

async function main() {
  let children = await fetchChildren();
  console.log(`Found ${children.length} children to add`);

  // Process children in batches of 10
  for (let i = 0; i < children.length; i += 10) {
    let batch = children.slice(i, i + 10);
    await addChildrenToEvent(batch);
    await markChildrenAsAdded(batch);
  }
}

main();
