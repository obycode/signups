const dotenv = require("dotenv");
dotenv.config();
const Airtable = require("airtable");
const sanitizeHtml = require("sanitize-html");

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const signupBase = Airtable.base(process.env.AIRTABLE_BASE);

const sourceBase = Airtable.base("appfxnY8QLAaZfgCI");
const signupEvent = "recZnInmgAzcelnht";

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

  children = children.map((child) => {
    return {
      airtable_id: child.id,
      id: child.get("ID"),
      age: child.get("Age"),
      gender: child.get("Gender"),
      shirtSize: child.get("Shirt Size"),
      pantSize: child.get("Pant Size"),
      color: child.get("Favorite Color"),
      comments: child.get("Additional Comments"),
    };
  });

  return children;
}

async function addChildrenToEvent(children) {
  signupBase("Items")
    .create(
      children.map((child) => {
        let notes = `<ul><li><b>Age:</b> ${child.age}</li><li><b>Gender:</b> ${child.gender}</li><li><b>Shirt Size:</b> ${child.shirtSize}</li><li><b>Pant Size:</b> ${child.pantSize}</li><li><b>Favorite Color:</b> ${child.color}</li>`;
        if (child.comments) {
          notes = `${notes}<li><b>Additional Comments:</b> ${child.comments}</li>`;
        }
        notes = `${notes}<li><b>Child ID:</b> ${child.id}</li></ul>`;
        notes = sanitizeHtml(notes, {
          allowedTags: ["b", "i", "em", "strong", "a", "br", "ul", "li"],
          allowedAttributes: {
            a: ["href"],
          },
        });
        return {
          fields: {
            Notes: notes,
            Event: [signupEvent],
            "End Time": "2023-08-19T20:00:00.000-04:00",
            Needed: 1,
          },
        };
      })
    )
    .catch((err) => {
      console.error("error creating items", err);
    });
}

async function main() {
  let children = await fetchChildren();

  // Process children in batches of 10
  for (let i = 0; i < children.length; i += 10) {
    let batch = children.slice(i, i + 10);
    await addChildrenToEvent(batch);
  }
}

main();
