const dotenv = require("dotenv");
dotenv.config();
const Airtable = require("airtable");

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base(process.env.AIRTABLE_BASE);

const sourceBase = Airtable.base("appq5qYIbFYbqvqYv");

async function main() {
  let signups = await base("Signups")
    .select({
      filterByFormula: "{Event Title} = '2023 Back to School Drive'",
    })
    .all();

  for (let signup of signups) {
    let child = await sourceBase("Children")
      .select({
        filterByFormula: `{ID} = ${signup.get("Item Title")}`,
      })
      .all();
    console.log(
      `${signup.get("User Name")} -> ${signup.get("Item Title")} ${child[0].id}`
    );
    sourceBase("Sponsors").create(
      [
        {
          fields: {
            Name: signup.get("User Name")[0],
            Email: signup.get("User Email")[0],
            Phone: signup.get("User Phone")[0],
            Children: [child[0].id],
          },
        },
      ],
      function (err, records) {
        if (err) {
          console.error(err);
          return;
        }
        records.forEach(function (record) {
          console.log(record.getId());
        });
      }
    );
  }
}

main();
